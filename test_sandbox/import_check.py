"""
Sanity check: imports utilisés par l'API, sans lancer le serveur.
Exécuter depuis la racine du repo : python test_sandbox/import_check.py
"""

from __future__ import annotations

import sys
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))

    print(f"Repo root: {root}")

    try:
        from pfe.phase3 import config  # noqa: F401

        print("OK  pfe.phase3.config")
    except Exception as e:
        print(f"FAIL  pfe.phase3.config  —  {e!r}")

    try:
        import api.vision_pipeline  # noqa: F401

        print("OK  api.vision_pipeline")
    except Exception as e:
        print(f"FAIL  api.vision_pipeline  —  {e!r}")

    api_dir = root / "api"
    if str(api_dir) not in sys.path:
        sys.path.insert(0, str(api_dir))
    try:
        import inference_server  # noqa: F401

        print("OK  inference_server (import module, depuis api/)")
    except Exception as e:
        print(f"FAIL  inference_server  —  {e!r}")


if __name__ == "__main__":
    main()
