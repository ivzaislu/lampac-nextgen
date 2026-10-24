"""Run with: python -m unittest discover -s tests -v"""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import server


class SafetyGuards(unittest.TestCase):
    def test_source_roots(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            self.assertEqual(server._path(root, "Modules/Foo/ModInit.cs"),
                             root / "Modules/Foo/ModInit.cs")
            for path in (
                "../outside", "/etc/passwd", ".git/config", "docs/secret.md",
                "Modules/../../../etc/passwd", "Modules\\Foo\\Bar.cs"
            ):
                with self.subTest(path=path):
                    with self.assertRaises(ValueError):
                        server._path(root, path)
            (root / "Modules").symlink_to(root.parent, target_is_directory=True)
            with self.assertRaises(ValueError):
                server._path(root, "Modules/outside.txt")

    def test_main_task_is_rejected(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            (root / "tasks").mkdir()
            (root / "worktrees" / "abcdef012345").mkdir(parents=True)
            (root / "tasks" / "abcdef012345.json").write_text(
                '{"branch": "main"}', encoding="utf-8")
            with patch.object(server, "ROOT", root):
                with self.assertRaises(RuntimeError):
                    server._task("abcdef012345")

    def test_meminfo_snapshot(self):
        sample = ("MemTotal:         1024000 kB\n"
                  "MemAvailable:     204800 kB\n"
                  "SwapTotal:       5242880 kB\n"
                  "SwapFree:        4096000 kB\n")
        self.assertEqual(server._memory_snapshot(sample), {
            "MemTotal_MiB": 1000, "MemAvailable_MiB": 200,
            "SwapTotal_MiB": 5120, "SwapFree_MiB": 4000,
        })

    def test_browser_mode_validation(self):
        with self.assertRaises(ValueError):
            server.vps_browser_preflight(mode="arbitrary")

    def test_remote_requires_no_credentials(self):
        with patch.object(server, "REMOTE", "https://github.com/user/fork.git"):
            server._check_remote()
        for remote in (
            "https://token@github.com/user/fork.git",
            "https://github.com.evil.test/user/fork.git",
            "file:///tmp/repo", "http://github.com/user/fork"
        ):
            with self.subTest(remote=remote), patch.object(server, "REMOTE", remote):
                with self.assertRaises(RuntimeError):
                    server._check_remote()


if __name__ == "__main__":
    unittest.main()
