"""Preparatory store-only delivery guard contract; no runtime activation imports."""

import gc
import unittest
import weakref

from leda_runtime.voice_events import (
    VoiceEventCapacity, VoiceEventStore, VoiceEventStreamCapacity, validate_voice_event,
)


OWNER = "00000000-0000-4000-8000-000000000001"
OTHER = "00000000-0000-4000-8000-000000000002"


class LockProbe:
    """Single-threaded lock seam: reentrancy alone cannot detect a held RLock."""

    def __init__(self):
        self.depth = 0

    def __enter__(self):
        self.depth += 1
        return self

    def __exit__(self, *_args):
        self.depth -= 1


class VoiceEventDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.now = 10.0
        self.store = VoiceEventStore(clock=lambda: self.now, ttl_seconds=5)

    def publish(self, guard=None, owner=OWNER, **kwargs):
        return self.store.publish("question", "answer", owner_id=owner, is_current=guard, **kwargs)

    def retrieve(self, method, event):
        if method == "latest":
            return self.store.latest(OWNER)
        return getattr(self.store, method)(event["id"], OWNER)

    def test_healthy_guard_all_reads_preserve_public_and_internal_shapes(self):
        calls = []

        def guard():
            calls.append(True)
            return True

        event = self.publish(guard, chat_id=-123, paired_bot_producer=True)
        public_keys = {"id", "timestamp", "expiresAt", "text", "question", "telegramChatId"}
        self.assertEqual(set(event), public_keys)
        self.assertEqual(event["telegramChatId"], -123)
        self.assertEqual(validate_voice_event(event, event["id"], now=lambda: self.now), event)
        for method in ("get", "latest", "get_internal"):
            before = len(calls)
            result = self.retrieve(method, event)
            self.assertGreater(len(calls), before)
            expected = {**event, "ownerId": OWNER} if method == "get_internal" else event
            self.assertEqual(result, expected)
            result["text"] = "caller mutation"
        self.assertEqual(self.store.get(event["id"], OWNER), event)
        internal = self.store.get_internal(event["id"], OWNER)
        self.assertEqual(validate_voice_event(internal, event["id"], now=lambda: self.now, require_owner=True), internal)

    def test_the_default_answer_kind_never_adds_a_kind_key(self):
        """voice-ux U1: every event published before this task, and every
        ordinary answer today, must keep its exact prior wire shape."""
        event = self.publish(None)
        self.assertNotIn("kind", event)

    def test_a_non_answer_kind_is_published_with_an_empty_text_and_validates(self):
        """voice-ux U1: a thinking/cancel signal carries no answer -- unlike
        an ordinary answer, an empty text is valid for these kinds."""
        for kind in ("thinking", "cancel"):
            with self.subTest(kind=kind):
                event = self.store.publish("", "", owner_id=OWNER, kind=kind)
                self.assertEqual(event["kind"], kind)
                self.assertEqual(event["text"], "")
                self.assertEqual(validate_voice_event(event, event["id"], now=lambda: self.now), event)

    def test_publish_rejects_an_unknown_kind_without_storing_anything(self):
        with self.assertRaises(ValueError):
            self.store.publish("q", "a", owner_id=OWNER, kind="bogus")
        self.assertIsNone(self.store.latest(OWNER))

    def test_validate_voice_event_rejects_an_unknown_kind(self):
        event = self.publish(None)
        tampered = dict(event, kind="bogus")
        with self.assertRaises(ValueError):
            validate_voice_event(tampered, event["id"], now=lambda: self.now)

    def test_validate_voice_event_still_requires_nonempty_text_for_the_answer_kind(self):
        event = self.store.publish("", "", owner_id=OWNER, kind="thinking")
        tampered = dict(event, kind="answer")
        with self.assertRaises(ValueError):
            validate_voice_event(tampered, event["id"], now=lambda: self.now)

    def test_unguarded_legacy_none_owner_and_ttl_regressions(self):
        legacy = self.store.publish("q", "a", -123)
        self.assertEqual(set(legacy), {"id", "timestamp", "expiresAt", "text", "question"})
        self.assertEqual(self.store.latest(), legacy)
        event = self.publish(None)
        self.assertEqual(self.store.get(event["id"], OWNER), event)
        self.assertIsNone(self.store.get(event["id"], OTHER))
        self.assertIsNone(self.store.get("not-a-uuid"))
        self.now = event["expiresAt"]
        self.assertIsNone(self.store.get(event["id"], OWNER))
        self.assertIsNone(self.store.latest(OWNER))
        self.assertEqual(self.store.latest()["text"], "")

    def test_noncallable_guard_is_closed_value_error_without_mutation(self):
        first = self.store.publish("q", "old", owner_id=OWNER)
        for invalid in (False, 1, "private-guard-canary", object()):
            with self.subTest(type=type(invalid).__name__):
                with self.assertRaises(ValueError) as caught:
                    self.publish(invalid)
                self.assertNotIn("private-guard-canary", str(caught.exception))
                self.assertIsNone(caught.exception.__cause__)
                self.assertEqual(self.store.latest(OWNER), first)
                self.assertEqual(self.store.get(first["id"], OWNER), first)

    def test_nontrue_publication_never_admits_or_evicts(self):
        for value in (False, None, 0, 1, "yes", [], {}):
            with self.subTest(value=value):
                self.store = VoiceEventStore(clock=lambda: self.now, max_events=1, max_total_events=1)
                first = self.store.publish("q", "old", owner_id=OWNER)
                self.assertIsNone(self.publish(lambda: value))
                self.assertEqual(self.store.latest(OWNER), first)
                self.assertIsNone(self.publish(lambda: value, owner=OTHER))
                self.assertIsNone(self.store.latest(OTHER))
                self.assertEqual(self.store.get(first["id"], OWNER), first)

    def test_throwing_guard_is_not_logged_retained_or_admitted(self):
        class Canary:
            pass

        references = []

        def guard():
            secret = Canary()
            references.append(weakref.ref(secret))
            raise RuntimeError("private-guard-canary", secret)

        with self.assertNoLogs(level="DEBUG"):
            self.assertIsNone(self.publish(guard))
        gc.collect()
        self.assertTrue(references)
        self.assertTrue(all(reference() is None for reference in references))
        self.assertIsNone(self.store.latest(OWNER))
        self.store.max_total_events = 1
        self.assertIsNotNone(self.publish(None, owner=OTHER))

    def test_revocation_retires_exact_candidate_without_old_response_fallback(self):
        for method in ("get", "latest", "get_internal"):
            for refusal in (False, 1, "raise"):
                with self.subTest(method=method, refusal=refusal):
                    self.setUp()
                    eligible = True

                    def guard():
                        if eligible:
                            return True
                        if refusal == "raise":
                            raise RuntimeError("private-guard-canary")
                        return refusal

                    old = self.store.publish("q", "older", owner_id=OWNER)
                    unrelated = self.publish(None, owner=OTHER)
                    event = self.publish(guard)
                    eligible = False
                    with self.assertNoLogs(level="DEBUG"):
                        self.assertIsNone(self.retrieve(method, event))
                    self.assertIsNone(self.store.get(event["id"]))
                    self.assertIsNone(self.store.latest(OWNER))
                    self.assertIsNone(self.store.latest(OWNER))
                    self.assertEqual(self.store.get(old["id"], OWNER), old)
                    self.assertEqual(self.store.latest(OTHER), unrelated)

    def test_wrong_owner_does_not_evaluate_guard_or_retire_event(self):
        calls = []
        event = self.publish(lambda: calls.append(True) or True)
        before = len(calls)
        self.assertIsNone(self.store.get(event["id"], OTHER))
        self.assertIsNone(self.store.get_internal(event["id"], OTHER))
        self.assertEqual(len(calls), before)
        self.assertEqual(self.store.get(event["id"], OWNER), event)

    def test_retiring_nonlatest_does_not_delete_new_latest(self):
        eligible = True
        old = self.publish(lambda: eligible)
        new = self.publish(None)
        eligible = False
        self.assertIsNone(self.store.get(old["id"], OWNER))
        self.assertEqual(self.store.latest(OWNER), new)

    def test_guard_references_follow_expiry_owner_removal_and_capacity(self):
        for retirement in ("expiry", "owner", "capacity"):
            with self.subTest(retirement=retirement):
                self.setUp()
                self.store.max_events = 1
                guard = lambda: True
                reference = weakref.ref(guard)
                event = self.publish(guard)
                del guard
                gc.collect()
                self.assertIsNotNone(reference())
                if retirement == "expiry":
                    self.now = event["expiresAt"]
                elif retirement == "owner":
                    self.store.remove_owner(OWNER)
                else:
                    self.publish(None)
                self.assertIsNone(self.store.get(event["id"], OWNER))
                gc.collect()
                self.assertIsNone(reference())

    def test_global_capacity_rejection_does_not_retain_guard_or_evict_owner(self):
        self.store.max_total_events = 1
        first = self.publish(None)
        guard = lambda: True
        reference = weakref.ref(guard)
        with self.assertRaises(VoiceEventCapacity):
            self.publish(guard, owner=OTHER)
        del guard
        gc.collect()
        self.assertIsNone(reference())
        self.assertEqual(self.store.latest(OWNER), first)
        self.assertIsNone(self.store.latest(OTHER))

    def test_reentrant_removal_and_replacement_never_return_retired_candidate(self):
        for method in ("get", "latest", "get_internal"):
            for replace in (False, True):
                for decision in (False, True):
                    with self.subTest(method=method, replace=replace, decision=decision):
                        self.setUp()
                        armed = False
                        replacements = []

                        def guard():
                            if armed:
                                self.store.remove_owner(OWNER)
                                if replace:
                                    replacements.append(self.publish(None))
                                return decision
                            return True

                        event = self.publish(guard)
                        armed = True
                        self.assertIsNone(self.retrieve(method, event))
                        self.assertIsNone(self.store.get(event["id"], OWNER))
                        expected = replacements[0] if replace else None
                        self.assertEqual(self.store.latest(OWNER), expected)

    def test_clock_expiry_during_guard_is_rechecked_before_return(self):
        for method in ("get", "latest", "get_internal"):
            with self.subTest(method=method):
                self.setUp()
                armed = False

                def guard():
                    if armed:
                        self.now += 5
                    return True

                event = self.publish(guard)
                armed = True
                self.assertIsNone(self.retrieve(method, event))
                self.assertIsNone(self.store.get(event["id"], OWNER))
                self.assertIsNone(self.store.latest(OWNER))

    def test_foreign_guard_is_never_called_under_store_lock(self):
        probe = LockProbe()
        self.store.lock = probe
        depths = []

        def guard():
            depths.append(probe.depth)
            return True

        event = self.publish(guard)
        self.assertTrue(depths)
        for method in ("get", "latest", "get_internal"):
            before = len(depths)
            self.assertIsNotNone(self.retrieve(method, event))
            self.assertGreater(len(depths), before)
        self.assertEqual(depths, [0] * len(depths))


class VoiceEventOwnerNotificationTests(unittest.TestCase):
    """T13 unit (c): a push (SSE) endpoint needs a way to wait for the next
    publish for a given owner instead of polling the store every second."""

    def setUp(self):
        self.now = 10.0
        self.store = VoiceEventStore(clock=lambda: self.now, ttl_seconds=300)

    def test_flag_is_unset_until_a_publish_for_that_owner(self):
        flag, unsubscribe = self.store.subscribe_owner(OWNER)
        try:
            self.assertFalse(flag.is_set())
        finally:
            unsubscribe()

    def test_publish_sets_the_flag_for_the_exact_owner_only(self):
        flag_a, unsubscribe_a = self.store.subscribe_owner(OWNER)
        flag_b, unsubscribe_b = self.store.subscribe_owner(OTHER)
        try:
            self.store.publish("q", "a", owner_id=OWNER)
            self.assertTrue(flag_a.wait(1))
            self.assertFalse(flag_b.is_set())
        finally:
            unsubscribe_a()
            unsubscribe_b()

    def test_unsubscribe_stops_further_notifications(self):
        flag, unsubscribe = self.store.subscribe_owner(OWNER)
        unsubscribe()
        self.store.publish("q", "a", owner_id=OWNER)
        self.assertFalse(flag.is_set())

    def test_unsubscribe_is_idempotent(self):
        _flag, unsubscribe = self.store.subscribe_owner(OWNER)
        unsubscribe()
        unsubscribe()  # must not raise

    def test_multiple_subscribers_for_the_same_owner_are_all_notified(self):
        flag_one, unsubscribe_one = self.store.subscribe_owner(OWNER)
        flag_two, unsubscribe_two = self.store.subscribe_owner(OWNER)
        try:
            self.store.publish("q", "a", owner_id=OWNER)
            self.assertTrue(flag_one.wait(1))
            self.assertTrue(flag_two.wait(1))
        finally:
            unsubscribe_one()
            unsubscribe_two()

    def test_a_guard_refused_publish_never_notifies(self):
        flag, unsubscribe = self.store.subscribe_owner(OWNER)
        try:
            self.store.publish("q", "a", owner_id=OWNER, is_current=lambda: False)
            self.assertFalse(flag.wait(0.1))
        finally:
            unsubscribe()

    def test_publish_with_notify_false_stores_the_event_without_waking_subscribers(self):
        """voice-ux U2: a caller that wants to start a side effect (the
        Channel A prefetch) strictly before the owner is told a new event
        exists needs to store the event without the automatic wake-up
        publish() otherwise performs."""
        flag, unsubscribe = self.store.subscribe_owner(OWNER)
        try:
            event = self.store.publish("q", "a", owner_id=OWNER, notify=False)
            self.assertIsNotNone(event)
            self.assertEqual(self.store.latest(OWNER)["id"], event["id"])
            self.assertFalse(flag.wait(0.1))
        finally:
            unsubscribe()

    def test_notify_owner_wakes_a_subscriber_after_a_deferred_publish(self):
        flag, unsubscribe = self.store.subscribe_owner(OWNER)
        try:
            self.store.publish("q", "a", owner_id=OWNER, notify=False)
            self.assertFalse(flag.is_set())
            self.store.notify_owner(OWNER)
            self.assertTrue(flag.wait(1))
        finally:
            unsubscribe()


class VoiceEventStreamCapacityTests(unittest.TestCase):
    """T13b should-fix: bound concurrent SSE streams well below the HMI
    session registry's own 64-session capacity, and release a slot on
    unsubscribe so a reconnect (or another owner) can take it."""

    def setUp(self):
        self.now = 10.0
        self.store = VoiceEventStore(
            clock=lambda: self.now, ttl_seconds=300,
            max_stream_subscribers_per_owner=2, max_stream_subscribers_total=3,
        )

    def test_rejects_a_subscription_past_the_per_owner_limit(self):
        _flag_one, unsubscribe_one = self.store.subscribe_owner(OWNER)
        _flag_two, unsubscribe_two = self.store.subscribe_owner(OWNER)
        try:
            with self.assertRaises(VoiceEventStreamCapacity):
                self.store.subscribe_owner(OWNER)
        finally:
            unsubscribe_one()
            unsubscribe_two()

    def test_per_owner_limit_does_not_affect_a_different_owner(self):
        _flag_one, unsubscribe_one = self.store.subscribe_owner(OWNER)
        _flag_two, unsubscribe_two = self.store.subscribe_owner(OWNER)
        try:
            flag_other, unsubscribe_other = self.store.subscribe_owner(OTHER)
            try:
                self.assertFalse(flag_other.is_set())
            finally:
                unsubscribe_other()
        finally:
            unsubscribe_one()
            unsubscribe_two()

    def test_rejects_a_subscription_past_the_global_limit_even_across_owners(self):
        owners = ["00000000-0000-4000-8000-0000000000%02d" % index for index in range(3)]
        unsubscribes = [self.store.subscribe_owner(owner)[1] for owner in owners]
        try:
            with self.assertRaises(VoiceEventStreamCapacity):
                self.store.subscribe_owner(OWNER)
        finally:
            for unsubscribe in unsubscribes:
                unsubscribe()

    def test_unsubscribe_releases_the_per_owner_slot_for_a_later_subscription(self):
        _flag_one, unsubscribe_one = self.store.subscribe_owner(OWNER)
        _flag_two, unsubscribe_two = self.store.subscribe_owner(OWNER)
        unsubscribe_one()
        _flag_three, unsubscribe_three = self.store.subscribe_owner(OWNER)  # must not raise
        unsubscribe_two()
        unsubscribe_three()

    def test_unsubscribe_releases_the_global_slot_for_a_later_subscription(self):
        owners = ["00000000-0000-4000-8000-0000000000%02d" % index for index in range(3)]
        unsubscribes = [self.store.subscribe_owner(owner)[1] for owner in owners]
        unsubscribes[0]()
        _flag, unsubscribe = self.store.subscribe_owner(OWNER)  # must not raise
        unsubscribe()
        for release in unsubscribes[1:]:
            release()

    def test_a_rejected_subscription_never_holds_a_slot(self):
        """The capacity check must fail before appending the new flag to the
        waiter list, so a rejected caller (which never receives a working
        unsubscribe) cannot itself occupy a slot."""
        _flag_one, unsubscribe_one = self.store.subscribe_owner(OWNER)
        _flag_two, unsubscribe_two = self.store.subscribe_owner(OWNER)
        try:
            with self.assertRaises(VoiceEventStreamCapacity):
                self.store.subscribe_owner(OWNER)
            with self.assertRaises(VoiceEventStreamCapacity):
                self.store.subscribe_owner(OWNER)
        finally:
            unsubscribe_one()
            unsubscribe_two()


class VoiceEventPrefetchTokenTests(unittest.TestCase):
    """T13 unit (b): Channel A's on-outcome publish site has no live HMI
    session capability to forward (it is an async Telegram outcome
    callback, not a request handler). A short-lived, event-scoped,
    server-minted token stands in for it so voice_service's existing
    internal prefetch route (and its capability-shaped transport) can be
    reused unchanged."""

    def setUp(self):
        self.now = 10.0
        self.store = VoiceEventStore(clock=lambda: self.now, ttl_seconds=300)

    def test_mint_returns_none_for_an_unknown_event(self):
        self.assertIsNone(self.store.mint_prefetch_token("00000000-0000-4000-8000-000000000099", OWNER))

    def test_mint_and_resolve_round_trip_returns_the_owner(self):
        event = self.store.publish("q", "a", owner_id=OWNER)

        token = self.store.mint_prefetch_token(event["id"], OWNER)

        self.assertIsInstance(token, str)
        self.assertGreaterEqual(len(token), 32)
        self.assertEqual(self.store.resolve_prefetch_token(token, event["id"]), OWNER)

    def test_resolve_rejects_a_token_bound_to_a_different_event(self):
        event_one = self.store.publish("q1", "a1", owner_id=OWNER)
        event_two = self.store.publish("q2", "a2", owner_id=OWNER)
        token = self.store.mint_prefetch_token(event_one["id"], OWNER)

        self.assertIsNone(self.store.resolve_prefetch_token(token, event_two["id"]))

    def test_resolve_rejects_an_unknown_or_malformed_token(self):
        event = self.store.publish("q", "a", owner_id=OWNER)

        self.assertIsNone(self.store.resolve_prefetch_token("not-a-real-token", event["id"]))
        self.assertIsNone(self.store.resolve_prefetch_token("", event["id"]))
        self.assertIsNone(self.store.resolve_prefetch_token(None, event["id"]))

    def test_resolve_reusable_within_ttl_survives_admission_and_dequeue_revalidation(self):
        # AudioCoordinator revalidates the same event twice per job (once at
        # subscribe()-time admission, once again at dequeue) -- see
        # event_audio.py's own comment on why both calls are load-bearing.
        # A single-use token would break the second revalidation for the
        # very job its first use admitted, so the token must stay usable
        # multiple times within its short window.
        event = self.store.publish("q", "a", owner_id=OWNER)
        token = self.store.mint_prefetch_token(event["id"], OWNER)

        first = self.store.resolve_prefetch_token(token, event["id"])
        second = self.store.resolve_prefetch_token(token, event["id"])

        self.assertEqual(first, OWNER)
        self.assertEqual(second, OWNER)

    def test_resolve_rejects_an_expired_token(self):
        event = self.store.publish("q", "a", owner_id=OWNER)
        token = self.store.mint_prefetch_token(event["id"], OWNER)

        self.now += 61.0  # past the short prefetch-token TTL

        self.assertIsNone(self.store.resolve_prefetch_token(token, event["id"]))

    def test_token_never_authorizes_a_foreign_owner(self):
        event = self.store.publish("q", "a", owner_id=OWNER)
        token = self.store.mint_prefetch_token(event["id"], OWNER)

        owner = self.store.resolve_prefetch_token(token, event["id"])

        self.assertNotEqual(owner, OTHER)
        self.assertIsNone(self.store.get(event["id"], OTHER))


class ChannelBReplyTokenTests(unittest.TestCase):
    """B1: Channel B (the remote personal Telegram bot) has no HMI owner and
    must never publish through the shared _events/_latest HMI voice-event
    store -- its bearer token binds an answer's text, destination chat and
    question message id in a fully separate table, with its own TTL and
    capacity, so resolving it can never surface on /hmi/voice/latest,
    /hmi/voice/events or the orb."""

    def setUp(self):
        self.now = 10.0
        self.store = VoiceEventStore(clock=lambda: self.now)

    def test_mint_and_resolve_round_trip_returns_the_bound_payload(self):
        token = self.store.mint_channel_b_reply_token(7, "El OEE actual es 88,6 %.", 55)

        self.assertIsInstance(token, str)
        self.assertGreaterEqual(len(token), 32)
        self.assertEqual(
            self.store.resolve_channel_b_reply_token(token),
            {"chatId": 7, "text": "El OEE actual es 88,6 %.", "replyToMessageId": 55},
        )

    def test_mint_never_touches_the_shared_events_or_latest_store(self):
        self.store.mint_channel_b_reply_token(7, "answer", 55)

        self.assertEqual(len(self.store._events), 0)
        self.assertEqual(len(self.store._latest), 0)

    def test_reply_to_message_id_is_optional(self):
        token = self.store.mint_channel_b_reply_token(7, "answer")

        self.assertEqual(
            self.store.resolve_channel_b_reply_token(token),
            {"chatId": 7, "text": "answer", "replyToMessageId": None},
        )

    def test_token_is_single_use(self):
        token = self.store.mint_channel_b_reply_token(7, "answer", 55)

        first = self.store.resolve_channel_b_reply_token(token)
        second = self.store.resolve_channel_b_reply_token(token)

        self.assertIsNotNone(first)
        self.assertIsNone(second)

    def test_resolve_rejects_an_unknown_or_malformed_token(self):
        self.assertIsNone(self.store.resolve_channel_b_reply_token("not-a-real-token"))
        self.assertIsNone(self.store.resolve_channel_b_reply_token(""))
        self.assertIsNone(self.store.resolve_channel_b_reply_token(None))

    def test_resolve_rejects_an_expired_token(self):
        token = self.store.mint_channel_b_reply_token(7, "answer", 55)

        self.now += 61.0  # past the short channel-B reply-token TTL

        self.assertIsNone(self.store.resolve_channel_b_reply_token(token))

    def test_mint_rejects_an_invalid_chat_id(self):
        for invalid_chat_id in (0, True, "7", None):
            with self.subTest(chat_id=invalid_chat_id):
                with self.assertRaises(ValueError):
                    self.store.mint_channel_b_reply_token(invalid_chat_id, "answer")


class VoiceTranscriptionTokenTests(unittest.TestCase):
    """PW-013: presentation downloads and bounds a voice note's audio, then
    mints a single-use bearer token carrying the already-base64-encoded audio
    bytes, MIME type and domain-vocabulary hints, so the voice process can
    fetch it back over one loopback GET -- same fully separate-table
    discipline as mint_channel_b_reply_token, never the shared _events/
    _latest store."""

    def setUp(self):
        self.now = 10.0
        self.store = VoiceEventStore(clock=lambda: self.now)

    def test_mint_and_resolve_round_trip_returns_the_bound_payload(self):
        token = self.store.mint_voice_transcription_token("YXVkaW8=", "audio/ogg", ("Prensa 3",))

        self.assertIsInstance(token, str)
        self.assertGreaterEqual(len(token), 32)
        self.assertEqual(
            self.store.resolve_voice_transcription_token(token),
            {"audioBase64": "YXVkaW8=", "mimeType": "audio/ogg", "extraTerms": ["Prensa 3"]},
        )

    def test_extra_terms_default_to_an_empty_list(self):
        token = self.store.mint_voice_transcription_token("YXVkaW8=", "audio/ogg")

        self.assertEqual(
            self.store.resolve_voice_transcription_token(token),
            {"audioBase64": "YXVkaW8=", "mimeType": "audio/ogg", "extraTerms": []},
        )

    def test_mint_never_touches_the_shared_events_or_latest_store(self):
        self.store.mint_voice_transcription_token("YXVkaW8=", "audio/ogg")

        self.assertEqual(len(self.store._events), 0)
        self.assertEqual(len(self.store._latest), 0)

    def test_token_is_single_use(self):
        token = self.store.mint_voice_transcription_token("YXVkaW8=", "audio/ogg")

        first = self.store.resolve_voice_transcription_token(token)
        second = self.store.resolve_voice_transcription_token(token)

        self.assertIsNotNone(first)
        self.assertIsNone(second)

    def test_resolve_rejects_an_unknown_or_malformed_token(self):
        self.assertIsNone(self.store.resolve_voice_transcription_token("not-a-real-token"))
        self.assertIsNone(self.store.resolve_voice_transcription_token(""))
        self.assertIsNone(self.store.resolve_voice_transcription_token(None))

    def test_resolve_rejects_an_expired_token(self):
        token = self.store.mint_voice_transcription_token("YXVkaW8=", "audio/ogg")

        self.now += 61.0  # past the short voice-transcription token TTL

        self.assertIsNone(self.store.resolve_voice_transcription_token(token))

    def test_mint_rejects_an_invalid_audio_payload(self):
        for invalid_audio in ("", None, 42):
            with self.subTest(audio=invalid_audio):
                with self.assertRaises(ValueError):
                    self.store.mint_voice_transcription_token(invalid_audio, "audio/ogg")

    def test_mint_rejects_an_invalid_mime_type(self):
        for invalid_mime in ("", None, 42):
            with self.subTest(mime=invalid_mime):
                with self.assertRaises(ValueError):
                    self.store.mint_voice_transcription_token("YXVkaW8=", invalid_mime)

    def test_extra_terms_ignores_non_string_or_blank_entries(self):
        token = self.store.mint_voice_transcription_token(
            "YXVkaW8=", "audio/ogg", (None, 42, "  ", "Horno 1")
        )

        self.assertEqual(
            self.store.resolve_voice_transcription_token(token)["extraTerms"], ["Horno 1"]
        )

    def test_a_bare_extra_terms_string_is_treated_as_one_term_not_split_into_letters(self):
        token = self.store.mint_voice_transcription_token("YXVkaW8=", "audio/ogg", "Prensa 3")

        self.assertEqual(
            self.store.resolve_voice_transcription_token(token)["extraTerms"], ["Prensa 3"]
        )
