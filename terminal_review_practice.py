#!/usr/bin/env python3
"""Compatibility entry point for the terminal application."""

import sys

from terminal_app import app as _app


if __name__ == "__main__":
    _app.main()
else:
    # Existing integrations import this historical module and monkeypatch its
    # globals. Return the canonical module so those patches keep working.
    sys.modules[__name__] = _app
