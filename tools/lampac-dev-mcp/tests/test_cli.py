"""CLI validation for safe, explicit Online query fixtures."""
import unittest
from unittest.mock import patch

import probe_online


class CliTests(unittest.TestCase):
    def test_accepts_simple_fixtures(self):
        self.assertEqual(
            probe_online._params(["title=Интерстеллар", "kinopoisk_id=258687"]),
            {"title": "Интерстеллар", "kinopoisk_id": "258687"},
        )

    def test_rejects_duplicate_query_parameter(self):
        with self.assertRaises(ValueError):
            probe_online._params(["title=one", "title=two"])

    def test_rejects_empty_parameter(self):
        with self.assertRaises(ValueError):
            probe_online._params(["title="])

    def test_status_codes(self):
        import live_tests
        with patch.object(live_tests, "run_online",
                          return_value={"provider": "hdvb", "status": "inconclusive"}):
            self.assertEqual(probe_online.main([
                "--provider", "hdvb", "--param", "kinopoisk_id=258687"
            ]), 2)


if __name__ == "__main__":
    unittest.main()
