import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
import json
import build_data as build


class JsonRetryTests(unittest.TestCase):
    def run_request(self, responses):
        with patch.object(build, "_get", side_effect=responses) as fetch, \
                patch.object(build.time, "sleep") as sleep:
            result = build._get_json("https://example.test/weather")
        return result, fetch.call_count, sleep.call_count

    def test_invalid_json_then_success(self):
        result, calls, sleeps = self.run_request([b"", b"<html>down</html>", b'{"daily": {}}'])
        self.assertEqual(result, {"daily": {}})
        self.assertEqual((calls, sleeps), (3, 2))

    def test_transient_network_and_rate_limit(self):
        result, calls, sleeps = self.run_request([
            URLError("timeout"), HTTPError("url", 429, "rate limit", {}, None), b"[]"])
        self.assertEqual(result, [])
        self.assertEqual((calls, sleeps), (3, 2))

    def test_persistent_failure_is_not_hidden(self):
        with patch.object(build, "_get", return_value=b"") as fetch, \
                patch.object(build.time, "sleep"):
            with self.assertRaises(json.JSONDecodeError):
                build._get_json("https://example.test/weather")
            self.assertEqual(fetch.call_count, 4)

    def test_bad_request_is_not_retried(self):
        with patch.object(build, "_get", side_effect=HTTPError("url", 400, "bad request", {}, None)) as fetch:
            with self.assertRaises(HTTPError):
                build._get_json("https://example.test/weather")
            self.assertEqual(fetch.call_count, 1)


if __name__ == "__main__":
    unittest.main()
