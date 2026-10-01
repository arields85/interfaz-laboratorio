"""B1b: the runtime test suite must never be able to resolve a real Telegram
or Gemini token from this machine's own User-scope Windows environment (see
tests/__init__.py::scrub_ambient_token_env_vars -- B1 briefly leaked a token
fragment into tool output because a test read os.environ directly without
its own patch.dict(..., clear=True))."""

import os
import re
import sys
import unittest
from pathlib import Path

import tests as tests_package

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

# A token/key/secret-shaped env var name read directly from os.environ
# anywhere in the runtime package. Deliberately broader than the three
# known vars: a future addition that matches this shape must be added to
# tests.HERMETIC_TOKEN_ENV_VARS too, or this test fails closed instead of
# silently leaving a new leak path unscrubbed.
_TOKEN_ENV_VAR_READ = re.compile(
    r"environ(?:\.get)?\(\s*['\"]([A-Z0-9_]*(?:TOKEN|KEY|SECRET)[A-Z0-9_]*)['\"]"
)


class HermeticTokenEnvironmentTests(unittest.TestCase):
    def test_scrub_removes_every_hermetic_token_env_var(self):
        injected = {name: f"fake-{name}-value" for name in tests_package.HERMETIC_TOKEN_ENV_VARS}
        try:
            os.environ.update(injected)
            for name in injected:
                self.assertIn(name, os.environ)

            tests_package.scrub_ambient_token_env_vars()

            for name in injected:
                self.assertNotIn(name, os.environ)
        finally:
            for name in injected:
                os.environ.pop(name, None)

    def test_scrub_is_a_no_op_when_the_vars_are_already_absent(self):
        for name in tests_package.HERMETIC_TOKEN_ENV_VARS:
            os.environ.pop(name, None)

        tests_package.scrub_ambient_token_env_vars()  # must not raise

        for name in tests_package.HERMETIC_TOKEN_ENV_VARS:
            self.assertNotIn(name, os.environ)

    def test_every_token_shaped_env_var_read_by_the_runtime_is_covered(self):
        """Regression guard: a new Telegram/Gemini token, key or secret env
        var read directly from os.environ anywhere under
        src/leda_runtime must be added to HERMETIC_TOKEN_ENV_VARS too."""
        src_root = RUNTIME_ROOT / "src" / "leda_runtime"
        found: set[str] = set()
        for path in src_root.glob("*.py"):
            found.update(_TOKEN_ENV_VAR_READ.findall(path.read_text(encoding="utf-8")))

        self.assertTrue(found, "the scan found no token-shaped env vars -- check the pattern")
        missing = found - set(tests_package.HERMETIC_TOKEN_ENV_VARS)
        self.assertEqual(
            missing, set(),
            f"token-shaped env vars read by the runtime but not scrubbed for tests: {sorted(missing)}",
        )

    def test_a_real_looking_ambient_token_never_survives_into_read_telegram_config(self):
        """End-to-end: simulate what B1 hit -- a real-shaped token already
        present in the process environment before a test runs -- and prove
        the production config reader never sees it once scrubbed, exactly
        as the test package's own import-time scrub guarantees for every
        test in this suite."""
        from leda_runtime.telegram_config import read_telegram_config

        try:
            os.environ["LEDA_LOCAL_TELEGRAM_BOT_TOKEN"] = "not-a-real-token-but-shaped-like-one"
            os.environ["LEDA_LOCAL_TELEGRAM_ENABLED"] = "1"
            tests_package.scrub_ambient_token_env_vars()

            config = read_telegram_config()

            self.assertEqual(config.token, "")
        finally:
            os.environ.pop("LEDA_LOCAL_TELEGRAM_BOT_TOKEN", None)
            os.environ.pop("LEDA_LOCAL_TELEGRAM_ENABLED", None)

    def test_gemini_credential_resolver_never_sees_a_scrubbed_ambient_key(self):
        from leda_runtime.gemini_credentials import GeminiCredentialResolver, GeminiCredentialUnavailable

        try:
            os.environ["GEMINI_API_KEY"] = "not-a-real-key-but-shaped-like-one"
            tests_package.scrub_ambient_token_env_vars()

            resolver = GeminiCredentialResolver(os.environ, lambda: None)

            with self.assertRaises(GeminiCredentialUnavailable):
                resolver.resolve()
        finally:
            os.environ.pop("GEMINI_API_KEY", None)


if __name__ == "__main__":
    unittest.main()
