import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from leda_runtime.admin_http import AdminHttpBoundary
from leda_runtime.copy_register import (
    COPY_REGISTER_KEY,
    DEFAULT_COPY_REGISTER,
    HMI_CONFIG_INVALID_COPY_REGISTER,
    parse_copy_register,
    read_copy_register,
)
from leda_runtime.hmi_config_store import HmiConfigInvalid, HmiConfigStore, HmiConfigUnavailable
from leda_runtime.local_presentation import JsonFileStore, VoiceEventStore, create_app

WRITE_ROUTE = "/api/leda/admin/hmi-config"


def encoded(register, version=1):
    return json.dumps({"version": version, "register": register})


class ParseCopyRegisterTests(unittest.TestCase):
    def test_accepts_the_three_registers(self) -> None:
        for register in ("usted", "rioplatense", "neutro"):
            with self.subTest(register=register):
                self.assertEqual(parse_copy_register(encoded(register)), register)

    def test_everything_else_falls_back_to_usted(self) -> None:
        invalid = (
            None,
            "",
            "{",
            "null",
            "[]",
            '"neutro"',
            encoded("voseo"),
            encoded("Neutro"),
            encoded(None),
            encoded(1),
            encoded("neutro", version=2),
            encoded("neutro", version=True),
            encoded("neutro", version="1"),
            json.dumps({"register": "neutro"}),
            json.dumps({"version": 1}),
            json.dumps({"version": 1, "register": "neutro", "extra": 1}),
        )
        for raw in invalid:
            with self.subTest(raw=raw):
                self.assertEqual(parse_copy_register(raw), DEFAULT_COPY_REGISTER)
        self.assertEqual(DEFAULT_COPY_REGISTER, "usted")


class ReadCopyRegisterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.store = HmiConfigStore(Path(self.temporary.name) / "hmi-config.sqlite3")

    def test_defaults_to_usted_when_unset(self) -> None:
        self.assertEqual(read_copy_register(self.store), "usted")

    def test_reads_the_stored_register(self) -> None:
        self.store.apply_batch({COPY_REGISTER_KEY: encoded("rioplatense")}, [])
        self.assertEqual(read_copy_register(self.store), "rioplatense")

    def test_malformed_stored_value_falls_back_to_usted(self) -> None:
        self.store.apply_batch({"hmi:other": "x"}, [])
        self.assertEqual(read_copy_register(self.store), "usted")

    def test_unavailable_store_falls_back_to_usted(self) -> None:
        store = Mock()
        store.read_document.side_effect = HmiConfigUnavailable("HMI_CONFIG_UNAVAILABLE")
        self.assertEqual(read_copy_register(store), "usted")


class CopyRegisterWriteValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.store = HmiConfigStore(root / "hmi-config.sqlite3")

    def test_store_accepts_each_register_and_unrelated_keys(self) -> None:
        for register in ("usted", "rioplatense", "neutro"):
            with self.subTest(register=register):
                self.store.apply_batch({COPY_REGISTER_KEY: encoded(register), "hmi:other": "free text"}, [])
                self.assertEqual(read_copy_register(self.store), register)
        self.assertEqual(self.store.read_document()[1]["hmi:other"], "free text")

    def test_store_rejects_invalid_values_atomically(self) -> None:
        self.store.apply_batch({"hmi:a": "1"}, [])
        for value in ("{", encoded("voseo"), encoded("neutro", version=2), json.dumps({"register": "neutro"}), "usted"):
            with self.subTest(value=value):
                with self.assertRaises(HmiConfigInvalid) as raised:
                    self.store.apply_batch({"hmi:b": "2", COPY_REGISTER_KEY: value}, [])
                self.assertEqual(raised.exception.args[0], HMI_CONFIG_INVALID_COPY_REGISTER)
        self.assertEqual(self.store.read_document(), (1, {"hmi:a": "1"}))

    def test_deleting_the_key_is_allowed(self) -> None:
        self.store.apply_batch({COPY_REGISTER_KEY: encoded("neutro")}, [])
        self.store.apply_batch({}, [COPY_REGISTER_KEY])
        self.assertEqual(read_copy_register(self.store), "usted")

    def test_put_route_returns_the_stable_code(self) -> None:
        auth = Mock()
        auth.read_session.return_value = SimpleNamespace(csrf_token="csrf-token", username="admin")
        root = Path(self.temporary.name)
        client = create_app(
            JsonFileStore(root / "snapshot.json"),
            VoiceEventStore(),
            None,
            admin_http=AdminHttpBoundary(auth, hmi_config_store=self.store),
        ).test_client()
        client.set_cookie("leda_admin_session", "session-id", path="/api/leda/admin")
        environ = {"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "localhost"}
        headers = {"Origin": "http://localhost:5173", "X-CSRF-Token": "csrf-token"}

        rejected = client.put(
            WRITE_ROUTE, json={"set": {COPY_REGISTER_KEY: encoded("voseo")}}, headers=headers, environ_overrides=environ
        )
        self.assertEqual(rejected.status_code, 400)
        self.assertEqual(rejected.get_json(), {"ok": False, "error": HMI_CONFIG_INVALID_COPY_REGISTER})
        self.assertEqual(self.store.read_revision(), 0)

        accepted = client.put(
            WRITE_ROUTE, json={"set": {COPY_REGISTER_KEY: encoded("neutro")}}, headers=headers, environ_overrides=environ
        )
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(read_copy_register(self.store), "neutro")


if __name__ == "__main__":
    unittest.main()
