#!/usr/bin/env python3
"""
Export a YOLOv8 Ultralytics .pt checkpoint to TensorFlow Lite (.tflite).

Install (once), from repo root:
  pip install "ultralytics>=8.0.0" tensorflow

Run:
  python scripts/export_yolo_tflite.py --weights models/best.pt
  python scripts/export_yolo_tflite.py --weights yolov8n.pt --imgsz 640 --int8 --data coco.yaml

Output:
  Ultralytics writes the .tflite next to the weights (same folder as the .pt).

Where TFLite helps
  - Android / iOS on-device inference (no PC server for the detector).
  - Edge devices (Coral, some NPUs).

Where it usually does NOT beat your current setup
  - Windows/Linux PC running the FastAPI server: PyTorch + Ultralytics is typically
    faster on GPU; on CPU, try ONNX Runtime export (format='onnx') instead of TFLite.

This repo’s mobile app still uses POST /predict to your PC; using the .tflite on the
phone would require a native TFLite module (custom dev build), not Expo Go alone.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


def main() -> None:
    parser = argparse.ArgumentParser(description="YOLOv8 to TensorFlow Lite export")
    parser.add_argument(
        "--weights",
        type=Path,
        default=_ROOT / "models" / "best.pt",
        help="Path to .pt file (default: models/best.pt)",
    )
    parser.add_argument(
        "--imgsz",
        type=int,
        default=640,
        help="Square inference size (default 640; match training if possible)",
    )
    parser.add_argument(
        "--half",
        action="store_true",
        help="FP16 where supported (smaller/faster on some runtimes)",
    )
    parser.add_argument(
        "--int8",
        action="store_true",
        help="INT8 quantization (smaller; needs --data for calibration)",
    )
    parser.add_argument(
        "--data",
        type=Path,
        default=None,
        help="Dataset yaml for INT8 calibration (e.g. coco.yaml or your data.yaml)",
    )
    args = parser.parse_args()

    w = args.weights.expanduser().resolve()
    if not w.is_file():
        raise SystemExit(f"Weights not found: {w}")

    try:
        from ultralytics import YOLO
    except ImportError as e:
        raise SystemExit(
            "Install ultralytics (and tensorflow for TFLite export): "
            'pip install "ultralytics>=8.0.0" tensorflow'
        ) from e

    print(f"Loading {w} …")
    model = YOLO(str(w))

    export_kw: dict = {
        "format": "tflite",
        "imgsz": args.imgsz,
    }
    if args.half:
        export_kw["half"] = True
    if args.int8:
        export_kw["int8"] = True
        if args.data and args.data.is_file():
            export_kw["data"] = str(args.data.resolve())
        else:
            print(
                "WARNING: --int8 without a valid --data yaml may fail or degrade; "
                "pass your training data.yaml for best results.",
                file=sys.stderr,
            )

    print(f"Exporting TFLite with {export_kw} …")
    path = model.export(**export_kw)
    print(f"Done: {path}")


if __name__ == "__main__":
    main()
