import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from leda_runtime.hmi_config_store import LEGACY_PRISMA_KEY_RENAMES, HmiConfigStore


def seed(path: Path, items: dict[str, str], revision: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as connection:
        connection.executescript(
            "CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL);"
            "CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL);"
        )
        connection.execute("INSERT INTO meta (id, revision) VALUES (1, ?)", (revision,))
        connection.executemany("INSERT INTO config (key, value) VALUES (?, ?)", list(items.items()))
    connection.close()


class LegacyKeyMigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "hmi-config" / "hmi-config.sqlite3"

    def test_renames_are_the_two_shared_assistant_keys(self) -> None:
        self.assertEqual(
            dict(LEGACY_PRISMA_KEY_RENAMES),
            {
                "hmi:prisma-hmi-name": "hmi:leda-hmi-name",
                "hmi:prisma-orb-visual-config": "hmi:leda-orb-visual-config",
            },
        )

    def test_copies_old_values_to_new_keys_and_bumps_the_revision_once(self) -> None:
        seed(self.path, {"hmi:prisma-hmi-name": '"Planta"', "hmi:prisma-orb-visual-config": "{}", "other": "1"}, 7)

        revision, items = HmiConfigStore(self.path).read_document()

        self.assertEqual(revision, 8)
        self.assertEqual(items, {"hmi:leda-hmi-name": '"Planta"', "hmi:leda-orb-visual-config": "{}", "other": "1"})

    def test_never_overwrites_an_existing_new_key_and_removes_the_old_one(self) -> None:
        seed(self.path, {"hmi:prisma-hmi-name": '"old"', "hmi:leda-hmi-name": '"new"'}, 3)

        revision, items = HmiConfigStore(self.path).read_document()

        self.assertEqual(items, {"hmi:leda-hmi-name": '"new"'})
        self.assertEqual(revision, 4)

    def test_is_idempotent_across_store_instances(self) -> None:
        seed(self.path, {"hmi:prisma-hmi-name": '"Planta"'}, 1)

        HmiConfigStore(self.path).read_document()
        revision, items = HmiConfigStore(self.path).read_document()

        self.assertEqual(revision, 2)
        self.assertEqual(items, {"hmi:leda-hmi-name": '"Planta"'})

    def test_leaves_revision_untouched_without_legacy_keys(self) -> None:
        seed(self.path, {"hmi:leda-hmi-name": '"x"'}, 5)

        self.assertEqual(HmiConfigStore(self.path).read_document(), (5, {"hmi:leda-hmi-name": '"x"'}))

    def test_fresh_database_stays_at_revision_zero(self) -> None:
        self.assertEqual(HmiConfigStore(self.path).read_document(), (0, {}))


if __name__ == "__main__":
    unittest.main()
