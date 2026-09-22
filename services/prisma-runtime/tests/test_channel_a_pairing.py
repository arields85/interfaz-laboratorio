"""Black-box contract tests for the pure in-memory Channel A pairing domain."""

import itertools
import sys
import threading
import time
import unittest
from dataclasses import FrozenInstanceError
from pathlib import Path
from threading import BrokenBarrierError

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime.channel_a_pairing import (
    PRISMA_CHANNEL_A_CAPACITY,
    PRISMA_CHANNEL_A_CLOCK_INVALID,
    PRISMA_CHANNEL_A_CONFIG_INVALID,
    PRISMA_CHANNEL_A_CONFLICT,
    PRISMA_CHANNEL_A_IDENTITY_REQUIRED,
    PRISMA_CHANNEL_A_OWNER_UNAVAILABLE,
    PRISMA_CHANNEL_A_STALE_GENERATION,
    PRISMA_CHANNEL_A_TICKET_REQUIRED,
    PRISMA_CHANNEL_A_TOKEN_REQUIRED,
    PRISMA_CHANNEL_A_UNAVAILABLE,
    ChannelAPairingCapacity,
    ChannelAPairingConfigInvalid,
    ChannelAPairingConflict,
    ChannelAPairingError,
    ChannelAPairingRegistry,
    ChannelAPairingStaleGeneration,
    ChannelAPairingUnauthorized,
    PairingLink,
)

OWNER = "00000000-0000-4000-8000-00000000000a"
OWNER2 = "00000000-0000-4000-8000-00000000000b"
PHONE = "tg:5001"
PHONE2 = "tg:5002"

URLSAFE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"


def sequential_entropy():
    counter = itertools.count(1)

    def entropy(size):
        return next(counter).to_bytes(size, "big")

    return entropy


class _GatedLock:
    """Serialize the critical section but freeze one chosen thread at its door.

    The gate replaces ``registry.lock`` so a race test can hold a racing
    operation at the exact moment it is about to enter the critical section.
    Whether the test passes is decided by the production code itself: a registry
    that samples its clock before entering the critical section consumes the
    stale sample, while a registry that samples inside it observes the value
    published after the race was staged. Both implementations still terminate,
    so the test never depends on a sleep or on thread scheduling.
    """

    def __init__(self, inner):
        self._inner = inner
        self._held_thread = None
        self.entered = threading.Event()
        self.release = threading.Event()

    def hold_next_acquisition_from(self, thread):
        self._held_thread = thread
        self.entered.clear()
        self.release.clear()

    def release_held(self):
        self.release.set()

    def __enter__(self):
        if threading.current_thread() is self._held_thread:
            self.entered.set()
            self.release.wait(5)
            self._held_thread = None
        self._inner.acquire()
        return self

    def __exit__(self, *exc_info):
        self._inner.release()
        return False


class ChannelAPairingTestCase(unittest.TestCase):
    def registry(self, **overrides):
        self.now = [1000.0]
        options = {
            "warning_lead": 60.0,
            "clock": lambda: self.now[0],
            "entropy": sequential_entropy(),
        }
        options.update(overrides)
        return ChannelAPairingRegistry(**options)

    def assert_error(self, error_type, code, callable_, *args, **kwargs):
        with self.assertRaises(error_type) as captured:
            callable_(*args, **kwargs)
        self.assertEqual(str(captured.exception), code)

    def claim(self, registry, *, owner=OWNER, phone=PHONE):
        challenge = registry.issue_qr(owner)
        return registry.claim_qr(challenge.token, phone)

    def pair(self, registry, *, owner=OWNER, phone=PHONE):
        ticket, _pending = self.claim(registry, owner=owner, phone=phone)
        return registry.confirm(ticket, phone)


class ChannelAPairingChallengeTests(ChannelAPairingTestCase):
    def test_issue_qr_returns_an_opaque_challenge_with_its_declared_deadline(self):
        registry = self.registry()
        challenge = registry.issue_qr(OWNER)
        self.assertEqual(challenge.owner_id, OWNER)
        self.assertEqual(challenge.issued_at, 1000.0)
        self.assertEqual(challenge.expires_at, 1060.0)
        self.assertEqual(len(challenge.token), 43)
        self.assertLessEqual(len(challenge.token.encode("ascii")), 64)
        self.assertTrue(set(challenge.token) <= set(URLSAFE_ALPHABET))
        self.assertNotIn(challenge.token, repr(challenge))
        self.assertNotIn(challenge.token, repr(registry._challenges))

    def test_repeated_issue_qr_returns_the_same_challenge_without_extending_it(self):
        registry = self.registry()
        first = registry.issue_qr(OWNER)
        self.now[0] = 1059.0
        second = registry.issue_qr(OWNER)
        self.assertEqual(second.token, first.token)
        self.assertEqual(second.expires_at, first.expires_at)
        self.now[0] = first.expires_at
        rotated = registry.issue_qr(OWNER)
        self.assertNotEqual(rotated.token, first.token)
        self.assertEqual(rotated.issued_at, first.expires_at)
        self.assertEqual(rotated.expires_at, first.expires_at + 60.0)

    def test_qr_deadline_is_exact_and_the_expired_token_is_rejected(self):
        registry = self.registry()
        challenge = registry.issue_qr(OWNER)
        self.now[0] = challenge.expires_at - 0.001
        ticket, _pending = registry.claim_qr(challenge.token, PHONE)
        self.assertEqual(registry.confirm(ticket, PHONE).owner_id, OWNER)
        expired = registry.issue_qr(OWNER2)
        self.now[0] = expired.expires_at
        self.assert_error(
            ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_TOKEN_REQUIRED, registry.claim_qr, expired.token, PHONE2
        )

    def test_claim_qr_is_single_use_and_creates_only_a_pending_confirmation(self):
        registry = self.registry()
        challenge = registry.issue_qr(OWNER)
        ticket, pending = registry.claim_qr(challenge.token, PHONE)
        self.assertEqual(pending.owner_id, OWNER)
        self.assertEqual(pending.phone_id, PHONE)
        self.assertEqual(pending.claimed_at, 1000.0)
        self.assertEqual(len(ticket), 43)
        self.assertLessEqual(len(ticket.encode("ascii")), 64)
        self.assertNotEqual(ticket, challenge.token)
        self.assertIsNone(registry.owner_link(OWNER))
        self.assertIsNone(registry.phone_link(PHONE))
        self.assert_error(
            ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_TOKEN_REQUIRED, registry.claim_qr, challenge.token, PHONE2
        )
        self.assert_error(ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_TICKET_REQUIRED, registry.confirm, challenge.token, PHONE)
        self.assert_error(ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_TOKEN_REQUIRED, registry.claim_qr, ticket, PHONE2)
        link = registry.confirm(ticket, PHONE)
        self.assertEqual(link.owner_id, OWNER)
        self.assert_error(ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_TICKET_REQUIRED, registry.confirm, ticket, PHONE)

    def test_linked_or_pending_owner_cannot_obtain_a_usable_qr(self):
        registry = self.registry()
        challenge = registry.issue_qr(OWNER)
        ticket, _pending = registry.claim_qr(challenge.token, PHONE)
        self.assert_error(ChannelAPairingConflict, PRISMA_CHANNEL_A_CONFLICT, registry.issue_qr, OWNER)
        registry.confirm(ticket, PHONE)
        self.assert_error(ChannelAPairingConflict, PRISMA_CHANNEL_A_CONFLICT, registry.issue_qr, OWNER)

    def test_pending_confirmation_expires_no_later_than_the_original_qr_deadline(self):
        registry = self.registry()
        challenge = registry.issue_qr(OWNER)
        ticket, pending = registry.claim_qr(challenge.token, PHONE)
        self.assertEqual(pending.expires_at, challenge.expires_at)
        self.now[0] = pending.expires_at
        self.assert_error(ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_TICKET_REQUIRED, registry.confirm, ticket, PHONE)
        self.assertIsNone(registry.owner_link(OWNER))
        self.assertIsNone(registry.phone_link(PHONE))

    def test_confirm_creates_a_link_with_a_fresh_generation_and_consumes_the_ticket(self):
        registry = self.registry()
        ticket, _pending = self.claim(registry)
        link = registry.confirm(ticket, PHONE)
        self.assertEqual(link.owner_id, OWNER)
        self.assertEqual(link.phone_id, PHONE)
        self.assertEqual(link.confirmed_at, 1000.0)
        self.assertEqual(link.last_human_activity_at, 1000.0)
        self.assertEqual(link.idle_expires_at, 1600.0)
        self.assertFalse(link.warning_issued)
        self.assertIsNone(registry.owner_link(OWNER2))
        self.assertIsNone(registry.phone_link(PHONE2))
        self.assertEqual(registry.owner_link(OWNER).generation, link.generation)
        self.assertEqual(registry.phone_link(PHONE).generation, link.generation)
        self.assertEqual(registry.validate_result(PHONE, link.generation), OWNER)
        self.assert_error(ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_TICKET_REQUIRED, registry.confirm, ticket, PHONE)
        self.assertIsNone(registry.owner_link(OWNER2))


class ChannelAPairingExclusivityTests(ChannelAPairingTestCase):
    def test_one_phone_per_owner_and_one_owner_per_phone_are_enforced(self):
        registry = self.registry()
        self.pair(registry)
        other = registry.issue_qr(OWNER2)
        self.assert_error(ChannelAPairingConflict, PRISMA_CHANNEL_A_CONFLICT, registry.claim_qr, other.token, PHONE)
        self.assert_error(ChannelAPairingConflict, PRISMA_CHANNEL_A_CONFLICT, registry.issue_qr, OWNER)
        ticket, _pending = registry.claim_qr(other.token, PHONE2)
        self.assertEqual(registry.confirm(ticket, PHONE2).owner_id, OWNER2)

    def test_a_pending_reservation_blocks_conflicting_claims(self):
        registry = self.registry()
        first = registry.issue_qr(OWNER)
        registry.claim_qr(first.token, PHONE)
        second = registry.issue_qr(OWNER2)
        self.assert_error(ChannelAPairingConflict, PRISMA_CHANNEL_A_CONFLICT, registry.claim_qr, second.token, PHONE)
        self.assertIsNone(registry.owner_link(OWNER2))

    def test_pending_confirmation_is_bound_to_the_claiming_phone(self):
        registry = self.registry()
        ticket, _pending = self.claim(registry)
        self.assert_error(ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_TICKET_REQUIRED, registry.confirm, ticket, PHONE2)
        self.assert_error(ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_TICKET_REQUIRED, registry.cancel_pending, ticket, PHONE2)
        self.assertEqual(registry.confirm(ticket, PHONE).phone_id, PHONE)

    def test_cancel_pending_releases_both_reservations(self):
        registry = self.registry()
        challenge = registry.issue_qr(OWNER)
        ticket, pending = registry.claim_qr(challenge.token, PHONE)
        released = registry.cancel_pending(ticket, PHONE)
        self.assertEqual(released.owner_id, pending.owner_id)
        self.assertEqual(released.phone_id, pending.phone_id)
        self.assert_error(ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_TICKET_REQUIRED, registry.cancel_pending, ticket, PHONE)
        self.assert_error(ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_TICKET_REQUIRED, registry.confirm, ticket, PHONE)
        self.assertEqual(self.pair(registry).owner_id, OWNER)
        self.assertEqual(self.pair(registry, owner=OWNER2, phone=PHONE2).owner_id, OWNER2)

    def test_independent_pairs_do_not_interfere(self):
        registry = self.registry()
        first = self.pair(registry)
        second = self.pair(registry, owner=OWNER2, phone=PHONE2)
        self.assertNotEqual(first.generation, second.generation)
        registry.unlink_phone(PHONE, first.generation)
        self.assertIsNone(registry.owner_link(OWNER))
        self.assertIsNone(registry.phone_link(PHONE))
        self.assertEqual(registry.validate_result(PHONE2, second.generation), OWNER2)
        registry.invalidate_owner(OWNER2)
        self.assertIsNone(registry.phone_link(PHONE2))
        self.assertEqual(self.pair(registry).owner_id, OWNER)
        self.assertIsNone(registry.owner_link(OWNER2))


class ChannelAPairingGenerationTests(ChannelAPairingTestCase):
    def test_unlink_then_rescan_produces_a_distinct_generation(self):
        registry = self.registry()
        first = self.pair(registry)
        unlinked = registry.unlink_phone(PHONE, first.generation)
        self.assertEqual(unlinked.generation, first.generation)
        self.assertIsNone(registry.owner_link(OWNER))
        second = self.pair(registry)
        self.assertGreater(second.generation, first.generation)
        self.assertNotEqual(second.generation, first.generation)

    def test_stale_generation_cannot_validate_touch_warn_unlink_or_take_over(self):
        registry = self.registry()
        first = self.pair(registry)
        registry.unlink_phone(PHONE, first.generation)
        second = self.pair(registry)
        for label, call, args, code in (
            ("validate", registry.validate_result, (PHONE, first.generation), PRISMA_CHANNEL_A_STALE_GENERATION),
            ("touch", registry.human_touch, (PHONE, first.generation), PRISMA_CHANNEL_A_STALE_GENERATION),
            ("warn", registry.warning_due, (PHONE, first.generation), PRISMA_CHANNEL_A_STALE_GENERATION),
            ("unlink", registry.unlink_phone, (PHONE, first.generation), PRISMA_CHANNEL_A_STALE_GENERATION),
        ):
            with self.subTest(operation=label):
                self.assert_error(ChannelAPairingStaleGeneration, code, call, *args)
        self.assertEqual(registry.phone_link(PHONE).generation, second.generation)
        self.assertEqual(registry.validate_result(PHONE, second.generation), OWNER)

    def test_generation_and_phone_identity_are_required_for_private_operations(self):
        registry = self.registry()
        link = self.pair(registry)
        self.assert_error(
            ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_OWNER_UNAVAILABLE, registry.validate_result, PHONE2, link.generation
        )
        self.assert_error(
            ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_OWNER_UNAVAILABLE, registry.human_touch, PHONE2, link.generation
        )
        self.assert_error(
            ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_OWNER_UNAVAILABLE, registry.unlink_phone, PHONE2, link.generation
        )
        for invalid in (None, True, 0, -1, "1", 1.0, link.generation + 1):
            with self.subTest(generation=invalid):
                self.assert_error(
                    ChannelAPairingStaleGeneration, PRISMA_CHANNEL_A_STALE_GENERATION, registry.validate_result, PHONE, invalid
                )
        self.assertIsNone(registry.owner_link(OWNER2))

    def _run_generation_race(self, barrier, calls):
        """Own each race through launch, bounded cleanup and external reporting."""
        worker_errors = []
        cleanup_errors = []
        body_error = None

        def run_worker(index, target, args):
            try:
                barrier.wait(5)
                target(*args)
            except BaseException as error:
                # A broken wait caused by our failure unwind is not another
                # independent failure. A spontaneous broken wait still is.
                if isinstance(error, BrokenBarrierError) and (body_error is not None or worker_errors):
                    return
                worker_errors.append((index, error))
                # Release peers even if the main thread is already in join().
                try:
                    barrier.abort()
                except BaseException as abort_error:
                    cleanup_errors.append((f"worker {index} abort", abort_error))

        # Keep the existing prelaunch ownership guarantee for the whole group.
        threads = [
            threading.Thread(target=run_worker, args=(index, target, args))
            for index, (target, args) in enumerate(calls)
        ]
        try:
            for thread in threads:
                thread.start()
        except BaseException as error:
            body_error = error
        finally:
            # A failed start can still have started its worker. Identity zero
            # is also a started worker, not an absent identity.
            started = [(index, thread) for index, thread in enumerate(threads) if thread.ident is not None]
            if started and (body_error is not None or worker_errors):
                try:
                    barrier.abort()
                except BaseException as error:
                    cleanup_errors.append(("main abort", error))
            # Do not abort a healthy rendezvous merely because start returned:
            # its parties may still be arriving. Every wait has its own bound.
            for index, thread in started:
                try:
                    thread.join(5)
                except BaseException as error:
                    cleanup_errors.append((f"worker {index} join", error))
            survivors = []
            for index, thread in started:
                try:
                    if thread.is_alive():
                        survivors.append(index)
                except BaseException as error:
                    cleanup_errors.append((f"worker {index} liveness", error))

        if body_error is not None and not worker_errors and not cleanup_errors and not survivors:
            raise body_error
        causes = []
        if body_error is not None:
            causes.append(f"launch: {type(body_error).__name__}: {body_error}")
        causes.extend(f"worker {index}: {type(error).__name__}: {error}" for index, error in worker_errors)
        causes.extend(f"{operation}: {type(error).__name__}: {error}" for operation, error in cleanup_errors)
        if survivors:
            causes.append(f"liveness: workers still alive: {survivors}")
        if causes:
            self.fail("; ".join(causes))

    def test_racing_claims_on_one_qr_produce_exactly_one_pending(self):
        registry = self.registry()
        challenge = registry.issue_qr(OWNER)
        barrier = threading.Barrier(2)
        outcomes = []

        def claim(phone):
            try:
                outcomes.append((phone, registry.claim_qr(challenge.token, phone)))
            except ChannelAPairingError as error:
                outcomes.append((phone, str(error)))

        self._run_generation_race(barrier, [(claim, (phone,)) for phone in (PHONE, PHONE2)])
        winners = [(phone, value) for phone, value in outcomes if not isinstance(value, str)]
        losers = [(phone, value) for phone, value in outcomes if isinstance(value, str)]
        self.assertEqual(len(winners), 1)
        self.assertEqual(len(losers), 1)
        self.assertEqual(losers[0][1], PRISMA_CHANNEL_A_TOKEN_REQUIRED)
        ticket, pending = winners[0][1]
        self.assertIsNone(registry.phone_link(losers[0][0]))
        self.assertEqual(registry.confirm(ticket, pending.phone_id).phone_id, pending.phone_id)

    def test_racing_confirms_on_one_ticket_produce_exactly_one_link(self):
        registry = self.registry()
        ticket, _pending = self.claim(registry)
        barrier = threading.Barrier(2)
        outcomes = []

        def confirm():
            try:
                outcomes.append(registry.confirm(ticket, PHONE))
            except ChannelAPairingError as error:
                outcomes.append(str(error))

        self._run_generation_race(barrier, [(confirm, ()) for _ in range(2)])
        links = [value for value in outcomes if not isinstance(value, str)]
        self.assertEqual(len(links), 1)
        self.assertIn(PRISMA_CHANNEL_A_TICKET_REQUIRED, outcomes)
        self.assertEqual(registry.phone_link(PHONE).generation, links[0].generation)

    def test_racing_issue_qr_for_one_owner_returns_a_single_challenge(self):
        registry = self.registry()
        barrier = threading.Barrier(4)
        tokens = []

        def issue():
            tokens.append(registry.issue_qr(OWNER).token)

        self._run_generation_race(barrier, [(issue, ()) for _ in range(4)])
        self.assertEqual(len(tokens), 4)
        self.assertEqual(len(set(tokens)), 1)
        self.assertEqual(registry.claim_qr(tokens[0], PHONE)[1].phone_id, PHONE)


class ChannelAPairingHumanActivityTests(ChannelAPairingTestCase):
    def test_human_touch_refreshes_the_idle_window_for_the_current_generation(self):
        registry = self.registry()
        link = self.pair(registry)
        self.now[0] = 1400.0
        touched = registry.human_touch(PHONE, link.generation)
        self.assertEqual(touched.last_human_activity_at, 1400.0)
        self.assertEqual(touched.idle_expires_at, 2000.0)
        self.assertFalse(touched.warning_issued)

    def test_technical_reads_never_refresh_the_human_idle_window(self):
        registry = self.registry()
        link = self.pair(registry)
        self.now[0] = 1540.0
        self.assertEqual(registry.owner_link(OWNER).idle_expires_at, link.idle_expires_at)
        self.assertEqual(registry.phone_link(PHONE).idle_expires_at, link.idle_expires_at)
        self.assertEqual(registry.validate_result(PHONE, link.generation), OWNER)
        self.assertTrue(registry.warning_due(PHONE, link.generation))
        touched = registry.human_touch(PHONE, link.generation)
        self.assertEqual(touched.idle_expires_at, 1540.0 + 600.0)
        self.now[0] = touched.idle_expires_at
        self.assertIsNone(registry.owner_link(OWNER))
        self.assertIsNone(registry.phone_link(PHONE))
        self.assert_error(
            ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_OWNER_UNAVAILABLE, registry.validate_result, PHONE, link.generation
        )
        for name in (
            "_challenges",
            "_challenge_owner",
            "_pendings",
            "_pending_owner",
            "_pending_phone",
            "_links",
            "_phone_link",
        ):
            self.assertEqual(getattr(registry, name), {}, name)

    def test_idle_window_starts_at_confirmation_and_expires_exactly(self):
        registry = self.registry()
        challenge = registry.issue_qr(OWNER)
        ticket, _pending = registry.claim_qr(challenge.token, PHONE)
        self.now[0] = 1030.0
        link = registry.confirm(ticket, PHONE)
        self.assertEqual(link.confirmed_at, 1030.0)
        self.assertEqual(link.last_human_activity_at, 1030.0)
        self.assertEqual(link.idle_expires_at, 1630.0)
        self.now[0] = 1629.0
        self.assertEqual(registry.owner_link(OWNER).generation, link.generation)
        self.now[0] = 1630.0
        self.assertIsNone(registry.owner_link(OWNER))
        self.assertIsNone(registry.phone_link(PHONE))
        self.assertEqual(self.pair(registry, owner=OWNER2, phone=PHONE).owner_id, OWNER2)

    def test_warning_is_issued_at_most_once_per_human_activity_window(self):
        registry = self.registry()
        link = self.pair(registry)
        self.now[0] = link.idle_expires_at - 61.0
        self.assertFalse(registry.warning_due(PHONE, link.generation))
        self.now[0] = link.idle_expires_at - 60.0
        self.assertTrue(registry.warning_due(PHONE, link.generation))
        self.assertFalse(registry.warning_due(PHONE, link.generation))
        self.assertFalse(registry.warning_due(PHONE, link.generation))
        touched = registry.human_touch(PHONE, link.generation)
        self.assertFalse(touched.warning_issued)
        self.assertFalse(registry.warning_due(PHONE, link.generation))
        self.now[0] = touched.idle_expires_at - 60.0
        self.assertTrue(registry.warning_due(PHONE, link.generation))

    def test_warning_due_requires_the_current_generation(self):
        registry = self.registry()
        link = self.pair(registry)
        self.assert_error(
            ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_OWNER_UNAVAILABLE, registry.warning_due, PHONE2, link.generation
        )
        self.assertFalse(registry.warning_due(PHONE, link.generation))


class ChannelAPairingReleaseTests(ChannelAPairingTestCase):
    def test_invalidate_owner_releases_link_pending_and_unclaimed_challenge(self):
        registry = self.registry()
        challenge = registry.issue_qr(OWNER)
        release = registry.invalidate_owner(OWNER)
        self.assertTrue(release.released_qr)
        self.assertFalse(release.released_pending)
        self.assertFalse(release.released_link)
        self.assert_error(ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_TOKEN_REQUIRED, registry.claim_qr, challenge.token, PHONE)
        ticket, _pending = self.claim(registry)
        release = registry.invalidate_owner(OWNER)
        self.assertTrue(release.released_pending)
        self.assertFalse(release.released_link)
        self.assert_error(ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_TICKET_REQUIRED, registry.confirm, ticket, PHONE)
        self.assertIsNone(registry.phone_link(PHONE))
        link = self.pair(registry)
        release = registry.invalidate_owner(OWNER)
        self.assertTrue(release.released_link)
        self.assertEqual(release.owner_id, OWNER)
        self.assertIsNone(registry.owner_link(OWNER))
        self.assertIsNone(registry.phone_link(PHONE))
        self.assert_error(
            ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_OWNER_UNAVAILABLE, registry.human_touch, PHONE, link.generation
        )
        unknown = registry.invalidate_owner(OWNER2).as_dict()
        self.assertEqual(unknown["releasedLink"], False)
        self.assertEqual(unknown["releasedPending"], False)
        self.assertEqual(unknown["releasedQr"], False)

    def test_capacity_bounds_challenges_and_pairings_and_expiry_releases_them(self):
        registry = self.registry(max_challenges=1, max_pairings=1)
        first = registry.issue_qr(OWNER)
        self.assert_error(ChannelAPairingCapacity, PRISMA_CHANNEL_A_CAPACITY, registry.issue_qr, OWNER2)
        ticket, _pending = registry.claim_qr(first.token, PHONE)
        second = registry.issue_qr(OWNER2)
        self.assert_error(ChannelAPairingCapacity, PRISMA_CHANNEL_A_CAPACITY, registry.claim_qr, second.token, PHONE2)
        self.assertIsNone(registry.phone_link(PHONE2))
        self.assert_error(ChannelAPairingConflict, PRISMA_CHANNEL_A_CONFLICT, registry.issue_qr, OWNER)
        self.now[0] = first.expires_at
        self.assert_error(ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_TICKET_REQUIRED, registry.confirm, ticket, PHONE)
        fresh = registry.issue_qr(OWNER)
        self.assert_error(
            ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_TOKEN_REQUIRED, registry.claim_qr, second.token, PHONE2
        )
        fresh_ticket, _pending = registry.claim_qr(fresh.token, PHONE)
        link = registry.confirm(fresh_ticket, PHONE)
        self.assertEqual(link.owner_id, OWNER)
        queued = registry.issue_qr(OWNER2)
        self.assert_error(ChannelAPairingCapacity, PRISMA_CHANNEL_A_CAPACITY, registry.claim_qr, queued.token, PHONE2)
        registry.unlink_phone(PHONE, link.generation)
        later = registry.issue_qr(OWNER2)
        self.assertNotEqual(later.token, second.token)
        self.assertEqual(registry.claim_qr(later.token, PHONE2)[1].phone_id, PHONE2)

    def test_invalid_warning_lead_and_registry_bounds_fail_closed(self):
        for invalid in (0.0, -1.0, 600.0, 900.0, float("nan"), float("inf"), True, "60"):
            with self.subTest(warning_lead=invalid):
                self.assert_error(
                    ChannelAPairingConfigInvalid, PRISMA_CHANNEL_A_CONFIG_INVALID, self.registry, warning_lead=invalid
                )
        for keyword, invalid in (
            ("qr_ttl", 0.0),
            ("qr_ttl", -60.0),
            ("qr_ttl", "60"),
            ("human_idle_ttl", 0.0),
            ("human_idle_ttl", 60.0),
            ("max_challenges", 0),
            ("max_challenges", -1),
            ("max_challenges", True),
            ("max_pairings", 0),
        ):
            with self.subTest(bound=keyword, value=invalid):
                self.assert_error(
                    ChannelAPairingConfigInvalid,
                    PRISMA_CHANNEL_A_CONFIG_INVALID,
                    self.registry,
                    **{keyword: invalid},
                )

    def test_invalid_clock_values_fail_closed_without_deadline_bypass(self):
        state = {"value": 1000.0}
        registry = self.registry(clock=lambda: state["value"])
        challenge = registry.issue_qr(OWNER)
        for broken in (float("nan"), float("inf"), float("-inf"), "1000", None, True):
            state["value"] = broken
            with self.subTest(clock=broken):
                self.assert_error(
                    ChannelAPairingConfigInvalid, PRISMA_CHANNEL_A_CLOCK_INVALID, registry.issue_qr, OWNER2
                )
                self.assert_error(
                    ChannelAPairingConfigInvalid,
                    PRISMA_CHANNEL_A_CLOCK_INVALID,
                    registry.claim_qr,
                    challenge.token,
                    PHONE,
                )
        state["value"] = 1000.0
        self.assertEqual(registry.issue_qr(OWNER).token, challenge.token)

        def broken_clock():
            raise RuntimeError("clock unavailable")

        failing = self.registry(clock=broken_clock)
        self.assert_error(ChannelAPairingConfigInvalid, PRISMA_CHANNEL_A_CLOCK_INVALID, failing.issue_qr, OWNER)

    def test_entropy_failure_and_collision_fail_closed_without_corrupting_state(self):
        state = {"fail": False}
        counter = itertools.count(1)

        def flaky(size):
            if state["fail"]:
                raise OSError("entropy source unavailable")
            return next(counter).to_bytes(size, "big")

        registry = self.registry(entropy=flaky)
        challenge = registry.issue_qr(OWNER)
        state["fail"] = True
        self.assert_error(ChannelAPairingError, PRISMA_CHANNEL_A_UNAVAILABLE, registry.issue_qr, OWNER2)
        state["fail"] = False
        ticket, _pending = registry.claim_qr(challenge.token, PHONE)
        self.assertEqual(registry.confirm(ticket, PHONE).owner_id, OWNER)

        colliding = {"on": True}
        counter = itertools.count(1)

        def colliding_entropy(size):
            if colliding["on"]:
                return b"\x07" * size
            return next(counter).to_bytes(size, "big")

        registry = self.registry(entropy=colliding_entropy)
        live = registry.issue_qr(OWNER)
        self.assert_error(ChannelAPairingError, PRISMA_CHANNEL_A_UNAVAILABLE, registry.issue_qr, OWNER2)
        self.assert_error(ChannelAPairingError, PRISMA_CHANNEL_A_UNAVAILABLE, registry.claim_qr, live.token, PHONE)
        colliding["on"] = False
        collided_ticket, _pending = registry.claim_qr(live.token, PHONE)
        self.assertEqual(registry.confirm(collided_ticket, PHONE).owner_id, OWNER)

        short = self.registry(entropy=lambda size: b"\x01")
        self.assert_error(ChannelAPairingError, PRISMA_CHANNEL_A_UNAVAILABLE, short.issue_qr, OWNER)

    def test_identity_values_are_strictly_validated(self):
        registry = self.registry()
        challenge = registry.issue_qr(OWNER)
        for invalid in (None, 1234, "", " ", "  padded", "padded ", OWNER.upper(), "A" * 43, "a" * 256, "café", "line\nbreak"):
            with self.subTest(owner=invalid):
                self.assert_error(
                    ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_IDENTITY_REQUIRED, registry.issue_qr, invalid
                )
        for invalid in (None, 1234, "", " ", "  padded", "padded ", "a" * 256, "café", "line\nbreak"):
            with self.subTest(phone=invalid):
                self.assert_error(
                    ChannelAPairingUnauthorized,
                    PRISMA_CHANNEL_A_IDENTITY_REQUIRED,
                    registry.claim_qr,
                    challenge.token,
                    invalid,
                )

    def test_opaque_tokens_and_tickets_reject_malformed_values(self):
        registry = self.registry()
        challenge = registry.issue_qr(OWNER)
        ticket, _pending = registry.claim_qr(challenge.token, PHONE)
        for invalid in (None, 1234, "", "a" * 42, "a" * 44, "?" * 43, "A" * 42 + "=", "é" * 43):
            with self.subTest(token=invalid):
                self.assert_error(
                    ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_TOKEN_REQUIRED, registry.claim_qr, invalid, PHONE2
                )
            with self.subTest(ticket=invalid):
                self.assert_error(
                    ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_TICKET_REQUIRED, registry.confirm, invalid, PHONE
                )
        self.assertNotIn(ticket, repr(registry._pendings))
        self.assertEqual(registry.confirm(ticket, PHONE).owner_id, OWNER)

    def test_public_snapshots_are_immutable_and_json_ready(self):
        registry = self.registry()
        challenge = registry.issue_qr(OWNER)
        payload = challenge.as_dict()
        self.assertEqual(payload["ownerId"], OWNER)
        self.assertEqual(payload["token"], challenge.token)
        self.assertEqual(payload["issuedAt"], 1000.0)
        self.assertEqual(payload["expiresAt"], 1060.0)
        payload["token"] = "tampered"
        self.assertEqual(registry.issue_qr(OWNER).token, challenge.token)
        with self.assertRaises(FrozenInstanceError):
            challenge.issued_at = 0.0
        ticket, pending = registry.claim_qr(challenge.token, PHONE)
        self.assertEqual(set(pending.as_dict()), {"ownerId", "phoneId", "claimedAt", "expiresAt"})
        link = registry.confirm(ticket, PHONE)
        self.assertEqual(
            set(link.as_dict()),
            {
                "ownerId",
                "phoneId",
                "generation",
                "confirmedAt",
                "lastHumanActivityAt",
                "idleExpiresAt",
                "warningIssued",
            },
        )
        with self.assertRaises(FrozenInstanceError):
            link.generation = 0

    def test_unlink_phone_releases_both_dimensions(self):
        registry = self.registry()
        link = self.pair(registry)
        released = registry.unlink_phone(PHONE, link.generation)
        self.assertEqual(released.generation, link.generation)
        self.assertIsNone(registry.owner_link(OWNER))
        self.assertIsNone(registry.phone_link(PHONE))
        self.assert_error(ChannelAPairingUnauthorized, PRISMA_CHANNEL_A_OWNER_UNAVAILABLE, registry.unlink_phone, PHONE, link.generation)
        self.assertEqual(self.pair(registry).owner_id, OWNER)


class ChannelAPairingClockDisciplineTests(ChannelAPairingTestCase):
    """The clock belongs inside the serialized transition, and only forward.

    A sample taken before the lock is the defect under test: it admits a QR
    claim, a confirmation, a result validation and a human touch that the
    committed deadline already forbids, and a backwards sample can extend a
    live deadline. Each race test freezes the racing thread at the critical
    section, publishes the deadline-crossing clock value, then releases it.
    """

    def _race(self, registry, target, *, sample_at, publish_at):
        outcomes = []

        def run():
            try:
                outcomes.append(("ok", target()))
            except ChannelAPairingError as error:
                outcomes.append(("error", str(error)))

        worker = threading.Thread(target=run)
        gate = _GatedLock(registry.lock)
        registry.lock = gate
        self.now[0] = sample_at
        gate.hold_next_acquisition_from(worker)
        worker.start()
        self.assertTrue(gate.entered.wait(5), "the racing operation must reach the critical section")
        self.now[0] = publish_at
        gate.release_held()
        worker.join(5)
        self.assertFalse(worker.is_alive(), "the racing operation must terminate")
        return outcomes

    def test_clock_is_sampled_inside_the_lock_so_claim_at_exact_expiry_is_rejected(self):
        registry = self.registry()
        challenge = registry.issue_qr(OWNER)
        outcomes = self._race(
            registry,
            lambda: registry.claim_qr(challenge.token, PHONE),
            sample_at=challenge.expires_at - 1.0,
            publish_at=challenge.expires_at,
        )
        self.assertEqual(outcomes, [("error", PRISMA_CHANNEL_A_TOKEN_REQUIRED)])
        self.assertEqual(registry._pendings, {})
        self.assertEqual(registry._pending_owner, {})

    def test_clock_is_sampled_inside_the_lock_so_confirm_at_exact_expiry_is_rejected(self):
        registry = self.registry()
        ticket, pending = self.claim(registry)
        outcomes = self._race(
            registry,
            lambda: registry.confirm(ticket, PHONE),
            sample_at=pending.expires_at - 1.0,
            publish_at=pending.expires_at,
        )
        self.assertEqual(outcomes, [("error", PRISMA_CHANNEL_A_TICKET_REQUIRED)])
        self.assertEqual(registry._pendings, {})
        self.assertEqual(registry._links, {})

    def test_clock_is_sampled_inside_the_lock_so_validation_at_exact_expiry_is_rejected(self):
        registry = self.registry()
        link = self.pair(registry)
        outcomes = self._race(
            registry,
            lambda: ("validated", registry.validate_result(PHONE, link.generation)),
            sample_at=link.idle_expires_at - 1.0,
            publish_at=link.idle_expires_at,
        )
        self.assertEqual(outcomes, [("error", PRISMA_CHANNEL_A_OWNER_UNAVAILABLE)])
        self.assertEqual(registry._links, {})
        self.assertEqual(registry._phone_link, {})

    def test_clock_is_sampled_inside_the_lock_so_touch_at_exact_expiry_is_rejected(self):
        registry = self.registry()
        link = self.pair(registry)
        outcomes = self._race(
            registry,
            lambda: registry.human_touch(PHONE, link.generation),
            sample_at=link.idle_expires_at - 1.0,
            publish_at=link.idle_expires_at,
        )
        self.assertEqual(outcomes, [("error", PRISMA_CHANNEL_A_OWNER_UNAVAILABLE)])
        self.assertEqual(registry._links, {})
        self.assertEqual(registry._phone_link, {})

    def test_delayed_touch_cannot_overwrite_a_newer_committed_activity(self):
        registry = self.registry()
        link = self.pair(registry)
        outcomes = []

        def touch():
            try:
                outcomes.append(registry.human_touch(PHONE, link.generation))
            except ChannelAPairingError as error:
                outcomes.append(str(error))

        worker = threading.Thread(target=touch)
        gate = _GatedLock(registry.lock)
        registry.lock = gate
        self.now[0] = 1400.0
        gate.hold_next_acquisition_from(worker)
        worker.start()
        self.assertTrue(gate.entered.wait(5), "the delayed touch must reach the critical section")
        self.now[0] = 1500.0
        committed = registry.human_touch(PHONE, link.generation)
        self.assertEqual(committed.last_human_activity_at, 1500.0)
        self.assertEqual(committed.idle_expires_at, 2100.0)
        gate.release_held()
        worker.join(5)
        self.assertFalse(worker.is_alive(), "the delayed touch must terminate")
        self.assertEqual(outcomes, [committed])
        current = registry.owner_link(OWNER)
        self.assertEqual(current.last_human_activity_at, 1500.0)
        self.assertEqual(current.idle_expires_at, 2100.0)

    def test_finite_clock_regression_fails_closed_without_state_transition(self):
        registry = self.registry()
        link = self.pair(registry)
        self.now[0] = 1500.0
        registry.human_touch(PHONE, link.generation)
        self.now[0] = 1499.0
        self.assert_error(
            ChannelAPairingConfigInvalid,
            PRISMA_CHANNEL_A_CLOCK_INVALID,
            registry.human_touch,
            PHONE,
            link.generation,
        )
        self.assert_error(ChannelAPairingConfigInvalid, PRISMA_CHANNEL_A_CLOCK_INVALID, registry.issue_qr, OWNER2)
        self.assertEqual(registry._links[OWNER].last_human_activity_at, 1500.0)
        self.assertEqual(registry._links[OWNER].idle_expires_at, 2100.0)
        self.now[0] = 1500.0
        preserved = registry.owner_link(OWNER)
        self.assertEqual(preserved.last_human_activity_at, 1500.0)
        self.assertEqual(preserved.idle_expires_at, 2100.0)

    def test_finite_clock_regression_never_extends_a_qr_or_pending_claim(self):
        registry = self.registry()
        challenge = registry.issue_qr(OWNER)
        self.now[0] = 1059.0
        self.assertEqual(registry.issue_qr(OWNER).token, challenge.token)
        self.now[0] = 1000.0
        self.assert_error(ChannelAPairingConfigInvalid, PRISMA_CHANNEL_A_CLOCK_INVALID, registry.issue_qr, OWNER)
        self.assert_error(
            ChannelAPairingConfigInvalid,
            PRISMA_CHANNEL_A_CLOCK_INVALID,
            registry.claim_qr,
            challenge.token,
            PHONE,
        )
        self.assertEqual(len(registry._challenges), 1)
        self.assertEqual(next(iter(registry._challenges.values())).expires_at, 1060.0)
        self.now[0] = 1059.0
        _ticket, pending = registry.claim_qr(challenge.token, PHONE)
        self.assertEqual(pending.expires_at, 1060.0)

    def test_default_clock_is_monotonic(self):
        registry = ChannelAPairingRegistry(warning_lead=60.0)
        self.assertIs(registry.clock, time.monotonic)

    def test_infinite_or_unrepresentable_deadlines_fail_closed_without_partial_records(self):
        infinite = self.registry(qr_ttl=1e308)
        self.now[0] = 1e308
        self.assert_error(ChannelAPairingConfigInvalid, PRISMA_CHANNEL_A_CLOCK_INVALID, infinite.issue_qr, OWNER)
        self.assertEqual(infinite._challenges, {})

        collapsed = self.registry(qr_ttl=1.0)
        self.now[0] = 1e308
        self.assert_error(ChannelAPairingConfigInvalid, PRISMA_CHANNEL_A_CLOCK_INVALID, collapsed.issue_qr, OWNER)
        self.assertEqual(collapsed._challenges, {})

        overflowing = self.registry(qr_ttl=1.7e308, human_idle_ttl=1.7e308)
        self.now[0] = 1.0
        challenge = overflowing.issue_qr(OWNER)
        self.now[0] = 1.5e308
        ticket, pending = overflowing.claim_qr(challenge.token, PHONE)
        self.assertEqual(pending.expires_at, 1.7e308)
        self.assert_error(
            ChannelAPairingConfigInvalid, PRISMA_CHANNEL_A_CLOCK_INVALID, overflowing.confirm, ticket, PHONE
        )
        self.assertEqual(len(overflowing._pendings), 1)
        self.assertIsNotNone(overflowing._pending_owner.get(OWNER))
        self.assertEqual(overflowing._links, {})

    def test_every_serialized_operation_rejects_a_regressing_clock(self):
        registry = self.registry()
        ticket, _pending = self.claim(registry)
        link = registry.confirm(ticket, PHONE)
        self.now[0] = 1500.0
        challenge = registry.issue_qr(OWNER2)
        self.now[0] = 1499.0
        operations = (
            ("issue_qr", lambda: registry.issue_qr(OWNER2)),
            ("claim_qr", lambda: registry.claim_qr(challenge.token, PHONE2)),
            ("cancel_pending", lambda: registry.cancel_pending(ticket, PHONE)),
            ("confirm", lambda: registry.confirm(ticket, PHONE)),
            ("owner_link", lambda: registry.owner_link(OWNER)),
            ("phone_link", lambda: registry.phone_link(PHONE)),
            ("validate_result", lambda: registry.validate_result(PHONE, link.generation)),
            ("human_touch", lambda: registry.human_touch(PHONE, link.generation)),
            ("warning_due", lambda: registry.warning_due(PHONE, link.generation)),
            ("due_warnings", lambda: registry.due_warnings()),
            ("unlink_phone", lambda: registry.unlink_phone(PHONE, link.generation)),
            ("invalidate_owner", lambda: registry.invalidate_owner(OWNER)),
        )
        for label, call in operations:
            with self.subTest(operation=label):
                self.assert_error(ChannelAPairingConfigInvalid, PRISMA_CHANNEL_A_CLOCK_INVALID, call)
        self.assertEqual(registry._links[OWNER].last_human_activity_at, 1000.0)
        self.assertEqual(len(registry._challenges), 1)
        self.assertEqual(len(registry._pending_owner), 0)

    def test_extreme_numeric_config_and_clock_values_are_normalized(self):
        for keyword in ("warning_lead", "qr_ttl", "human_idle_ttl"):
            with self.subTest(bound=keyword):
                self.assert_error(
                    ChannelAPairingConfigInvalid,
                    PRISMA_CHANNEL_A_CONFIG_INVALID,
                    self.registry,
                    **{keyword: 10 ** 1000},
                )
        state = {"value": 1000.0}
        registry = self.registry(clock=lambda: state["value"])
        registry.issue_qr(OWNER)
        state["value"] = 10 ** 1000
        self.assert_error(ChannelAPairingConfigInvalid, PRISMA_CHANNEL_A_CLOCK_INVALID, registry.issue_qr, OWNER2)


class ChannelAPairingWarningSweepTests(ChannelAPairingTestCase):
    """The public atomic sweep reserves each warning once per activity window."""

    def test_due_warnings_reserves_each_link_once_at_the_lead_boundary(self):
        registry = self.registry()
        link = self.pair(registry)
        self.now[0] = link.idle_expires_at - 61.0
        self.assertEqual(registry.due_warnings(), ())
        self.now[0] = link.idle_expires_at - 60.0
        due = registry.due_warnings()
        self.assertIsInstance(due, tuple)
        self.assertEqual(len(due), 1)
        warning = due[0]
        self.assertIsInstance(warning, PairingLink)
        self.assertEqual(warning.owner_id, OWNER)
        self.assertEqual(warning.phone_id, PHONE)
        self.assertEqual(warning.generation, link.generation)
        self.assertEqual(warning.last_human_activity_at, link.last_human_activity_at)
        self.assertEqual(warning.idle_expires_at, link.idle_expires_at)
        self.assertTrue(warning.warning_issued)
        with self.assertRaises(FrozenInstanceError):
            warning.generation = 0
        # The reservation is shared with the individual predicate: neither path
        # can spend the same warning window twice.
        self.assertEqual(registry.due_warnings(), ())
        self.assertFalse(registry.warning_due(PHONE, link.generation))

    def test_due_warnings_never_renews_the_human_activity_window(self):
        registry = self.registry()
        link = self.pair(registry)
        self.now[0] = link.idle_expires_at - 60.0
        self.assertEqual(len(registry.due_warnings()), 1)
        current = registry.phone_link(PHONE)
        self.assertEqual(current.last_human_activity_at, link.last_human_activity_at)
        self.assertEqual(current.idle_expires_at, link.idle_expires_at)
        self.assertTrue(current.warning_issued)

    def test_due_warnings_is_empty_at_expiry_and_purges_the_link(self):
        registry = self.registry()
        link = self.pair(registry)
        self.now[0] = link.idle_expires_at
        self.assertEqual(registry.due_warnings(), ())
        self.assertIsNone(registry.owner_link(OWNER))
        self.assertIsNone(registry.phone_link(PHONE))
        self.assertEqual(registry._links, {})

    def test_due_warnings_marks_only_the_links_whose_window_is_due(self):
        registry = self.registry()
        first = self.pair(registry)
        second = self.pair(registry, owner=OWNER2, phone=PHONE2)
        self.now[0] = 1500.0
        registry.human_touch(PHONE2, second.generation)
        self.now[0] = first.idle_expires_at - 60.0
        due = registry.due_warnings()
        self.assertEqual([item.owner_id for item in due], [OWNER])
        self.assertEqual(registry.due_warnings(), ())
        self.assertTrue(registry.phone_link(PHONE).warning_issued)
        self.assertFalse(registry.phone_link(PHONE2).warning_issued)

    def test_due_warnings_covers_independent_pairs_once(self):
        registry = self.registry()
        first = self.pair(registry)
        self.pair(registry, owner=OWNER2, phone=PHONE2)
        self.now[0] = first.idle_expires_at - 60.0
        due = registry.due_warnings()
        self.assertEqual({item.owner_id for item in due}, {OWNER, OWNER2})
        self.assertEqual(len(due), 2)
        self.assertEqual(registry.due_warnings(), ())

    def test_individual_warning_due_reserves_before_the_batch_sweep(self):
        registry = self.registry()
        link = self.pair(registry)
        self.now[0] = link.idle_expires_at - 60.0
        self.assertTrue(registry.warning_due(PHONE, link.generation))
        self.assertEqual(registry.due_warnings(), ())

    def test_a_human_touch_opens_a_new_warnable_window_for_the_sweep(self):
        registry = self.registry()
        link = self.pair(registry)
        self.now[0] = link.idle_expires_at - 60.0
        self.assertEqual(len(registry.due_warnings()), 1)
        touched = registry.human_touch(PHONE, link.generation)
        self.assertFalse(touched.warning_issued)
        self.now[0] = touched.idle_expires_at - 60.0
        again = registry.due_warnings()
        self.assertEqual(len(again), 1)
        self.assertEqual(again[0].last_human_activity_at, touched.last_human_activity_at)
        self.assertEqual(again[0].idle_expires_at, touched.idle_expires_at)
        self.assertEqual(registry.due_warnings(), ())

    def _race(self, first, second):
        barrier = threading.Barrier(3)
        results = []
        worker_errors = []
        cleanup_errors = []
        body_error = None

        def run(index, call):
            try:
                try:
                    barrier.wait(5)
                except BrokenBarrierError:
                    # Only a wait broken by an existing failure is unwind.
                    if body_error is not None or worker_errors:
                        return
                    raise
                try:
                    results.append(call())
                except ChannelAPairingError as error:
                    results.append(str(error))
            except BaseException as error:
                worker_errors.append((index, error))
                # Release MAIN and the other worker even during a main join.
                try:
                    barrier.abort()
                except BaseException as abort_error:
                    cleanup_errors.append((f"worker {index} abort", abort_error))

        threads = [
            threading.Thread(target=run, args=(index, call))
            for index, call in enumerate((first, second))
        ]
        try:
            for thread in threads:
                thread.start()
            try:
                barrier.wait(5)
            except BrokenBarrierError:
                # A worker's abort can release MAIN without a new body fault.
                # Launch exceptions never pass through this wait-only handler.
                if not worker_errors:
                    raise
        except BaseException as error:
            body_error = error
        finally:
            started = [(index, thread) for index, thread in enumerate(threads) if thread.ident is not None]
            if started and (body_error is not None or worker_errors):
                try:
                    barrier.abort()
                except BaseException as error:
                    cleanup_errors.append(("main abort", error))
            for index, thread in started:
                try:
                    thread.join(5)
                except BaseException as error:
                    cleanup_errors.append((f"worker {index} join", error))
            survivors = []
            for index, thread in started:
                try:
                    if thread.is_alive():
                        survivors.append(index)
                except BaseException as error:
                    cleanup_errors.append((f"worker {index} liveness", error))

        if body_error is not None and not worker_errors and not cleanup_errors and not survivors:
            raise body_error
        causes = []
        if body_error is not None:
            causes.append(f"body: {type(body_error).__name__}: {body_error}")
        causes.extend(f"worker {index}: {type(error).__name__}: {error}" for index, error in worker_errors)
        causes.extend(f"{operation}: {type(error).__name__}: {error}" for operation, error in cleanup_errors)
        if survivors:
            causes.append(f"liveness: workers still alive: {survivors}")
        if causes:
            self.fail("; ".join(causes))
        return results

    def test_concurrent_batch_and_individual_reserve_once(self):
        registry = self.registry()
        link = self.pair(registry)
        self.now[0] = link.idle_expires_at - 60.0
        results = self._race(
            lambda: len(registry.due_warnings()),
            lambda: 1 if registry.warning_due(PHONE, link.generation) else 0,
        )
        self.assertEqual(sorted(results), [0, 1])
        self.assertEqual(registry.due_warnings(), ())

    def test_concurrent_batch_sweeps_reserve_once(self):
        registry = self.registry()
        link = self.pair(registry)
        self.now[0] = link.idle_expires_at - 60.0
        results = self._race(
            lambda: len(registry.due_warnings()),
            lambda: len(registry.due_warnings()),
        )
        self.assertEqual(sorted(results), [0, 1])
        self.assertEqual(registry.due_warnings(), ())

    def test_due_warnings_rejects_a_regressing_clock_without_reserving(self):
        registry = self.registry()
        self.pair(registry)
        self.pair(registry, owner=OWNER2, phone=PHONE2)
        self.now[0] = 1500.0
        self.assertEqual(registry.due_warnings(), ())
        self.now[0] = 1499.0
        self.assert_error(ChannelAPairingConfigInvalid, PRISMA_CHANNEL_A_CLOCK_INVALID, registry.due_warnings)
        self.assertEqual(len(registry._links), 2)
        self.assertFalse(registry._links[OWNER].warning_issued)
        self.assertFalse(registry._links[OWNER2].warning_issued)

    def test_due_warnings_fails_closed_on_an_unusable_clock(self):
        registry = self.registry()
        self.pair(registry)
        registry.clock = lambda: float("nan")
        self.assert_error(ChannelAPairingConfigInvalid, PRISMA_CHANNEL_A_CLOCK_INVALID, registry.due_warnings)
        self.assertEqual(len(registry._links), 1)
        self.assertFalse(registry._links[OWNER].warning_issued)


class ChannelAPairingOwnerStateTests(ChannelAPairingTestCase):
    """RCA-5l additive read-only owner-state projection for the QR/status view.

    ``owner_state(owner_id)`` returns ``free | pending | linked`` for the
    existing registry state. It is a technical observation like
    ``owner_link``: under the same lock, sampling the same validated clock and
    purging the same expirations, but never minting a challenge, never
    touching a human-activity deadline and never creating state.
    """

    def test_owner_state_projects_free_pending_and_linked_per_owner(self):
        registry = self.registry()
        self.assertEqual(registry.owner_state(OWNER), "free")
        self.assertEqual(registry.owner_state(OWNER2), "free")

        self.claim(registry)
        self.assertEqual(registry.owner_state(OWNER), "pending")
        self.assertEqual(registry.owner_state(OWNER2), "free")

        self.pair(registry, owner=OWNER2, phone=PHONE2)
        self.assertEqual(registry.owner_state(OWNER), "pending")
        self.assertEqual(registry.owner_state(OWNER2), "linked")

        registry = self.registry()
        ticket, _pending = self.claim(registry)
        registry.confirm(ticket, PHONE)
        self.assertEqual(registry.owner_state(OWNER), "linked")
        # A live challenge or a phone reservation is not a state of its own:
        # an unrelated owner without pending claim or link stays free.
        self.assertEqual(registry.owner_state("00000000-0000-4000-8000-00000000000c"), "free")

    def test_owner_state_is_a_technical_read_that_never_mints_touches_or_extends(self):
        registry = self.registry()
        challenge = registry.issue_qr(OWNER)
        self.now[0] = challenge.expires_at - 0.001
        # Observing an owner with a live challenge stays free and never mints.
        self.assertEqual(registry.owner_state(OWNER), "free")
        self.assertEqual(registry.owner_state(OWNER2), "free")
        second = registry.issue_qr(OWNER)
        self.assertEqual(second.token, challenge.token)
        self.assertEqual(second.issued_at, 1000.0)
        self.assertEqual(second.expires_at, 1060.0)

        registry = self.registry()
        link = self.pair(registry)
        self.now[0] = link.idle_expires_at - 0.001
        self.assertEqual(registry.owner_state(OWNER), "linked")
        # The human-idle deadline is neither renewed nor advanced by the read:
        # one instant past it the owner is honestly free again.
        self.now[0] = link.idle_expires_at + 0.001
        self.assertEqual(registry.owner_state(OWNER), "free")
        self.assertIsNone(registry.owner_link(OWNER))

    def test_owner_state_fails_closed_on_an_invalid_owner_identity(self):
        registry = self.registry()
        for value in (None, "", OWNER.upper(), "not-a-uuid", OWNER + "x"):
            with self.subTest(owner=value):
                self.assert_error(
                    ChannelAPairingUnauthorized,
                    PRISMA_CHANNEL_A_IDENTITY_REQUIRED,
                    registry.owner_state,
                    value,
                )
        # The failed observations leave the registry untouched and usable.
        self.now[0] = 1001.0
        self.assertEqual(registry.owner_state(OWNER), "free")


if __name__ == "__main__":
    unittest.main()
