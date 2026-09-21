"""RCA-5f persisted policy contract; execution requires a separate verifier grant.

All filesystem effects below belong to a future test-owned temporary directory.
Production imports are lazy, after the per-case dispatch guard is installed.
Missing production modules must fail honestly, never skip or create scaffolding.
"""

from __future__ import annotations

import json
import os
import sys
import traceback
import unittest
from dataclasses import FrozenInstanceError
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

INVALID = "PRISMA_CHANNEL_A_CONFIGURATION_INVALID"
UNAVAILABLE = "PRISMA_CHANNEL_A_CONFIGURATION_UNAVAILABLE"
CANARY = "owned-path-and-token-canary-not-for-errors"
MAX_GENERATION = 2**53 - 1


class ChannelAConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.dispatches = []

        def refuse(*args, **kwargs):
            self.dispatches.append(1)
            raise RuntimeError("OFFLINE_DISPATCH_REFUSED")

        guard = patch.object(requests.Session, "request", refuse)
        guard.start()
        self.addCleanup(guard.stop)
        self.addCleanup(self.assertEqual, self.dispatches, [])
        # Only a separately authorized verifier may execute this sandbox setup.
        sandbox = TemporaryDirectory(prefix="channel-a-configuration-")
        self.addCleanup(sandbox.cleanup)
        self.root = Path(sandbox.name)
        self.path = self.root / "configuration.json"
        from prisma_runtime.channel_a_configuration import (
            ChannelAConfiguration,
            ChannelAConfigurationError,
            ChannelAConfigurationStore,
        )

        self.Snapshot = ChannelAConfiguration
        self.Error = ChannelAConfigurationError
        self.Store = ChannelAConfigurationStore

    def write_document(self, **changes):
        document = {"version": 1, "warningLeadSeconds": 60, "desiredGeneration": 0}
        document.update(changes)
        self.path.write_text(json.dumps(document), encoding="utf-8")

    def assert_error(self, code, operation):
        with self.assertRaises(self.Error) as caught:
            operation()
        self.assertIsInstance(caught.exception, RuntimeError)
        self.assertEqual(str(caught.exception), code)
        self.assertNotIn(CANARY, repr(caught.exception))
        self.assertNotIn(CANARY, "".join(traceback.format_exception(caught.exception)))
        return caught.exception

    def test_constructor_is_inert_even_with_missing_parent(self):
        target = self.root / "caller-has-not-created-parent" / "policy.json"
        attempts = []

        def refuse_io(*args, **kwargs):
            attempts.append(1)
            raise OSError(CANARY)

        with patch.object(Path, "open", refuse_io), patch("builtins.open", refuse_io), patch.object(os, "open", refuse_io):
            store = self.Store(target)
        self.assertIsNotNone(store)
        self.assertEqual(attempts, [])
        self.assertFalse(target.parent.exists())
        self.assertEqual(list(self.root.iterdir()), [])

    def test_missing_read_is_immutable_default_without_backfill(self):
        snapshot = self.Store(self.path).read()
        self.assertIsInstance(snapshot, self.Snapshot)
        self.assertEqual((snapshot.warning_lead_seconds, snapshot.desired_generation), (60, 0))
        with self.assertRaises((FrozenInstanceError, AttributeError)):
            snapshot.warning_lead_seconds = 15
        with self.assertRaises((FrozenInstanceError, AttributeError)):
            snapshot.desired_generation = 1
        self.assertFalse(self.path.exists())
        self.assertEqual(list(self.root.iterdir()), [])

    def test_inclusive_bounds_round_trip_strict_version_one_document(self):
        store = self.Store(self.path)
        for generation, warning in enumerate((15, 300), start=1):
            with self.subTest(warning=warning):
                snapshot = store.set_warning_lead(warning)
                self.assertIsInstance(snapshot, self.Snapshot)
                self.assertEqual((snapshot.warning_lead_seconds, snapshot.desired_generation), (warning, generation))
                self.assertEqual(self.Store(self.path).read(), snapshot)
                self.assertEqual(json.loads(self.path.read_text(encoding="utf-8")), {
                    "version": 1,
                    "warningLeadSeconds": warning,
                    "desiredGeneration": generation,
                })
        self.assertEqual(set(self.root.iterdir()), {self.path})

    def test_unchanged_policy_neither_writes_nor_advances_generation(self):
        store = self.Store(self.path)
        self.assertEqual(store.set_warning_lead(60), self.Snapshot(60, 0))
        self.assertFalse(self.path.exists())
        store.set_warning_lead(90)
        before = self.path.read_bytes()
        writes = []

        def refuse_replace(*args, **kwargs):
            writes.append(1)
            raise OSError(CANARY)

        with patch.object(os, "replace", refuse_replace):
            self.assertEqual(store.set_warning_lead(90), self.Snapshot(90, 1))
        self.assertEqual(writes, [])
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(set(self.root.iterdir()), {self.path})

    def test_invalid_policy_values_have_zero_effects(self):
        store = self.Store(self.path)
        for value in (True, False, 15.0, 60.0, 14, 301, "60", None):
            with self.subTest(value=value):
                self.assert_error(INVALID, lambda: store.set_warning_lead(value))
                self.assertFalse(self.path.exists())
        self.write_document(desiredGeneration=7)
        before = self.path.read_bytes()
        self.assert_error(INVALID, lambda: store.set_warning_lead(301))
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(store.read(), self.Snapshot(60, 7))

    def test_reservations_persist_and_do_not_change_policy(self):
        store = self.Store(self.path)
        for generation in (1, 2, 3):
            self.assertEqual(store.advance_generation(), self.Snapshot(60, generation))
            self.assertEqual(self.Store(self.path).read(), self.Snapshot(60, generation))
        self.assertEqual(store.set_warning_lead(60), self.Snapshot(60, 3))

    def test_strict_document_rejects_wrong_types_ranges_and_extra_keys(self):
        invalid_documents = [
            {"version": True}, {"version": 1.0}, {"version": 2},
            {"warningLeadSeconds": True}, {"warningLeadSeconds": 60.0},
            {"warningLeadSeconds": 14}, {"warningLeadSeconds": 301},
            {"desiredGeneration": True}, {"desiredGeneration": 0.0},
            {"desiredGeneration": -1}, {"desiredGeneration": MAX_GENERATION + 1},
            {"unexpected": CANARY},
        ]
        store = self.Store(self.path)
        for changes in invalid_documents:
            with self.subTest(changes=changes):
                self.write_document(**changes)
                before = self.path.read_bytes()
                self.assert_error(INVALID, store.read)
                self.assert_error(INVALID, store.advance_generation)
                self.assert_error(INVALID, lambda: store.set_warning_lead(90))
                self.assertEqual(self.path.read_bytes(), before)
                self.assertEqual(set(self.root.iterdir()), {self.path})

    def test_corrupt_and_incomplete_documents_never_fall_back_or_overwrite(self):
        for raw in ("{", "[]", "null", "{}", '{"version":1,"warningLeadSeconds":60}', "\ufffd" + CANARY):
            with self.subTest(raw=raw):
                self.path.write_text(raw, encoding="utf-8")
                before = self.path.read_bytes()
                store = self.Store(self.path)
                self.assert_error(INVALID, store.read)
                self.assert_error(INVALID, store.advance_generation)
                self.assertEqual(self.path.read_bytes(), before)

    def test_generation_limit_is_readable_but_cannot_overflow(self):
        self.write_document(desiredGeneration=MAX_GENERATION)
        store = self.Store(self.path)
        before = self.path.read_bytes()
        self.assertEqual(store.read(), self.Snapshot(60, MAX_GENERATION))
        self.assertEqual(store.set_warning_lead(60), self.Snapshot(60, MAX_GENERATION))
        self.assert_error(INVALID, store.advance_generation)
        self.assert_error(INVALID, lambda: store.set_warning_lead(90))
        self.assertEqual(self.path.read_bytes(), before)

    def test_unavailable_path_is_not_reported_as_absent(self):
        self.path.mkdir()
        store = self.Store(self.path)
        self.assert_error(UNAVAILABLE, store.read)
        self.assert_error(UNAVAILABLE, store.advance_generation)
        self.assertTrue(self.path.is_dir())

    def test_atomic_replace_failure_preserves_old_file_and_unrelated_sibling(self):
        self.write_document(warningLeadSeconds=90, desiredGeneration=4)
        sibling = self.root / "unrelated.txt"
        sibling.write_text("caller-owned", encoding="utf-8")
        before = self.path.read_bytes()
        replacements = []

        def fail_replace(source, destination, *args, **kwargs):
            source, destination = Path(source), Path(destination)
            # Observe externally after production catches the injected error.
            replacements.append((source, destination, source.exists(), self.path.read_bytes()))
            raise OSError(CANARY)

        with patch.object(os, "replace", fail_replace):
            self.assert_error(UNAVAILABLE, lambda: self.Store(self.path).set_warning_lead(120))
        self.assertEqual(len(replacements), 1)
        source, destination, existed, old_bytes = replacements[0]
        self.assertEqual(source.parent, self.path.parent)
        self.assertNotEqual(source, self.path)
        self.assertEqual(destination, self.path)
        self.assertTrue(existed)
        self.assertEqual(old_bytes, before)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(sibling.read_text(encoding="utf-8"), "caller-owned")
        self.assertEqual(set(self.root.iterdir()), {self.path, sibling})
        self.assertEqual(self.Store(self.path).read(), self.Snapshot(90, 4))


if __name__ == "__main__":
    unittest.main()
