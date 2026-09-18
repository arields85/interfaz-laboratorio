"""Bounded single-process audio generation and replay coordination."""

from __future__ import annotations

import copy
import inspect
import queue
import threading
import time
from collections import OrderedDict, deque


class AudioCoordinatorError(RuntimeError):
    pass


class AudioCapacityError(AudioCoordinatorError):
    pass


class AudioRetryUnavailable(AudioCoordinatorError):
    pass


class _OwnerFairQueue:
    """Bounded queue that rotates owners while preserving each owner's FIFO order."""

    def __init__(self, maxsize):
        self.maxsize = maxsize
        self.condition = threading.Condition()
        self.queues = OrderedDict()
        self.owners = deque()
        self.size = 0
        self.last_owner = None

    def full(self):
        with self.condition:
            return self.size >= self.maxsize

    def put_nowait(self, item):
        owner = object() if item is None else item.event.get("ownerId", "legacy")
        with self.condition:
            if self.size >= self.maxsize:
                raise queue.Full
            if owner not in self.queues:
                self.queues[owner] = deque()
                self.owners.append(owner)
            self.queues[owner].append(item)
            self.size += 1
            self.condition.notify()

    def get(self, timeout=None):
        deadline = None if timeout is None else time.monotonic() + timeout
        with self.condition:
            while self.size == 0:
                remaining = None if deadline is None else deadline - time.monotonic()
                if remaining is not None and remaining <= 0:
                    raise queue.Empty
                self.condition.wait(remaining)
            if len(self.owners) > 1 and self.owners[0] == self.last_owner:
                self.owners.rotate(-1)
            owner = self.owners.popleft()
            item = self.queues[owner].popleft()
            self.size -= 1
            self.last_owner = owner
            if self.queues[owner]:
                self.owners.append(owner)
            else:
                self.queues.pop(owner, None)
            return item


class GenerationControl:
    """Cooperative, idempotent cancellation for one provider generation."""

    def __init__(self):
        self.cancelled = threading.Event()
        self._lock = threading.Lock()
        self._callbacks = []
        self._callbacks_ran = False

    def add_cancel_callback(self, callback):
        run_now = False
        with self._lock:
            if self._callbacks_ran:
                run_now = True
            else:
                self._callbacks.append(callback)
        if run_now:
            callback()

    def signal(self):
        self.cancelled.set()

    def run_callbacks(self):
        with self._lock:
            if self._callbacks_ran:
                return
            self._callbacks_ran = True
            callbacks, self._callbacks = self._callbacks, []
        for callback in callbacks:
            try:
                callback()
            except Exception:
                pass


class _State:
    def __init__(self, event, config, now):
        self.event = copy.deepcopy(event)
        self.capability = self.event.pop("_capability", None)
        self.config = copy.deepcopy(config)
        self.condition = threading.Condition()
        self.chunks = []
        self.bytes = 0
        self.status = "admitting"
        self.error = None
        self.attempts = 0
        self.failed_at = None
        self.subscribers = 0
        self.queued_at = now
        self.started_at = None
        self.control = None


class AudioSubscription:
    """Iterator whose ownership begins at admission, not first iteration."""

    def __init__(self, coordinator, state):
        self._coordinator = coordinator
        self._state = state
        self._index = 0
        self._lock = threading.Lock()
        self._closed = False

    def __iter__(self):
        return self

    def __next__(self):
        return self._coordinator._next_chunk(self)

    @property
    def closed(self):
        with self._lock:
            return self._closed

    def close(self):
        with self._lock:
            if self._closed:
                return
            self._closed = True
        self._coordinator._detach(self._state)
        with self._state.condition:
            self._state.condition.notify_all()


class AudioCoordinator:
    def __init__(
        self,
        credential_resolver,
        generate,
        *,
        clock=time.monotonic,
        wall_clock=time.time,
        max_records=64,
        max_queue=8,
        max_event_bytes=16 * 1024 * 1024,
        max_total_bytes=64 * 1024 * 1024,
        max_chunks=4096,
        max_subscribers_per_event=16,
        max_subscribers_total=32,
        max_queue_per_owner=2,
        max_subscribers_per_owner=8,
        queue_timeout=30,
        subscriber_idle_timeout=15,
        job_timeout=60,
        retry_cooldown=30,
        monitor_interval=0.01,
        event_validator=None,
    ):
        self.resolve_credential = credential_resolver
        self.generate = generate
        self.clock = clock
        self.wall_clock = wall_clock
        self.max_records = max_records
        self.max_queue = max_queue
        self.max_event_bytes = max_event_bytes
        self.max_total_bytes = max_total_bytes
        self.max_chunks = max_chunks
        self.max_subscribers_per_event = max_subscribers_per_event
        self.max_subscribers_total = max_subscribers_total
        self.max_queue_per_owner = max_queue_per_owner
        self.max_subscribers_per_owner = max_subscribers_per_owner
        self.queue_timeout = queue_timeout
        self.subscriber_idle_timeout = subscriber_idle_timeout
        self.job_timeout = job_timeout
        self.retry_cooldown = retry_cooldown
        self.monitor_interval = monitor_interval
        self.event_validator = event_validator
        self.lock = threading.RLock()
        self.states = OrderedDict()
        self.pending = _OwnerFairQueue(max_queue)
        self._cancellations = queue.Queue(maxsize=2)
        self.total_bytes = 0
        self.total_chunks = 0
        self.total_subscribers = 0
        self.closed = False
        self.active_state = None
        self.quarantined = False
        self._monitor_wake = threading.Event()
        self._generate_accepts_control = self._accepts_generation_control(generate)
        self.worker = threading.Thread(target=self._run, name="PrismaVoiceProvider", daemon=True)
        self.monitor = threading.Thread(target=self._monitor, name="PrismaVoiceDeadline", daemon=True)
        self.cancellation_worker = threading.Thread(
            target=self._run_cancellations,
            name="PrismaVoiceCancellation",
            daemon=True,
        )
        self.worker.start()
        self.monitor.start()
        self.cancellation_worker.start()

    @staticmethod
    def _accepts_generation_control(generate):
        try:
            return len(inspect.signature(generate).parameters) >= 4
        except (TypeError, ValueError):
            return False

    def close(self):
        with self.lock:
            if self.closed:
                return
            self.closed = True
            active = self.active_state
            queued = [state for state in self.states.values() if state.status in {"admitting", "queued"}]
            for state in self.states.values():
                self._clear_authority_locked(state)
        for state in queued:
            self._fail(state, AudioCapacityError("VOICE_COORDINATOR_CLOSED"))
        if active is not None and active.control is not None:
            self._request_cancellation(active.control)
        self._monitor_wake.set()
        try:
            self.pending.put_nowait(None)
        except queue.Full:
            pass
        try:
            self._cancellations.put_nowait(None)
        except queue.Full:
            pass
        self.worker.join(timeout=1)
        self.monitor.join(timeout=1)
        self.cancellation_worker.join(timeout=1)

    def notify_clock_advanced(self):
        """Wake the deadline monitor after an injected clock advances."""
        self._monitor_wake.set()

    def subscribe(self, event, config):
        if self.event_validator is not None:
            validation_event = copy.deepcopy(event)
            try:
                self.event_validator(validation_event)
            finally:
                validation_event.pop("_capability", None)
        event_id = event["id"]
        owner_id = event.get("ownerId")
        state_key = (owner_id, event_id) if owner_id is not None else event_id
        now = self.clock()
        created = False
        retry = False
        with self.lock:
            if event.get("expiresAt", 0) <= self.wall_clock():
                raise AudioRetryUnavailable("VOICE_EVENT_NOT_FOUND")
            if self.closed:
                raise AudioCapacityError("VOICE_COORDINATOR_CLOSED")
            self._expire_locked()
            state = self.states.get(state_key)
            if state is None:
                if self.quarantined:
                    raise AudioRetryUnavailable("VOICE_PROVIDER_QUARANTINED")
                if len(self.states) >= self.max_records or self._pcm_is_full_without_safe_eviction():
                    raise AudioCapacityError("VOICE_CAPACITY_EXCEEDED")
                if self.pending.full():
                    raise AudioCapacityError("VOICE_CAPACITY_EXCEEDED")
                owner_queued = sum(
                    existing.status in {"admitting", "queued"} and existing.event.get("ownerId") == owner_id
                    for existing in self.states.values()
                )
                if owner_id is not None and owner_queued >= self.max_queue_per_owner:
                    raise AudioCapacityError("VOICE_CAPACITY_EXCEEDED")
                state = _State(event, config, now)
                self.states[state_key] = state
                created = True
            elif state.status in {"failed", "timed_out"}:
                can_retry = (
                    state.status == "failed"
                    and state.bytes == 0
                    and state.attempts < 2
                    and now - state.failed_at >= self.retry_cooldown
                )
                if not can_retry:
                    error = state.error
                    if isinstance(error, AudioCoordinatorError):
                        raise error
                    raise AudioRetryUnavailable("VOICE_GENERATION_UNAVAILABLE")
                if self.quarantined or self.pending.full() or self._pcm_is_full_without_safe_eviction():
                    raise AudioCapacityError("VOICE_CAPACITY_EXCEEDED")
                retry = True
            elif state.status == "evicted":
                raise AudioCapacityError("VOICE_AUDIO_EVICTED")
            if state.subscribers >= self.max_subscribers_per_event or self.total_subscribers >= self.max_subscribers_total:
                if created:
                    self.states.pop(state_key, None)
                raise AudioCapacityError("VOICE_SUBSCRIBER_LIMIT")
            owner_subscribers = sum(
                existing.subscribers
                for existing in self.states.values()
                if existing.event.get("ownerId") == owner_id
            )
            if owner_id is not None and owner_subscribers >= self.max_subscribers_per_owner:
                if created:
                    self.states.pop(state_key, None)
                raise AudioCapacityError("VOICE_SUBSCRIBER_LIMIT")
            state.subscribers += 1
            self.total_subscribers += 1

        try:
            self.resolve_credential()
            with self.lock:
                if self.closed:
                    raise AudioCapacityError("VOICE_COORDINATOR_CLOSED")
                if created or retry:
                    if retry:
                        state.capability = event.get("_capability")
                    state.status = "queued"
                    state.error = None
                    state.queued_at = self.clock()
                    self.pending.put_nowait(state)
                    self._monitor_wake.set()
        except Exception:
            self._rollback_admission(state, remove_state=created)
            raise
        return AudioSubscription(self, state)

    def _rollback_admission(self, state, *, remove_state):
        with self.lock:
            if state.subscribers:
                state.subscribers -= 1
                self.total_subscribers -= 1
            self._clear_authority_locked(state)
            state_key = self._state_key(state)
            if remove_state and self.states.get(state_key) is state:
                self.states.pop(state_key, None)

    def _next_chunk(self, subscription):
        state = subscription._state
        while True:
            chunk = None
            error = None
            with state.condition:
                if subscription.closed:
                    raise StopIteration
                if subscription._index < len(state.chunks):
                    chunk = state.chunks[subscription._index]
                    subscription._index += 1
                elif state.status == "complete":
                    error = StopIteration()
                elif state.status in {"failed", "timed_out"}:
                    error = state.error
                    if not isinstance(error, AudioCoordinatorError):
                        error = AudioRetryUnavailable("VOICE_GENERATION_UNAVAILABLE")
                elif state.status == "evicted":
                    error = AudioCapacityError("VOICE_AUDIO_EVICTED")
                elif not state.condition.wait(self.subscriber_idle_timeout):
                    error = AudioRetryUnavailable("VOICE_SUBSCRIBER_IDLE_TIMEOUT")
            if chunk is not None:
                return chunk
            if error is not None:
                subscription.close()
                raise error

    def _detach(self, state):
        with self.lock:
            if state.subscribers <= 0:
                return
            state.subscribers -= 1
            self.total_subscribers -= 1
            if state.subscribers == 0 and self._is_expired_terminal(state):
                self._remove_state_locked(state)

    def _run(self):
        while True:
            try:
                state = self.pending.get(timeout=0.1)
            except queue.Empty:
                if self.closed:
                    return
                continue
            if state is None:
                return
            with self.lock:
                if state.status != "queued":
                    continue
                if self.clock() - state.queued_at > self.queue_timeout:
                    expired = True
                else:
                    expired = False
                    state.status = "active"
                    state.attempts += 1
                    state.started_at = self.clock()
                    state.control = GenerationControl()
                    self.active_state = state
            if expired:
                self._fail(state, AudioRetryUnavailable("VOICE_QUEUE_TIMEOUT"))
                continue
            self._monitor_wake.set()
            producer = None
            try:
                with self.lock:
                    validation_event = copy.deepcopy(state.event)
                    if state.capability is not None:
                        validation_event["_capability"] = state.capability
                try:
                    if self.event_validator is not None:
                        self.event_validator(validation_event)
                finally:
                    validation_event.pop("_capability", None)
                    with self.lock:
                        self._clear_authority_locked(state)
                with self.lock:
                    if state.status != "active":
                        continue
                secret = self.resolve_credential()
                generation_event = copy.deepcopy(state.event)
                generation_event.pop("_capability", None)
                args = (generation_event, copy.deepcopy(state.config), secret)
                producer = self.generate(*args, state.control) if self._generate_accepts_control else self.generate(*args)
                cancel = getattr(producer, "cancel", None)
                if callable(cancel):
                    state.control.add_cancel_callback(cancel)
                for chunk in producer:
                    if self.clock() - state.started_at > self.job_timeout:
                        self._timeout_active(state)
                        break
                    if state.control.cancelled.is_set() or not self._append(state, bytes(chunk)):
                        break
                with self.lock:
                    complete = state.status == "active"
                    if complete:
                        state.status = "complete"
                        self._clear_authority_locked(state)
                if complete:
                    self._notify(state)
            except Exception as error:
                with self.lock:
                    should_fail = state.status == "active"
                if should_fail:
                    self._fail(state, error)
            finally:
                if producer is not None and state.control.cancelled.is_set():
                    close = getattr(producer, "close", None)
                    if callable(close):
                        try:
                            close()
                        except Exception:
                            pass
                with self.lock:
                    if self.active_state is state:
                        self.active_state = None
                        self.quarantined = False
                self._monitor_wake.set()

    def _monitor(self):
        while True:
            self._monitor_wake.wait(self.monitor_interval)
            self._monitor_wake.clear()
            with self.lock:
                if self.closed:
                    return
                now = self.clock()
                active = self.active_state
                timed_out = (
                    active is not None
                    and active.status == "active"
                    and active.started_at is not None
                    and now - active.started_at > self.job_timeout
                )
                queued = [
                    state
                    for state in self.states.values()
                    if state.status == "queued" and now - state.queued_at > self.queue_timeout
                ]
                if timed_out:
                    active.status = "timed_out"
                    active.error = AudioRetryUnavailable("VOICE_JOB_TIMEOUT")
                    active.failed_at = now
                    self._clear_authority_locked(active)
                    self.quarantined = True
                    control = active.control
                else:
                    control = None
            if timed_out:
                self._notify(active)
                self._request_cancellation(control)
            for state in queued:
                self._fail(state, AudioRetryUnavailable("VOICE_QUEUE_TIMEOUT"))

    def _request_cancellation(self, control):
        if control is None:
            return
        control.signal()
        try:
            self._cancellations.put_nowait(control)
        except queue.Full:
            pass

    def _timeout_active(self, state):
        with self.lock:
            if state.status != "active":
                return
            state.status = "timed_out"
            state.error = AudioRetryUnavailable("VOICE_JOB_TIMEOUT")
            state.failed_at = self.clock()
            self.quarantined = True
            self._clear_authority_locked(state)
            control = state.control
        self._notify(state)
        self._request_cancellation(control)

    def _run_cancellations(self):
        while True:
            control = self._cancellations.get()
            if control is None:
                return
            control.run_callbacks()

    def _append(self, state, chunk):
        if not chunk:
            return True
        with self.lock:
            if state.status != "active":
                return False
            self._evict_completed_for(len(chunk), state)
            if (
                state.bytes + len(chunk) > self.max_event_bytes
                or self.total_bytes + len(chunk) > self.max_total_bytes
                or self.total_chunks + 1 > self.max_chunks
            ):
                raise AudioCapacityError("VOICE_AUDIO_CAPACITY_EXCEEDED")
            state.chunks.append(chunk)
            state.bytes += len(chunk)
            self.total_bytes += len(chunk)
            self.total_chunks += 1
        self._notify(state)
        return True

    def _fail(self, state, error):
        with self.lock:
            if state.status in {"complete", "evicted", "timed_out"}:
                return
            state.status = "failed"
            state.error = error
            state.failed_at = self.clock()
            self._clear_authority_locked(state)
        self._notify(state)

    @staticmethod
    def _notify(state):
        with state.condition:
            state.condition.notify_all()

    def _pcm_is_full_without_safe_eviction(self):
        full = self.total_bytes >= self.max_total_bytes or self.total_chunks >= self.max_chunks
        if not full:
            return False
        return not any(state.status == "complete" and state.subscribers == 0 for state in self.states.values())

    def _expire_locked(self):
        for state in list(self.states.values()):
            if self._is_expired_terminal(state) and state.subscribers == 0:
                self._remove_state_locked(state)

    def _is_expired_terminal(self, state):
        return state.event.get("expiresAt", 0) <= self.wall_clock() and state.status not in {
            "admitting",
            "active",
            "queued",
        }

    @staticmethod
    def _state_key(state):
        owner_id = state.event.get("ownerId")
        event_id = state.event["id"]
        return (owner_id, event_id) if owner_id is not None else event_id

    @staticmethod
    def _clear_authority_locked(state):
        state.capability = None
        state.event.pop("_capability", None)

    def _remove_state_locked(self, state):
        state_key = self._state_key(state)
        if self.states.get(state_key) is not state:
            return
        self.total_bytes -= state.bytes
        self.total_chunks -= len(state.chunks)
        self._clear_authority_locked(state)
        self.states.pop(state_key, None)

    def _evict_completed_for(self, incoming, active):
        while self.total_bytes + incoming > self.max_total_bytes or self.total_chunks + 1 > self.max_chunks:
            candidate = next(
                (
                    state
                    for state in self.states.values()
                    if state is not active and state.status == "complete" and state.subscribers == 0
                ),
                None,
            )
            if candidate is None:
                return
            self.total_bytes -= candidate.bytes
            self.total_chunks -= len(candidate.chunks)
            candidate.chunks.clear()
            candidate.bytes = 0
            candidate.status = "evicted"
            self._clear_authority_locked(candidate)
