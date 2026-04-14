#!/usr/bin/env python3
"""
Single-file EfficientDet-Lite training for Kaggle (YOLO dataset → Pascal VOC → TFLite).

SETUP ON KAGGLE
---------------
1. Add a Dataset whose root contains `data.yaml` and your `dataset/` tree
   (train/images, train/labels, valid/images, valid/labels — same as YOLO).
2. Add this file to the notebook (Upload / paste) or as a second Dataset.
3. First cell:
     !pip install -q "tensorflow>=2.13,<2.16" "tflite-model-maker>=0.4.0" "PyYAML>=6" "Pillow>=9"
4. Edit CONFIG below (OOD_DATA_ROOT must match your input folder name).
5. Run:  python kaggle_train_efficientdet_lite_onefile.py
   Or paste the whole file in one notebook cell after CONFIG edit.

Outputs go to OUT_DIR (default /kaggle/working/efficientdet_lite_runs).
"""
from __future__ import annotations

import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from xml.dom import minidom

# ---------------------------------------------------------------------------
# CONFIG — edit these for Kaggle
# ---------------------------------------------------------------------------
# Folder that contains data.yaml (Kaggle: /kaggle/input/<your-dataset-name>)
OOD_DATA_ROOT = "/kaggle/input/your-dataset-name"

# If data.yaml lives elsewhere, set explicitly; else uses OOD_DATA_ROOT / "data.yaml"
DATA_YAML: Path | None = None

# Must match `path` in data.yaml on Kaggle (override Windows paths from your PC)
DATASET_ROOT: Path | None = None  # e.g. Path("/kaggle/input/your-dataset-name/dataset")

VOC_SUBDIR = "voc_annotations"
EPOCHS = 50
BATCH_SIZE = 8
# Comma-separated lite indices: 0,1,2,3,4
VARIANTS = "0"

OUT_DIR = Path(os.environ.get("EFFDET_OUT", "/kaggle/working/efficientdet_lite_runs"))

# Set False only if you already ran conversion and only want to train
RUN_YOLO_TO_VOC = True
# ---------------------------------------------------------------------------

import yaml
from PIL import Image


def _load_yaml(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def _prettify(elem: ET.Element) -> str:
    rough = ET.tostring(elem, encoding="unicode")
    reparsed = minidom.parseString(rough)
    return reparsed.toprettyxml(indent="  ")


def _yolo_line_to_xyxy(
    parts: list[str], img_w: int, img_h: int
) -> tuple[int, int, int, int] | None:
    if len(parts) < 5:
        return None
    cx, cy, nw, nh = map(float, parts[1:5])
    x1 = (cx - nw / 2.0) * img_w
    y1 = (cy - nh / 2.0) * img_h
    x2 = (cx + nw / 2.0) * img_w
    y2 = (cy + nh / 2.0) * img_h
    x1 = max(0, min(img_w - 1, int(round(x1))))
    y1 = max(0, min(img_h - 1, int(round(y1))))
    x2 = max(0, min(img_w - 1, int(round(x2))))
    y2 = max(0, min(img_h - 1, int(round(y2))))
    if x2 <= x1 or y2 <= y1:
        return None
    return x1, y1, x2, y2


def _build_voc_xml(
    filename: str,
    folder: str,
    width: int,
    height: int,
    objects: list[tuple[str, int, int, int, int]],
) -> ET.Element:
    root = ET.Element("annotation")
    ET.SubElement(root, "folder").text = folder
    ET.SubElement(root, "filename").text = filename
    size = ET.SubElement(root, "size")
    ET.SubElement(size, "width").text = str(width)
    ET.SubElement(size, "height").text = str(height)
    ET.SubElement(size, "depth").text = "3"
    for name, xmin, ymin, xmax, ymax in objects:
        obj = ET.SubElement(root, "object")
        ET.SubElement(obj, "name").text = name
        ET.SubElement(obj, "pose").text = "Unspecified"
        ET.SubElement(obj, "truncated").text = "0"
        ET.SubElement(obj, "difficult").text = "0"
        bb = ET.SubElement(obj, "bndbox")
        ET.SubElement(bb, "xmin").text = str(xmin)
        ET.SubElement(bb, "ymin").text = str(ymin)
        ET.SubElement(bb, "xmax").text = str(xmax)
        ET.SubElement(bb, "ymax").text = str(ymax)
    return root


def _convert_split(
    images_dir: Path,
    labels_dir: Path,
    annotations_out: Path,
    class_names: list[str],
    image_exts: tuple[str, ...] = (".jpg", ".jpeg", ".png", ".webp", ".bmp"),
) -> int:
    annotations_out.mkdir(parents=True, exist_ok=True)
    n_xml = 0
    for img_path in sorted(images_dir.iterdir()):
        if not img_path.is_file() or img_path.suffix.lower() not in image_exts:
            continue
        label_path = labels_dir / (img_path.stem + ".txt")
        with Image.open(img_path) as im:
            w, h = im.size
        objects: list[tuple[str, int, int, int, int]] = []
        if label_path.is_file():
            text = label_path.read_text(encoding="utf-8").strip()
            for line in text.splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = line.split()
                xyxy = _yolo_line_to_xyxy(parts, w, h)
                if xyxy is None:
                    continue
                cid = int(float(parts[0]))
                if cid < 0 or cid >= len(class_names):
                    continue
                name = class_names[cid]
                x1, y1, x2, y2 = xyxy
                objects.append((name, x1, y1, x2, y2))
        xml_root = _build_voc_xml(img_path.name, images_dir.name, w, h, objects)
        out_xml = annotations_out / (img_path.stem + ".xml")
        out_xml.write_text(_prettify(xml_root), encoding="utf-8")
        n_xml += 1
    return n_xml


def run_yolo_to_pascal_voc(
    data_yaml: Path,
    dataset_root: Path,
    out_subdir: str = VOC_SUBDIR,
) -> Path:
    cfg = _load_yaml(data_yaml)
    root = dataset_root.resolve()
    names = cfg["names"]
    if isinstance(names, dict):
        names = [names[i] for i in sorted(names.keys(), key=lambda x: int(x))]
    class_names = list(names)
    train_rel = cfg["train"]
    val_rel = cfg.get("val") or cfg.get("valid")
    if not val_rel:
        raise ValueError("data.yaml needs 'val' or 'valid'")
    base_out = root / out_subdir

    def split_paths(rel: str) -> tuple[Path, Path]:
        img_dir = (root / rel).resolve()
        lbl_dir = (img_dir.parent / "labels").resolve()
        return img_dir, lbl_dir

    train_img, train_lbl = split_paths(train_rel)
    val_img, val_lbl = split_paths(val_rel)

    for name, img_dir, lbl_dir, sub in [
        ("train", train_img, train_lbl, "train"),
        ("valid", val_img, val_lbl, "valid"),
    ]:
        if not img_dir.is_dir():
            raise FileNotFoundError(f"Missing images dir: {img_dir}")
        if not lbl_dir.is_dir():
            raise FileNotFoundError(f"Missing labels dir: {lbl_dir}")
        ann_dir = base_out / sub
        n = _convert_split(img_dir, lbl_dir, ann_dir, class_names)
        print(f"{name}: wrote {n} XML -> {ann_dir}")

    print(
        f"Classes ({len(class_names)}): {class_names[:5]}{'...' if len(class_names) > 5 else ''}"
    )
    return base_out


def _split_dirs(
    dataset_root: Path, train_rel: str, val_rel: str, voc_subdir: str
) -> tuple[Path, Path, Path, Path]:
    def one(rel: str) -> tuple[Path, Path]:
        split_name = Path(rel).parts[0]
        img = (dataset_root / rel).resolve()
        ann = (dataset_root / voc_subdir / split_name).resolve()
        return img, ann

    train_img, train_ann = one(train_rel)
    val_img, val_ann = one(val_rel)
    return train_img, train_ann, val_img, val_ann


def main() -> None:
    env_root = os.environ.get("OOD_DATA_ROOT", "").strip()
    root = Path(env_root or OOD_DATA_ROOT).expanduser().resolve()

    data_yaml = DATA_YAML
    if data_yaml is None:
        cand = root / "data.yaml"
        data_yaml = cand if cand.is_file() else root
    data_yaml = Path(data_yaml).resolve()
    if data_yaml.is_dir():
        data_yaml = data_yaml / "data.yaml"
    if not data_yaml.is_file():
        print(f"data.yaml not found: {data_yaml}", file=sys.stderr)
        sys.exit(1)

    cfg = _load_yaml(data_yaml)
    dataset_root = Path(cfg["path"]).resolve()
    if DATASET_ROOT is not None:
        dataset_root = Path(DATASET_ROOT).resolve()

    names = cfg["names"]
    if isinstance(names, dict):
        names = [names[i] for i in sorted(names.keys(), key=lambda x: int(x))]
    label_map: list[str] = list(names)

    train_rel = cfg["train"]
    val_rel = cfg.get("val") or cfg.get("valid")
    if not val_rel:
        print("data.yaml needs val or valid", file=sys.stderr)
        sys.exit(1)

    if RUN_YOLO_TO_VOC:
        print("Converting YOLO labels -> Pascal VOC XML...")
        run_yolo_to_pascal_voc(data_yaml, dataset_root, VOC_SUBDIR)

    train_img, train_ann, val_img, val_ann = _split_dirs(
        dataset_root, train_rel, val_rel, VOC_SUBDIR
    )

    if not train_ann.is_dir() or not any(train_ann.glob("*.xml")):
        print(
            f"Missing VOC XML in {train_ann}. Enable RUN_YOLO_TO_VOC or run conversion first.",
            file=sys.stderr,
        )
        sys.exit(1)
    if not val_ann.is_dir() or not any(val_ann.glob("*.xml")):
        print(f"Missing VOC XML in {val_ann}", file=sys.stderr)
        sys.exit(1)

    try:
        from tflite_model_maker.object_detector import DataLoader, ObjectDetector
        from tflite_model_maker.object_detector import (
            EfficientDetLite0Spec,
            EfficientDetLite1Spec,
            EfficientDetLite2Spec,
            EfficientDetLite3Spec,
            EfficientDetLite4Spec,
        )
    except ImportError:
        print(
            "Install: pip install tflite-model-maker\n"
            "Use: !pip install -q \"tensorflow>=2.13,<2.16\" \"tflite-model-maker>=0.4.0\" ...",
            file=sys.stderr,
        )
        raise

    specs = {
        0: EfficientDetLite0Spec(),
        1: EfficientDetLite1Spec(),
        2: EfficientDetLite2Spec(),
        3: EfficientDetLite3Spec(),
        4: EfficientDetLite4Spec(),
    }

    wanted = [int(x.strip()) for x in VARIANTS.split(",") if x.strip()]
    for v in wanted:
        if v not in specs:
            print(f"Invalid variant {v} (use 0-4)", file=sys.stderr)
            sys.exit(1)

    out_root = Path(OUT_DIR).resolve()
    if not out_root.parent.exists():
        out_root = Path.cwd() / "efficientdet_lite_runs"
    out_root.mkdir(parents=True, exist_ok=True)

    print("Loading Pascal VOC (first run may build TFRecord cache)...")
    train_data = DataLoader.from_pascal_voc(
        str(train_img),
        str(train_ann),
        label_map=label_map,
    )
    val_data = DataLoader.from_pascal_voc(
        str(val_img),
        str(val_ann),
        label_map=label_map,
    )

    for v in wanted:
        name = f"lite{v}"
        spec = specs[v]
        run_dir = out_root / name
        run_dir.mkdir(parents=True, exist_ok=True)
        print(f"\n========== EfficientDet-{name} ==========")
        model = ObjectDetector.create(
            train_data=train_data,
            validation_data=val_data,
            model_spec=spec,
            epochs=EPOCHS,
            batch_size=BATCH_SIZE,
            train_whole_model=True,
        )
        tflite_name = f"efficientdet_{name}.tflite"
        model.export(str(run_dir), tflite_filename=tflite_name)
        print(f"Exported {run_dir / tflite_name}")

    print(f"\nDone. Outputs: {out_root}")


if __name__ == "__main__":
    main()
