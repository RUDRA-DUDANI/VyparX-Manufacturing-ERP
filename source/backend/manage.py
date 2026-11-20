#!/usr/bin/env python
"""Django management entry point for the backend project."""
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
ACCOUNTS_DIR = BACKEND_DIR / "accounts"
SOURCE_DIR = BACKEND_DIR.parent
for path in (str(BACKEND_DIR), str(ACCOUNTS_DIR), str(SOURCE_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)


def main():
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "vyaparx_backend.settings")
    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
