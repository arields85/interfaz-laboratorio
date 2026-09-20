"""Cooperative process-local exclusion of observed Telegram bot identities.

This registry is the single decision point that keeps Channel A and Channel B
from running the same observed bot and from overwriting each other's live
authority. These tests pin the fixed public error code, exact-epoch reentry,
the non-stealing guarantee for a different epoch with the same label, the no-op
rule for stale or foreign releases, identity-only comparison, immutable lease
records, a non-releasable inspection view, exact built-in identifier keys,
no-op forged or subclass release handles and the shared process accessor.
"""

import sys
import threading
import unittest
from pathlib import Path


RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime.bot_identity_reservation import (
    TELEGRAM_BOT_IDENTITY_RESERVED,
    BotIdentityLease,
    BotIdentityOccupancy,
    BotIdentityReservation,
    BotIdentityReservationError,
    process_bot_identity_reservation,
)

# External proof that a rejection happened before any caller callback ran.
HOSTILE_CALLBACKS: list[str] = []


class HostileIdentity:
    """Owner/epoch probe: any equality or hashing attempt fails loudly."""

    def __eq__(self, other):
        raise AssertionError("authority must never compare opaque identities by equality")

    def __hash__(self):
        raise AssertionError("authority must never hash opaque identities")


class HostileInt(int):
    """Identifier probe: any equality, hashing or conversion attempt fails loudly.

    A leaf-lock dictionary lookup on this key would run it while the registry
    lock is held, so the key must be rejected before any comparison, conversion,
    hash or lock. Every hook also records that it ran, so a test can prove the
    callback was never reached even when the reason it exists is invisible.
    """

    def __eq__(self, other):
        HOSTILE_CALLBACKS.append("__eq__")
        raise AssertionError("identifier keys must never compare by equality")

    def __hash__(self):
        HOSTILE_CALLBACKS.append("__hash__")
        raise AssertionError("identifier keys must never hash")

    def __index__(self):
        HOSTILE_CALLBACKS.append("__index__")
        raise AssertionError("identifier keys must never be converted")

    def __int__(self):
        HOSTILE_CALLBACKS.append("__int__")
        raise AssertionError("identifier keys must never be converted")


class HookedLease(BotIdentityLease):
    """Lease subclass whose identifier attribute is itself a callback hook.

    ``isinstance`` accepts it, so a release path that only checks the base type
    would read ``bot_id`` and run this property while the registry lock is held.
    Built through ``__new__``: the read-only property makes the generated
    ``__init__`` unusable, and the hook must never need a working constructor to
    be a hazard.
    """

    @property
    def bot_id(self):
        HOSTILE_CALLBACKS.append("lease.bot_id")
        raise AssertionError("a lease subclass attribute must never run under the lock")


class FakeLeaseLike:
    """Duck-typed impostor: shaped like a lease but never one."""

    def __init__(self, bot_id=123):
        self.bot_id = bot_id
        self.owner = object()
        self.epoch = object()


def acquire_in_thread(reservation, bot_id, outcomes):
    try:
        outcomes.append(reservation.acquire(bot_id, owner=object(), epoch=object()))
    except BotIdentityReservationError as error:
        outcomes.append(error)


class BotIdentityReservationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.reservation = BotIdentityReservation()
        self.owner = object()
        self.epoch = object()

    def live_lease(self, bot_id=123) -> BotIdentityLease:
        """Prove which lease is live by exact idempotent reentry.

        Inspection deliberately never hands back the releasable handle, so the
        only authority-preserving way to prove which lease is live is to re-enter
        acquisition with the same exact owner and epoch.
        """
        return self.reservation.acquire(bot_id, owner=self.owner, epoch=self.epoch)

    def test_first_acquisition_creates_a_lease_and_exact_reentry_returns_it(self) -> None:
        lease = self.reservation.acquire(123, owner=self.owner, epoch=self.epoch)

        self.assertIsInstance(lease, BotIdentityLease)
        self.assertEqual(lease.bot_id, 123)
        self.assertIs(lease.owner, self.owner)
        self.assertIs(lease.epoch, self.epoch)
        self.assertIs(self.live_lease(), lease)
        view = self.reservation.held_by(123)
        self.assertIsNotNone(view)
        self.assertEqual(view.bot_id, 123)
        self.assertNotIsInstance(view, BotIdentityLease)

    def test_same_label_with_a_new_epoch_cannot_steal_live_authority(self) -> None:
        lease = self.reservation.acquire(123, owner=self.owner, epoch=self.epoch)

        with self.assertRaises(BotIdentityReservationError) as raised:
            self.reservation.acquire(123, owner=self.owner, epoch=object())

        self.assertEqual(str(raised.exception), TELEGRAM_BOT_IDENTITY_RESERVED)
        self.assertIs(self.live_lease(), lease)

    def test_a_different_owner_cannot_steal_even_with_the_same_epoch_token(self) -> None:
        lease = self.reservation.acquire(123, owner=self.owner, epoch=self.epoch)

        with self.assertRaises(BotIdentityReservationError):
            self.reservation.acquire(123, owner=object(), epoch=self.epoch)
        with self.assertRaises(BotIdentityReservationError):
            self.reservation.acquire(123, owner=object(), epoch=object())

        self.assertIs(self.live_lease(), lease)

    def test_failed_acquisition_leaves_no_partial_state_behind(self) -> None:
        first = self.reservation.acquire(123, owner=self.owner, epoch=self.epoch)

        with self.assertRaises(BotIdentityReservationError):
            self.reservation.acquire(123, owner=object(), epoch=object())

        self.assertIs(self.live_lease(), first)
        self.assertTrue(self.reservation.release(first))
        self.assertIsNone(self.reservation.held_by(123))
        replacement = self.reservation.acquire(123, owner=object(), epoch=object())
        self.assertIsNot(replacement, first)
        self.assertIs(
            self.reservation.acquire(123, owner=replacement.owner, epoch=replacement.epoch),
            replacement,
        )

    def test_foreign_stale_and_repeated_releases_are_noops(self) -> None:
        lease = self.reservation.acquire(123, owner=self.owner, epoch=self.epoch)
        foreign = BotIdentityLease(123, object(), object())

        self.assertFalse(self.reservation.release(foreign))
        self.assertFalse(self.reservation.release(None))
        self.assertIsNotNone(self.reservation.held_by(123))

        self.assertTrue(self.reservation.release(lease))
        self.assertIsNone(self.reservation.held_by(123))
        self.assertFalse(self.reservation.release(lease))

    def test_lease_records_are_immutable_and_cannot_be_retargeted(self) -> None:
        lease = self.reservation.acquire(123, owner=self.owner, epoch=self.epoch)

        for field, value in (("bot_id", 456), ("owner", object()), ("epoch", object())):
            with self.subTest(field=field):
                with self.assertRaises(AttributeError):
                    setattr(lease, field, value)

        self.assertEqual(lease.bot_id, 123)
        self.assertIs(lease.owner, self.owner)
        self.assertIs(lease.epoch, self.epoch)
        # A refused mutation must never strand the entry it could not retarget.
        self.assertTrue(self.reservation.release(lease))
        self.assertIsNone(self.reservation.held_by(123))

    def test_inspection_returns_an_immutable_non_releasable_view(self) -> None:
        lease = self.reservation.acquire(123, owner=self.owner, epoch=self.epoch)

        view = self.reservation.held_by(123)
        self.assertIsNotNone(view)
        self.assertIsNot(view, lease)
        self.assertNotIsInstance(view, BotIdentityLease)
        self.assertEqual(view.bot_id, 123)
        self.assertFalse(hasattr(view, "owner"))
        self.assertFalse(hasattr(view, "epoch"))
        with self.assertRaises(AttributeError):
            view.bot_id = 456

        self.assertFalse(self.reservation.release(view))
        self.assertIs(self.live_lease(), lease)

    def test_inspection_view_is_rebuilt_without_exposing_the_handle(self) -> None:
        self.reservation.acquire(123, owner=self.owner, epoch=self.epoch)

        first = self.reservation.held_by(123)
        second = self.reservation.held_by(123)

        self.assertIsNot(first, second)
        self.assertEqual(first.bot_id, 123)
        self.assertEqual(second.bot_id, 123)

    def test_invalid_keys_are_rejected_without_reserving_anything(self) -> None:
        for value in (0, -5, True, False, 1.5, "123", None, 2**53, 2**53 - 1 + 1):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    self.reservation.acquire(value, owner=self.owner, epoch=self.epoch)
                with self.assertRaises(ValueError):
                    self.reservation.held_by(value)

        self.assertTrue(self.reservation.acquire(2**53 - 1, owner=self.owner, epoch=self.epoch))

    def test_int_subclass_identifiers_are_rejected_before_any_hostile_callback(self) -> None:
        hostile = HostileInt(123)

        with self.assertRaises(ValueError):
            self.reservation.acquire(hostile, owner=self.owner, epoch=self.epoch)
        with self.assertRaises(ValueError):
            self.reservation.held_by(hostile)
        with self.assertRaises(ValueError):
            self.reservation.acquire(True, owner=self.owner, epoch=self.epoch)

        self.assertIsNone(self.reservation.held_by(123))

    def test_forged_lease_with_a_hostile_identifier_key_never_reaches_the_lock(self) -> None:
        self.reservation.acquire(123, owner=self.owner, epoch=self.epoch)
        HOSTILE_CALLBACKS.clear()
        forged = BotIdentityLease(HostileInt(123), object(), object())

        self.assertFalse(self.reservation.release(forged))
        for value in (True, False, 0, -5, "123", None, 1.5, 2**53):
            with self.subTest(value=value):
                self.assertFalse(self.reservation.release(BotIdentityLease(value, object(), object())))

        # A rejected key may never compare, hash or convert, and the incumbent
        # authority must be untouched by a forged handle.
        self.assertEqual(HOSTILE_CALLBACKS, [])
        self.assertIs(self.live_lease(), self.reservation.acquire(123, owner=self.owner, epoch=self.epoch))

    def test_lease_subclass_attribute_hook_is_rejected_before_any_read(self) -> None:
        lease = self.reservation.acquire(123, owner=self.owner, epoch=self.epoch)
        HOSTILE_CALLBACKS.clear()
        hooked = HookedLease.__new__(HookedLease)

        self.assertFalse(self.reservation.release(hooked))

        self.assertEqual(HOSTILE_CALLBACKS, [])
        self.assertIs(self.live_lease(), lease)

    def test_every_release_branch_rejects_handles_before_any_hostile_callback(self) -> None:
        lease = self.reservation.acquire(123, owner=self.owner, epoch=self.epoch)
        HOSTILE_CALLBACKS.clear()

        for handle in (None, 123, object(), BotIdentityOccupancy(123), FakeLeaseLike(HostileInt(123))):
            with self.subTest(handle=type(handle).__name__):
                self.assertFalse(self.reservation.release(handle))
        with self.assertRaises(ValueError):
            self.reservation.acquire(HostileInt(456), owner=object(), epoch=object())
        with self.assertRaises(ValueError):
            self.reservation.held_by(HostileInt(456))

        # Only the exact live lease is releasable; a released or stale handle stays
        # a no-op and never frees a replacement that took the identity over.
        self.assertTrue(self.reservation.release(lease))
        self.assertFalse(self.reservation.release(lease))
        replacement = self.reservation.acquire(123, owner=object(), epoch=object())
        self.assertFalse(self.reservation.release(lease))
        self.assertIs(self.reservation.acquire(123, owner=replacement.owner, epoch=replacement.epoch), replacement)
        self.assertEqual(HOSTILE_CALLBACKS, [])

    def test_authority_uses_identity_comparison_only(self) -> None:
        owner, epoch = HostileIdentity(), HostileIdentity()
        lease = self.reservation.acquire(123, owner=owner, epoch=epoch)

        self.assertIs(self.reservation.acquire(123, owner=owner, epoch=epoch), lease)
        with self.assertRaises(BotIdentityReservationError):
            self.reservation.acquire(123, owner=HostileIdentity(), epoch=epoch)
        with self.assertRaises(BotIdentityReservationError):
            self.reservation.acquire(123, owner=owner, epoch=HostileIdentity())
        self.assertTrue(self.reservation.release(lease))

    def test_conflict_error_is_fixed_and_carries_no_caller_detail(self) -> None:
        canary = "synthetic-token-canary"
        self.reservation.acquire(123, owner=self.owner, epoch=self.epoch)

        with self.assertRaises(BotIdentityReservationError) as raised:
            self.reservation.acquire(123, owner=canary, epoch=canary)

        self.assertEqual(raised.exception.args, (TELEGRAM_BOT_IDENTITY_RESERVED,))
        self.assertNotIn(canary, str(raised.exception))
        self.assertEqual(repr(raised.exception), f"BotIdentityReservationError('{TELEGRAM_BOT_IDENTITY_RESERVED}')")

    def test_concurrent_acquisition_produces_exactly_one_live_lease(self) -> None:
        barrier = threading.Barrier(2)
        outcomes = []

        def claim():
            barrier.wait(5)
            acquire_in_thread(self.reservation, 123, outcomes)

        threads = [threading.Thread(target=claim) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(5)

        self.assertFalse(any(thread.is_alive() for thread in threads))
        leases = [outcome for outcome in outcomes if isinstance(outcome, BotIdentityLease)]
        refusals = [outcome for outcome in outcomes if isinstance(outcome, BotIdentityReservationError)]
        self.assertEqual((len(leases), len(refusals)), (1, 1))
        winner = leases[0]
        self.assertIs(
            self.reservation.acquire(123, owner=winner.owner, epoch=winner.epoch),
            winner,
        )
        self.assertEqual(str(refusals[0]), TELEGRAM_BOT_IDENTITY_RESERVED)

    def test_distinct_bot_ids_reserve_independently(self) -> None:
        first = self.reservation.acquire(123, owner=self.owner, epoch=self.epoch)
        second = self.reservation.acquire(456, owner=self.owner, epoch=self.epoch)

        self.assertIsNot(first, second)
        self.assertIs(self.live_lease(123), first)
        self.assertIs(self.live_lease(456), second)

    def test_fresh_instances_are_independent_registries(self) -> None:
        other = BotIdentityReservation()

        first = self.reservation.acquire(123, owner=self.owner, epoch=self.epoch)
        second = other.acquire(123, owner=self.owner, epoch=self.epoch)

        self.assertIsNot(first, second)
        self.assertIs(self.live_lease(123), first)
        self.assertIs(other.acquire(123, owner=self.owner, epoch=self.epoch), second)

    def test_process_accessor_returns_one_shared_registry_across_threads(self) -> None:
        barrier = threading.Barrier(8)
        seen = []

        def read():
            barrier.wait(5)
            seen.append(process_bot_identity_reservation())

        threads = [threading.Thread(target=read) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(5)

        self.assertEqual(len(seen), 8)
        self.assertTrue(all(entry is seen[0] for entry in seen))
        self.assertIs(process_bot_identity_reservation(), seen[0])
        self.assertIsInstance(seen[0], BotIdentityReservation)


if __name__ == "__main__":
    unittest.main()
