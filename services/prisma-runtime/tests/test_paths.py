import os
import unittest
from pathlib import Path
from unittest.mock import patch


RUNTIME_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = RUNTIME_ROOT / "src"


class RuntimePathTests(unittest.TestCase):
    def test_default_state_is_outside_the_repository(self) -> None:
        with patch.dict(os.environ, {"LOCALAPPDATA": r"C:\Users\test\AppData\Local"}, clear=True):
            import sys

            sys.path.insert(0, str(SOURCE_ROOT))
            try:
                from prisma_runtime.paths import runtime_paths

                paths = runtime_paths()
            finally:
                sys.path.pop(0)

        self.assertEqual(paths.root, Path(r"C:\Users\test\AppData\Local\CoreAnalytics\Prisma"))
        self.assertNotEqual(paths.root, RUNTIME_ROOT)
        self.assertEqual(paths.voice_config.name, "prisma_voice_config.json")
        self.assertEqual(paths.snapshot.name, "prisma_local_snapshot.json")
        self.assertEqual(paths.chat_state.name, "prisma_local_state.json")

    def test_explicit_state_directory_controls_all_mutable_files(self) -> None:
        with patch.dict(os.environ, {"PRISMA_RUNTIME_STATE_DIR": r"D:\PrismaState"}, clear=True):
            import sys

            sys.path.insert(0, str(SOURCE_ROOT))
            try:
                from prisma_runtime.paths import runtime_paths

                paths = runtime_paths()
            finally:
                sys.path.pop(0)

        self.assertEqual(paths.root, Path(r"D:\PrismaState"))
        self.assertTrue(all(path.parent == paths.root for path in paths.mutable_files))


if __name__ == "__main__":
    unittest.main()
