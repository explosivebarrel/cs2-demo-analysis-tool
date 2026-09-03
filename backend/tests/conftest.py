"""Isolate test runs from real data dirs: config.py creates dirs on import."""
import os
import tempfile

os.environ.setdefault("CS2_DATA_DIR", tempfile.mkdtemp(prefix="cs2-test-data-"))
os.environ.setdefault("CS2_INBOX_DIR", tempfile.mkdtemp(prefix="cs2-test-inbox-"))
