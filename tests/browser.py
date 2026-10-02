"""Shared Playwright launcher: uses the preinstalled Chromium when the pinned one is absent."""

import os
from pathlib import Path

CANDIDATES = [
    os.environ.get("CHROMIUM_PATH", ""),
    "/opt/pw-browsers/chromium",
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
]


def launch(p, **kw):
    try:
        return p.chromium.launch(**kw)
    except Exception:
        for c in CANDIDATES:
            if c and Path(c).exists() and Path(c).is_file():
                return p.chromium.launch(executable_path=c, **kw)
        raise
