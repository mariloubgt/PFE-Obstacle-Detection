"""
Test script for the enhanced depth estimator and Gemini pipeline.
Run from the project root:
    python -m pfe.phase3.test_enhancements
"""
import math
import sys
from pathlib import Path

# ── Make sure the package is importable ────────────────────
_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from pfe.phase3 import config
from pfe.phase3.depth_estimator import estimate_distance, get_danger_level


def _theoretical_px(real_h_cm: float, distance_m: float, img_h: int) -> int:
    """Inverse formula: how many pixels should an object occupy at a given distance?"""
    vfov_rad = math.radians(config.CAMERA_VFOV)
    focal_px = (img_h / 2.0) / math.tan(vfov_rad / 2.0)
    return max(1, int((real_h_cm * focal_px) / (distance_m * 100.0)))


# ── Test 1: Distance accuracy round-trip ────────────────────
def test_distance_accuracy():
    print("=" * 58)
    print("  TEST 1 — Distance round-trip accuracy (VFOV={:.0f}°)".format(config.CAMERA_VFOV))
    print("=" * 58)
    print(f"{'Object':<22} {'Real':>6} {'Est@1m':>8} {'Est@3m':>8} {'Est@5m':>8}")
    print("-" * 58)

    img_h = 1080   # iPhone full-res portrait

    for obj, real_h in config.OBJECT_REAL_HEIGHTS.items():
        row = []
        for d_real in [1.0, 3.0, 5.0]:
            px_h = _theoretical_px(real_h, d_real, img_h)
            est  = estimate_distance(obj, px_h, img_h)
            if est is None:
                row.append("  N/A  ")
            else:
                err = abs(est - d_real)
                ok  = "[OK]" if err < 0.25 * d_real else "[!!]"
                row.append(f"{est:.1f}m{ok}")
        print(f"  {obj:<20} {real_h:>4}cm  {row[0]:>8}  {row[1]:>8}  {row[2]:>8}")

    print()


# ── Test 2: Edge cases — clamp protection ───────────────────
def test_edge_cases():
    print("=" * 58)
    print("  TEST 2 — Edge cases & clamp protection")
    print("=" * 58)

    img_h = 720

    cases = [
        ("person", 0,    img_h, "zero bbox height"),
        ("person", img_h, img_h, "bbox fills image (0.3m expected)"),
        ("unknown_class", 100, img_h, "unknown class → None expected"),
        ("curb", 3, img_h,    "tiny curb bbox (should clamp to MAX)"),
    ]

    for cls, bh, ih, desc in cases:
        result = estimate_distance(cls, bh, ih)
        print(f"  {desc:<40}  → {result}")

    print()


# ── Test 3: Danger levels ────────────────────────────────────
def test_danger_levels():
    print("=" * 58)
    print("  TEST 3 — Danger level thresholds")
    print("=" * 58)
    for dist, expected in [(0.5, "DANGER"), (1.9, "DANGER"), (2.0, "WARNING"),
                           (4.9, "WARNING"), (5.0, "INFO"), (15.0, "INFO")]:
        level = get_danger_level(dist)
        ok = "[OK]" if level == expected else f"[!!] (expected {expected})"
        print(f"  {dist:.1f}m → {level}  {ok}")
    print()


# ── Test 4: Gemini pipeline (requires GEMINI_API_KEY in .env) ─
def test_gemini_pipeline():
    print("=" * 58)
    print("  TEST 4 — Gemini structured response")
    print("=" * 58)

    try:
        from dotenv import load_dotenv
        load_dotenv(_ROOT / ".env")
    except ImportError:
        pass

    from api.vision_pipeline import run_gemini, _get_gemini_client

    client = _get_gemini_client()
    if client is None:
        print("  ⚠  GEMINI_API_KEY not set — skipping Gemini test.")
        print("     Add it to your .env file and re-run.\n")
        return

    # Create a simple test image (white frame)
    from PIL import Image as PILImage
    dummy_img = PILImage.new("RGB", (640, 480), color=(200, 200, 200))

    fake_detections = [
        {"name": "person",  "distance_m": 1.2},
        {"name": "car",     "distance_m": 3.5},
    ]
    fake_scene = [{"label": "a street with parked cars and pedestrians"}]

    result = run_gemini(dummy_img, fake_detections, fake_scene, fov_deg=64)

    print(f"  darija : {result.get('darija')}")
    print(f"  risk   : {result.get('risk')}")
    print(f"  focus  : {result.get('focus')}")
    print(f"  error  : {result.get('error')}")
    print()


if __name__ == "__main__":
    test_distance_accuracy()
    test_edge_cases()
    test_danger_levels()
    test_gemini_pipeline()
    print("[OK] All tests finished.")
