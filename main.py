"""Top-level entry point for PyInstaller and direct execution.

Run with:
    python main.py

Also works without ``pip install`` because we explicitly add ``src/`` to
``sys.path``.
"""
# SPDX-License-Identifier: MIT
from __future__ import annotations

import sys
from pathlib import Path

_SRC = Path(__file__).resolve().parent / "src"
if _SRC.is_dir() and str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from oppo_live_photo.gui import main  # noqa: E402

if __name__ == "__main__":
    main()
