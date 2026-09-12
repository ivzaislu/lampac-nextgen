#!/usr/bin/env python3
import importlib.util
from pathlib import Path

script = Path(__file__).with_name("translationsub-concurrency-regression.py")
spec = importlib.util.spec_from_file_location("translationsub_concurrency_regression", script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.FixtureHandler.protocol_version = "HTTP/1.1"
module.serve_fixture()
