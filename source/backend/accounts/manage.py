#!/usr/bin/env python
"""VyaparX ERP Django entry point.

This file lives in source/backend/accounts/, while the settings package is
source/backend/vyaparx_backend/. Adding the backend directory to sys.path
makes this runnable from either location:

    python accounts/manage.py check   # from source/backend
    python manage.py check            # from source/backend/accounts
"""
import os
import sys
from pathlib import Path

ACCOUNTS_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ACCOUNTS_DIR.parent
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
