import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
RUNTIME_ROOT = REPOSITORY_ROOT / "services" / "prisma-runtime"


class PrismaRuntimeSkeletonTests(unittest.TestCase):
    def test_repository_runtime_is_owned_by_the_monorepo(self) -> None:
        expected_directories = (
            RUNTIME_ROOT / "src" / "prisma_runtime",
            RUNTIME_ROOT / "tests",
            RUNTIME_ROOT / "operations",
        )
        for directory in expected_directories:
            with self.subTest(directory=directory):
                self.assertTrue(directory.is_dir(), f"Missing owned directory: {directory}")

        self.assertTrue(
            (RUNTIME_ROOT / "src" / "prisma_runtime" / "__init__.py").is_file()
        )
        self.assertTrue((RUNTIME_ROOT / "tests" / "__init__.py").is_file())
        self.assertTrue((RUNTIME_ROOT / "operations" / "start-local.ps1").is_file())
        self.assertTrue((RUNTIME_ROOT / "operations" / "stop-local.ps1").is_file())
        self.assertTrue((RUNTIME_ROOT / "operations" / "bootstrap-local.ps1").is_file())
        self.assertTrue((RUNTIME_ROOT / "operations" / "verify-local.ps1").is_file())


if __name__ == "__main__":
    unittest.main()
