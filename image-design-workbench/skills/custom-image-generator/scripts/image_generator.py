#!/usr/bin/env python3
"""Bridge script for image-design-workbench.

Delegates execution to the workspace-level custom-image-generator script so both
paths remain compatible.
"""

from __future__ import annotations

import runpy
import sys
from pathlib import Path

CURRENT = Path(__file__).resolve()
REAL_SCRIPT = CURRENT.parents[4] / "skills" / "custom-image-generator" / "scripts" / "image_generator.py"

if not REAL_SCRIPT.exists():
    sys.stderr.write(f"Bridge target not found: {REAL_SCRIPT}\n")
    sys.exit(2)

runpy.run_path(str(REAL_SCRIPT), run_name="__main__")
