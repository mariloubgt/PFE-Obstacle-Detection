"""
Navigation YOLO post-processing — strict false-positive control (especially person).
Does not inflate confidence; only filters and sorts.
"""

from __future__ import annotations

from typing import Any

# Indoor-trained classes (no person in indoor head).
_INDOOR_CLASSES = frozenset(
    {
        "chair",
        "clock",
        "exit",
        "fireextinguisher",
        "fire_extinguisher",
        "printer",
        "screen",
        "trashbin",
    }
)

_PERSON_MIN_CONF = 0.58
_PERSON_MIN_AREA = 0.022
_DEFAULT_MIN_CONF = 0.38
_INDOOR_MIN_CONF = 0.34
_MIN_AREA = 0.0025
_TINY_AREA = 0.005
_TINY_MIN_CONF = 0.48


def _norm(name: str) -> str:
    return (name or "").strip().lower().replace("-", "_").replace(" ", "_")


def _raw_conf(d: dict[str, Any]) -> float:
    if "raw_confidence" in d:
        return float(d["raw_confidence"])
    return float(d.get("confidence", 0))


def filter_nav_detections(
    items: list[dict[str, Any]],
    *,
    img_w: int = 1,
    img_h: int = 1,
) -> list[dict[str, Any]]:
    kept: list[dict[str, Any]] = []
    for d in items:
        raw = _raw_conf(d)
        key = _norm(str(d.get("name", "")))
        x1, y1, x2, y2 = (
            float(d.get("x1", 0)),
            float(d.get("y1", 0)),
            float(d.get("x2", 0)),
            float(d.get("y2", 0)),
        )
        bw = max(0.0, x2 - x1)
        bh = max(0.0, y2 - y1)
        area = bw * bh
        source = str(d.get("model", "")).lower()

        if area < _MIN_AREA:
            continue
        if area < _TINY_AREA and raw < _TINY_MIN_CONF:
            continue

        if key == "person":
            if raw < _PERSON_MIN_CONF or area < _PERSON_MIN_AREA:
                continue
            aspect = bh / max(bw, 1e-6)
            if aspect < 0.85 or aspect > 4.5:
                continue

        min_conf = _INDOOR_MIN_CONF if key in _INDOOR_CLASSES else _DEFAULT_MIN_CONF
        if raw < min_conf:
            continue

        # Outdoor COCO person is noisy indoors — prefer indoor head only for furniture.
        if key == "person" and source == "outdoor" and raw < 0.62:
            continue

        row = dict(d)
        row["raw_confidence"] = round(raw, 4)
        row["confidence"] = row["raw_confidence"]
        kept.append(row)

    kept.sort(
        key=lambda d: (
            float(d.get("distance_m") or 99.0),
            -_raw_conf(d),
        )
    )
    return kept


def strip_stale_outdoor_person(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Remove weak outdoor person boxes when reusing cached outdoor detections."""
    out: list[dict[str, Any]] = []
    for d in items:
        key = _norm(str(d.get("name", "")))
        raw = _raw_conf(d)
        source = str(d.get("model", "")).lower()
        if key == "person" and source == "outdoor" and raw < _PERSON_MIN_CONF:
            continue
        out.append(d)
    return out
