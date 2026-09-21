"""Preparatory store-only delivery guard contract; no runtime activation imports."""

import gc
import unittest
import weakref

from prisma_runtime.voice_events import VoiceEventCapacity, VoiceEventStore, validate_voice_event


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
