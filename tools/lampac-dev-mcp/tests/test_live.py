"""Unit/integration tests with a local fake Lampac (no upstream streaming required)."""
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

import live_tests


class _FakeLampac(BaseHTTPRequestHandler):
    def do_GET(self):
        port = self.server.server_port
        if self.path.startswith("/lite/example?"):
            obj = {"type": "movie", "data": [
                {"method": "call", "url": f"http://127.0.0.1:{port}/lite/example/video"}]}
            content_type, data = "application/json", json.dumps(obj).encode()
        elif self.path == "/lite/example/video":
            obj = {"method": "play", "url": f"http://127.0.0.1:{port}/proxy/test.m3u8"}
            content_type, data = "application/json", json.dumps(obj).encode()
        elif self.path == "/proxy/test.m3u8":
            content_type, data = "application/vnd.apple.mpegurl", (
                b"#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:2.0,\ntest.ts\n")
        elif self.path == "/proxy/test.ts":
            content_type, data = "video/mp2t", (b"\x47" + b"\x00" * 187) * 512
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_):
        pass


class TestLive(unittest.TestCase):
    def test_navigation_and_stream_fetch(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), _FakeLampac)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.object(live_tests, "BASE", f"http://127.0.0.1:{server.server_port}"), \
                 patch.object(live_tests, "PUBLIC_BASE", ""), \
                 patch.object(live_tests, "HOSTS", ()), \
                 patch.object(live_tests.shutil, "which", return_value=None):
                report = live_tests.run_online("example", {"title": "Test"})
            self.assertEqual(report["status"], "inconclusive")
            self.assertEqual(report["steps"][-1]["stage"], "stream")
            self.assertTrue(report["steps"][-1]["sample_retrieved"])
            self.assertEqual(report["steps"][-1]["hls_manifests"], 1)
            self.assertEqual(report["steps"][-1]["bytes_sampled"], 188 * 512)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_disallow_internal_cdns(self):
        with self.assertRaises(live_tests.TestIssue) as cm:
            live_tests._authorize("http://169.254.169.254/latest/meta-data/")
        self.assertEqual(cm.exception.status, "blocked")

    def test_disallow_unlisted_domains(self):
        with patch.object(live_tests, "HOSTS", ()):
            with self.assertRaises(live_tests.TestIssue) as cm:
                live_tests._authorize("https://cdn.example.org/vid.m3u8")
        self.assertEqual(cm.exception.status, "inconclusive")

    def test_movie_response_shape(self):
        action, url, _ = live_tests._next(
            {"type": "movie", "data": [
                {"method": "call", "url": "/lite/example/video"}]})
        self.assertEqual((action, url), ("call", "/lite/example/video"))

    def test_no_arbitrary_params(self):
        with self.assertRaises(ValueError):
            live_tests.run_online("example", {"token": "SECRET"})


if __name__ == "__main__":
    unittest.main()
