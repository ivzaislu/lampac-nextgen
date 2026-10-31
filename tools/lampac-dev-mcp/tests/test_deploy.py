"""Safety and dry-run checks for the Python 3.6 test-only deployer.

Run from tools/lampac-dev-mcp: python3 -m unittest discover -s tests -p test_deploy.py -v
No Docker daemon, credentials or network required.
"""
import contextlib
import io
import json
import os
import tempfile
import unittest
from unittest.mock import patch

import deploy_test_image as deploy


SHA = "ae72e758589903ad74689178b67db52bfb4b3198"
DIGEST = "sha256:d99cb0f96c6b3d10b8d95455dd106b37cbac0405028b5540bd3244bdd76b3105"


def receipt():
    return {
        "source_sha": SHA,
        "image": deploy.IMAGE,
        "digest": DIGEST,
        "image_ref": deploy.IMAGE + "@" + DIGEST,
        "tag_ref": deploy.IMAGE + ":sha-" + SHA,
        "platform": "linux/amd64",
        "workflow_run_id": "41222449253"
    }


def config():
    return {
        "listen": {"ip": "any", "port": 9118, "localhost": "127.0.0.1"},
        "BaseModule": {"LoadModules": ["HDVB", "Online"]},
        "lowMemoryMode": True,
        "chromium": {"enable": False},
        "HDVB": {"enable": True}
    }


def old(name="lampac-mcp-build120"):
    return {
        "Name": "/" + name,
        "Config": {"Image": deploy.IMAGE + "@" + DIGEST},
        "HostConfig": {
            "Privileged": False,
            "PortBindings": deploy.PORTS,
            "Memory": deploy.MAX_MEMORY,
            "NetworkMode": "default",
            "Binds": None
        },
        "Mounts": [],
        "State": {"Running": True}
    }


class TestDeployer(unittest.TestCase):
    def test_exact_digest_and_commit_required(self):
        self.assertEqual(deploy.validate_receipt(receipt(), SHA),
                         deploy.IMAGE + "@" + DIGEST)
        for field, invalid in [
            ("source_sha", "0" * 40),
            ("digest", "sha256:" + "0" * 63),
            ("image", "ghcr.io/other/production"),
            ("image_ref", deploy.IMAGE + ":latest"),
            ("tag_ref", deploy.IMAGE + ":latest"),
            ("platform", "linux/arm64")
        ]:
            with self.subTest(field=field):
                changed = receipt()
                changed[field] = invalid
                with self.assertRaises(deploy.DeploymentError):
                    deploy.validate_receipt(changed, SHA)
        with self.assertRaises(deploy.DeploymentError):
            deploy.validate_receipt(receipt(), "0" * 40)

    def test_only_lightweight_hdvbp_profile(self):
        self.assertTrue(deploy.validate_config(config()))
        for key, value in [
            ("lowMemoryMode", False),
            ("chromium", {"enable": True}),
            ("BaseModule", {"LoadModules": [".*"]}),
            ("BaseModule", {"LoadModules": ["Online", "HDVB", "FlixCDN"]})
        ]:
            with self.subTest(key=key, value=value):
                changed = config()
                changed[key] = value
                with self.assertRaises(deploy.DeploymentError):
                    deploy.validate_config(changed)

    def test_refuses_production_name_or_unsafe_image(self):
        self.assertTrue(deploy.verify_old_container("lampac-mcp-build120", old()))
        for name in ["production", "lampac-prod", "lampac-mcp-build120-extra"]:
            with self.subTest(name=name), self.assertRaises(deploy.DeploymentError):
                deploy.verify_old_container(name, old(name))
        altered = old()
        altered["Config"]["Image"] = "ghcr.io/owner/lampac:latest"
        with self.assertRaises(deploy.DeploymentError):
            deploy.verify_old_container("lampac-mcp-build120", altered)

    def test_refuses_mounts_privilege_and_public_port(self):
        for field, value in [
            ("Mounts", [{"Source": "/srv/production"}]),
            ("HostConfig.Privileged", True),
            ("HostConfig.PortBindings", {"9118/tcp": [
                {"HostIp": "0.0.0.0", "HostPort": "29118"}]}),
            ("HostConfig.Memory", 0)
        ]:
            with self.subTest(field=field):
                changed = old()
                if field.startswith("HostConfig."):
                    changed["HostConfig"][field.split(".", 1)[1]] = value
                else:
                    changed[field] = value
                with self.assertRaises(deploy.DeploymentError):
                    deploy.verify_old_container("lampac-mcp-build120", changed)

    def test_default_is_readonly_dry_run(self):
        with tempfile.TemporaryDirectory() as root:
            rp = os.path.join(root, "receipt.json")
            cp = os.path.join(root, "init.conf")
            with open(rp, "w") as handle:
                json.dump(receipt(), handle)
            with open(cp, "w") as handle:
                json.dump(config(), handle)
            out = io.StringIO()
            with patch.object(deploy, "container", return_value=None), \
                    patch.object(deploy, "docker", side_effect=AssertionError("Docker mutation forbidden")), \
                    contextlib.redirect_stdout(out):
                code = deploy.main([
                    "--receipt", rp, "--config", cp, "--expected-sha", SHA])
            self.assertEqual(code, 0)
            result = json.loads(out.getvalue())
            self.assertEqual(result["status"], "dry-run")
            self.assertEqual(result["image_ref"], deploy.IMAGE + "@" + DIGEST)


if __name__ == "__main__":
    unittest.main()
