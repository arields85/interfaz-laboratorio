import logging
import sys
import unittest
from pathlib import Path

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime.access_log_redaction import (
    QueryStringRedactingFilter,
    install_access_log_query_redaction,
)


def _werkzeug_record(requestline: str, code: str = "200", size: str = "512") -> logging.LogRecord:
    """Mirrors exactly what Werkzeug's WSGIRequestHandler.log_request()
    hands to the "werkzeug" logger: a fixed '"%s" %s %s' message with
    (requestline, code, size) as record.args -- requestline itself shaped
    like "<METHOD> <PATH[?QUERY]> <PROTOCOL>"."""
    return logging.LogRecord(
        name="werkzeug", level=logging.INFO, pathname=__file__, lineno=1,
        msg='"%s" %s %s', args=(requestline, code, size), exc_info=None,
    )


class QueryStringRedactingFilterTests(unittest.TestCase):
    def test_redacts_the_query_string_but_keeps_method_path_protocol(self) -> None:
        record = _werkzeug_record("GET /hmi/voice/events?capability=super-secret-value HTTP/1.1")

        self.assertTrue(QueryStringRedactingFilter().filter(record))

        message = record.getMessage()
        self.assertNotIn("super-secret-value", message)
        self.assertIn('"GET /hmi/voice/events?[REDACTED] HTTP/1.1"', message)
        self.assertIn("200", message)
        self.assertIn("512", message)

    def test_leaves_a_request_line_without_a_query_string_untouched(self) -> None:
        record = _werkzeug_record("GET /health HTTP/1.1")

        self.assertTrue(QueryStringRedactingFilter().filter(record))

        self.assertEqual(record.getMessage(), '"GET /health HTTP/1.1" 200 512')

    def test_never_drops_a_record_it_cannot_parse(self) -> None:
        # Empty args, a non-string first arg, and a first arg that doesn't
        # look like a request line must all pass through unredacted rather
        # than crash or suppress the log entry.
        for record in (
            logging.LogRecord(name="werkzeug", level=logging.INFO, pathname=__file__, lineno=1, msg="starting up", args=(), exc_info=None),
            logging.LogRecord(name="werkzeug", level=logging.INFO, pathname=__file__, lineno=1, msg="%s", args=(42,), exc_info=None),
            logging.LogRecord(name="werkzeug", level=logging.INFO, pathname=__file__, lineno=1, msg="%s", args=("not a request line",), exc_info=None),
        ):
            with self.subTest(args=record.args):
                self.assertTrue(QueryStringRedactingFilter().filter(record))

    def test_redacts_a_query_string_containing_further_ampersands_and_equals(self) -> None:
        record = _werkzeug_record("GET /hmi/voice/events?capability=abc&next=1 HTTP/1.1")

        QueryStringRedactingFilter().filter(record)

        message = record.getMessage()
        self.assertNotIn("abc", message)
        self.assertNotIn("next=1", message)
        self.assertIn('"GET /hmi/voice/events?[REDACTED] HTTP/1.1"', message)


class InstallAccessLogQueryRedactionTests(unittest.TestCase):
    def setUp(self):
        self.logger = logging.getLogger("werkzeug")
        for existing in list(self.logger.filters):
            if isinstance(existing, QueryStringRedactingFilter):
                self.logger.removeFilter(existing)
        self.addCleanup(lambda: [
            self.logger.removeFilter(f) for f in list(self.logger.filters) if isinstance(f, QueryStringRedactingFilter)
        ])

    def test_installs_exactly_one_filter_even_when_called_twice(self) -> None:
        install_access_log_query_redaction()
        install_access_log_query_redaction()

        installed = [f for f in self.logger.filters if isinstance(f, QueryStringRedactingFilter)]
        self.assertEqual(len(installed), 1)

    def test_redacts_a_real_werkzeug_style_log_line_end_to_end(self) -> None:
        install_access_log_query_redaction()

        with self.assertLogs("werkzeug", level="INFO") as captured:
            self.logger.info('"%s" %s %s', "GET /hmi/voice/events?capability=super-secret-value HTTP/1.1", "200", "512")

        self.assertEqual(len(captured.records), 1)
        message = captured.records[0].getMessage()
        self.assertNotIn("super-secret-value", message)
        self.assertIn("GET /hmi/voice/events?[REDACTED] HTTP/1.1", message)


if __name__ == "__main__":
    unittest.main()
