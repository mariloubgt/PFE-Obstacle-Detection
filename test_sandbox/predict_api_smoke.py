"""
Appelle POST /predict sur une API déjà démarrée (aucun import du code métier).
Image : PNG 1x1 encodé en dur (pas de PIL requis).

  python test_sandbox/predict_api_smoke.py
  set API_BASE=http://192.168.x.x:8787 && python test_sandbox/predict_api_smoke.py

Si rien n'écoute sur le port : message [SKIP] et code 0 (pas une « erreur »).
Pour échouer explicitement sans serveur : set REQUIRE_API=1
"""

from __future__ import annotations

import base64
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

try:
    import requests
except ImportError:
    print("Installez les deps : pip install -r test_sandbox/requirements-smoke.txt", file=sys.stderr)
    raise

# PNG 1x1 gris (valide)
_TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def main() -> None:
    base = (os.environ.get("API_BASE") or "http://127.0.0.1:8787").rstrip("/")
    health_url = f"{base}/health"
    predict_url = f"{base}/predict"

    require_api = (os.environ.get("REQUIRE_API") or "").strip().lower() in ("1", "true", "yes")

    print(f"GET  {health_url}")
    try:
        h = requests.get(health_url, timeout=10)
        print(f"     status={h.status_code} body={h.text[:500]}")
    except requests.RequestException as e:
        print(f"     détail: {e}")
        print(
            "[SKIP] Aucun serveur sur cette URL (connexion refusée = API pas démarrée).\n"
            "       Démarrez l'API, par ex. depuis la racine du repo :\n"
            "         cd api\n"
            "         python inference_server.py\n"
            "       Puis relancez ce script. (Port par défaut 8787, ou définissez PORT / API_BASE.)"
        )
        sys.exit(1 if require_api else 0)

    print(f"POST {predict_url}")
    try:
        r = requests.post(
            predict_url,
            files={"file": ("smoke.png", _TINY_PNG, "image/png")},
            timeout=120,
        )
        print(f"     status={r.status_code}")
        try:
            data = r.json()
            print(f"     keys={list(data.keys())}")
            dets = data.get("detections") or []
            print(f"     detections count={len(dets)}  pipeline_ms={data.get('pipeline_ms')}")
        except Exception:
            print(f"     body (text)={r.text[:800]}")
    except requests.RequestException as e:
        print(f"     erreur: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
