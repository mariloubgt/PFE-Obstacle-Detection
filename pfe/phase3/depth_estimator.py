"""
Monocular depth from known object size + horizontal FOV (pinhole model).

- fx, fy derived from image size and horizontal field of view (no 0.85*H heuristic).
- Height vs width: geometric mean when both agree (~within 65%); width if bbox clipped vertically.
- Stateless per call (no cross-request smoothing — avoids wrong distances when several
  instances share a class or between different users).
"""
from __future__ import annotations

import math
from typing import Any

from . import config


def _norm_class_key(name: str) -> str:
    """Map COCO-style 'traffic light' to config key traffic_light."""
    s = (name or "").strip().lower().replace("-", "_")
    return "_".join(s.split())


def focal_lengths_from_hfov(img_w: int, img_h: int, hfov_deg: float) -> tuple[float, float]:
    """Pixel focal lengths fx, fy from horizontal FOV and image aspect (square pixels)."""
    if img_w <= 0 or img_h <= 0:
        return 1.0, 1.0
    hfov = math.radians(float(hfov_deg))
    fx = (img_w / 2.0) / math.tan(hfov / 2.0)
    vfov = 2.0 * math.atan(math.tan(hfov / 2.0) * (img_h / float(img_w)))
    fy = (img_h / 2.0) / math.tan(vfov / 2.0)
    return fx, fy


def _clamp_distance(dist_m: float | None) -> float | None:
    if dist_m is None or not math.isfinite(dist_m) or dist_m <= 0:
        return None
    lo = 0.2
    hi = float(getattr(config, "MAX_DISTANCE_M", 15.0))
    return round(max(lo, min(float(dist_m), hi)), 2)


def _estimate_from_full_box(
    key: str,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    img_w: int,
    img_h: int,
    hfov_deg: float,
) -> float | None:
    bbox_h = float(y2 - y1)
    bbox_w = float(x2 - x1)
    bbox_h = max(bbox_h, 1e-3)
    bbox_w = max(bbox_w, 1e-3)

    real_h_cm = config.OBJECT_REAL_HEIGHTS.get(key)
    real_w_cm = config.OBJECT_REAL_WIDTHS.get(key)
    if not real_h_cm:
        return None

    fx, fy = focal_lengths_from_hfov(img_w, img_h, hfov_deg)
    real_h_m = real_h_cm / 100.0
    dist_h = (real_h_m * fy) / bbox_h

    dist_w: float | None = None
    if real_w_cm and bbox_w > 0:
        real_w_m = real_w_cm / 100.0
        dist_w = (real_w_m * fx) / bbox_w

    margin = img_h * 0.04
    is_height_clipped = (y1 < margin) or (y2 > (img_h - margin))

    if is_height_clipped and dist_w is not None and dist_w > 0:
        dist_m = dist_w
    elif dist_w is not None and dist_w > 0 and dist_h > 0:
        lo_d, hi_d = (dist_h, dist_w) if dist_h <= dist_w else (dist_w, dist_h)
        ratio = hi_d / max(lo_d, 1e-6)
        if ratio <= 1.65:
            dist_m = math.sqrt(dist_h * dist_w)
        else:
            dist_m = dist_h
    else:
        dist_m = dist_h

    return _clamp_distance(dist_m)


def _estimate_height_only(
    key: str,
    bbox_h_px: float,
    img_w: int,
    img_h: int,
    hfov_deg: float,
) -> float | None:
    """Legacy path when only bbox height + frame height are known (tests / old scripts)."""
    bbox_h_px = max(float(bbox_h_px), 1e-3)
    real_h_cm = config.OBJECT_REAL_HEIGHTS.get(key)
    if not real_h_cm:
        return None
    _, fy = focal_lengths_from_hfov(img_w, img_h, hfov_deg)
    real_h_m = real_h_cm / 100.0
    dist_h = (real_h_m * fy) / bbox_h_px
    return _clamp_distance(dist_h)


def estimate_distance(class_name: str, *args: Any, horizontal_fov_deg: float | None = None) -> float | None:
    """
    Full bbox (API / live camera):
        estimate_distance(name, x1, y1, x2, y2, img_w, img_h, horizontal_fov_deg=56)

    Legacy height-only (tests):
        estimate_distance(name, bbox_h_px, img_h_px, horizontal_fov_deg=56)
    """
    hfov = float(
        horizontal_fov_deg
        if horizontal_fov_deg is not None
        else getattr(config, "CAMERA_HORIZONTAL_FOV_DEG", 56.0)
    )
    key = _norm_class_key(class_name)

    if len(args) == 6:
        x1, y1, x2, y2 = float(args[0]), float(args[1]), float(args[2]), float(args[3])
        img_w, img_h = int(args[4]), int(args[5])
        return _estimate_from_full_box(key, x1, y1, x2, y2, img_w, img_h, hfov)

    if len(args) == 2:
        bbox_h_px, img_h_px = float(args[0]), int(args[1])
        ratio = float(getattr(config, "DEFAULT_IMAGE_WH_RATIO", 0.462))
        img_w_px = max(int(round(img_h_px * ratio)), 1)
        return _estimate_height_only(key, bbox_h_px, img_w_px, img_h_px, hfov)

    raise TypeError(
        "estimate_distance: use (name, x1,y1,x2,y2, img_w, img_h) or (name, bbox_h, img_h); "
        f"got {len(args)} geometry args"
    )


def get_danger_level(distance_m: float | None) -> str:
    if distance_m is None:
        return "INFO"
    if distance_m < getattr(config, "DANGER_CLOSE_M", 1.8):
        return "DANGER"
    if distance_m < getattr(config, "WARNING_M", 4.0):
        return "WARNING"
    return "INFO"


def get_danger_color(danger: str) -> tuple[int, int, int]:
    """BGR for OpenCV."""
    if danger == "DANGER":
        return (0, 0, 255)
    if danger == "WARNING":
        return (0, 165, 255)
    return (0, 255, 0)
