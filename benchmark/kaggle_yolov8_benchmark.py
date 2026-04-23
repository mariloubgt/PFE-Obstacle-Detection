"""
============================================================
  KAGGLE BENCHMARK NOTEBOOK — YOLOv8 (Enhanced)
  Copy each section into a separate Kaggle notebook cell.
============================================================
"""

# ══════════════════════════════════════════════════════════════
# CELL 1: Setup & GPU Check
# ══════════════════════════════════════════════════════════════

# --- paste into cell 1 ---
"""
import shutil, os
shutil.rmtree("/kaggle/working/datasets", ignore_errors=True)

import torch
print(f"PyTorch: {torch.__version__}")
print(f"CUDA: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    for i in range(torch.cuda.device_count()):
        print(f"GPU {i}: {torch.cuda.get_device_name(i)}")
        print(f"  VRAM: {torch.cuda.get_device_properties(i).total_memory / 1e9:.1f} GB")
"""

# ══════════════════════════════════════════════════════════════
# CELL 2: Install & Fix data.yaml
# ══════════════════════════════════════════════════════════════

# --- paste into cell 2 ---
"""
!pip install -q ultralytics sahi opencv-python

import yaml
from pathlib import Path

# Auto-find dataset
input_root = Path("/kaggle/input")
yaml_candidates = list(input_root.rglob("data.yaml"))
if not yaml_candidates:
    raise FileNotFoundError("No data.yaml found under /kaggle/input!")
    
src_yaml = yaml_candidates[0]
dataset_dir = src_yaml.parent
print(f"Found dataset at: {dataset_dir}")

# Verify splits exist
for split in ["train/images", "valid/images", "test/images"]:
    p = dataset_dir / split
    if p.exists():
        n = len(list(p.glob("*")))
        print(f"  {split}: {n} files")
    else:
        print(f"  ⚠️ MISSING: {split}")

# Write fixed YAML
with open(src_yaml) as f:
    cfg = yaml.safe_load(f)

cfg["path"] = str(dataset_dir)
output_yaml = "/kaggle/working/data_fixed.yaml"
with open(output_yaml, "w") as f:
    yaml.dump(cfg, f)

print(f"\n✅ Fixed YAML -> {output_yaml}")
print(f"   path: {cfg['path']}")
"""

# ══════════════════════════════════════════════════════════════
# CELL 3: Configuration
# ══════════════════════════════════════════════════════════════

# --- paste into cell 3 ---
"""
from ultralytics import YOLO
from pathlib import Path
import pandas as pd
import numpy as np
import time
import gc, torch, os


def _safe_cuda_empty_cache():
    if not torch.cuda.is_available():
        return
    try:
        torch.cuda.synchronize()
    except Exception:
        pass
    try:
        torch.cuda.empty_cache()
    except Exception:
        pass


# ┌──────────────────────────────────────────────────────┐
# │  CONFIGURATION — edit these                          │
# └──────────────────────────────────────────────────────┘
RUN_TRAINING = True

DATA_YAML    = "/kaggle/working/data_fixed.yaml"
IMG_SIZE     = 640
EPOCHS       = 100
BATCH        = 16          # ← 16 is safer on T4 (15GB); avoids OOM on medium models
DEVICE       = 0           # ← SINGLE GPU! Do NOT use "0,1" — DDP hurts accuracy
PATIENCE     = 50          # ← enough to converge, stops overfitting
WORKERS      = 4           # ← balanced for Kaggle
AMP          = True

RESULTS_CSV  = "benchmark_yolov8.csv"
PERCLASS_CSV = "benchmark_yolov8_perclass.csv"

# ── NEW: Enhanced Inference Settings ──
USE_SAHI          = False  # Set to True for sliced inference (slow but high recall)
USE_PREPROCESSING = False  # Set to True for CLAHE enhancement
SAHI_SLICE_SIZE   = 320    # Patch size for slicing
SAHI_OVERLAP      = 0.2    # Overlap between slices
# ──────────────────────────────────────

CLASS_NAMES = [
    'bench', 'bicycle', 'bus', 'bus_stop', 'car', 'crutch', 'curb', 'dog',
    'fire_hydrant', 'motorcycle', 'person', 'pole', 'spherical_roadblock',
    'stairs', 'stop_sign', 'street_light', 'traffic_light', 'train', 'tree',
    'truck', 'warning_column', 'waste_container'
]

# Models to benchmark — comment out what you've finished
MODELS = [
    "yolov8n.pt",
    "yolov8s.pt",
    "yolov8m.pt",
]
import cv2
try:
    from sahi.predict import get_sliced_prediction
    from sahi import AutoDetectionModel
except ImportError:
    pass

def preprocess_image(img_path):
    # Apply CLAHE to enhance visibility/contrast
    img = cv2.imread(str(img_path))
    if img is None: return None
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    cl = clahe.apply(l)
    return cv2.cvtColor(cv2.merge((cl,a,b)), cv2.COLOR_LAB2BGR)

def benchmark_model(model_name):
    print(f"\n{'='*60}")
    print(f"  BENCHMARK: {model_name}")
    print(f"{'='*60}")

    run_name   = f"{model_name.replace('.pt', '')}_ood"
    run_dir    = Path(f"/kaggle/working/runs/detect/{run_name}")
    best_pt    = run_dir / "weights" / "best.pt"
    last_pt    = run_dir / "weights" / "last.pt"
    results_p  = run_dir / "results.csv"

    already_done = results_p.exists() and best_pt.exists()
    use_resume   = last_pt.exists() and not already_done

    # ── 1. Train ────────────────────────────────────────────
    if already_done:
        print("✅ Training already complete — skipping to validation")
    else:
        if use_resume:
            print(f"🔁 Resuming from {last_pt}")
            model = YOLO(str(last_pt))
            model.train(resume=True)
        else:
            print("🚀 Starting fresh training")
            model = YOLO(model_name)
            model.train(
                data=DATA_YAML,
                epochs=EPOCHS,
                imgsz=IMG_SIZE,
                batch=BATCH,
                device=DEVICE,
                workers=WORKERS,
                amp=AMP,
                # ── Optimizer & LR ──
                optimizer="auto",       # MuSGD on modern ultralytics
                cos_lr=True,            # Cosine LR decay — smoother convergence
                lr0=0.01,               # Standard initial LR
                lrf=0.01,               # Final LR = lr0 * lrf
                # ── Regularization ──
                patience=PATIENCE,
                weight_decay=0.0005,
                dropout=0.0,            # No dropout for detection
                # ── Augmentation (tuned for obstacle detection) ──
                mosaic=1.0,             # Full mosaic
                mixup=0.1,              # Light mixup — helps generalization
                copy_paste=0.1,         # Light copy-paste augmentation
                degrees=10.0,           # Slight rotation
                translate=0.1,
                scale=0.5,
                fliplr=0.5,
                hsv_h=0.015,
                hsv_s=0.7,
                hsv_v=0.4,
                erasing=0.4,
                # ── Save settings ──
                name=run_name,
                exist_ok=True,
                save=True,
                plots=True,
            )
        del model
        gc.collect()
        _safe_cuda_empty_cache()

    # ── 2. Validate on test set ─────────────────────────────
    if not best_pt.exists():
        raise FileNotFoundError(f"best.pt not found at {best_pt}")

    best_model = YOLO(str(best_pt))
    metrics = best_model.val(
        data=DATA_YAML,
        split="test",
        device=DEVICE,
        imgsz=IMG_SIZE,
        workers=WORKERS,
    )

    # ── 3. Speed benchmark ──────────────────────────────────
    # Find test images
    import yaml
    with open(DATA_YAML) as f:
        dcfg = yaml.safe_load(f)
    test_img_dir = Path(dcfg["path"]) / dcfg["test"]

    _ext = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}
    test_images = [p for p in test_img_dir.glob("*.*") if p.suffix.lower() in _ext][:200]
    if not test_images:
        raise FileNotFoundError(f"No test images under {test_img_dir}")

    # --- Enhanced Validation Loop ---
    # We use a custom loop to handle SAHI, Preprocessing, and Negative Samples correctly
    
    # 1. Prepare SAHI model if needed
    sahi_model = None
    if USE_SAHI:
        sahi_model = AutoDetectionModel.from_pretrained(
            model_type='ultralytics',
            model_path=str(best_pt),
            device=f"cuda:{DEVICE}" if torch.cuda.is_available() else "cpu",
            confidence_threshold=0.25
        )

    # 2. Iterate through test images
    tn_count = 0  # True Negatives (Correctly empty)
    fp_count = 0  # False Positives on negative images
    neg_total = 0
    
    latencies = []
    
    # Track per-image results for metrics later
    # Note: Standard metrics (mAP) are still from best_model.val() above
    # We add custom metrics for negative samples and speed comparison
    
    for img_path in test_images:
        # Preprocessing
        if USE_PREPROCESSING:
            input_data = preprocess_image(img_path)
            if input_data is None: continue
        else:
            input_data = str(img_path)

        t0 = time.perf_counter()
        
        if USE_SAHI and sahi_model:
            results_sahi = get_sliced_prediction(
                input_data,
                sahi_model,
                slice_height=SAHI_SLICE_SIZE,
                slice_width=SAHI_SLICE_SIZE,
                overlap_height_ratio=SAHI_OVERLAP,
                overlap_width_ratio=SAHI_OVERLAP,
                verbose=0
            )
            latencies.append((time.perf_counter() - t0) * 1000)
            boxes_count = len(results_sahi.object_prediction_list)
        else:
            res = best_model(input_data, imgsz=IMG_SIZE, device=DEVICE, verbose=False)
            latencies.append((time.perf_counter() - t0) * 1000)
            boxes_count = len(res[0].boxes) if res and res[0].boxes else 0

        # Negative Sample Logic
        lbl_path = Path(str(img_path).replace("images", "labels")).with_suffix(".txt")
        is_negative = not lbl_path.exists() or lbl_path.stat().st_size == 0
        
        if is_negative:
            neg_total += 1
            if boxes_count == 0:
                tn_count += 1
            else:
                fp_count += 1

    neg_acc = (tn_count / neg_total) if neg_total > 0 else 1.0

    # ── 4. Collect metrics ──────────────────────────────────
    size_mb  = best_pt.stat().st_size / 1e6
    params_m = sum(p.numel() for p in best_model.model.parameters()) / 1e6

    p  = float(metrics.box.mp)
    r  = float(metrics.box.mr)
    f1 = 2 * p * r / (p + r) if (p + r) > 0 else 0.0

    row = {
        "model":        model_name.replace(".pt", ""),
        "mAP@0.5":      round(float(metrics.box.map50), 4),
        "mAP@0.5:0.95": round(float(metrics.box.map),   4),
        "precision":    round(p,  4),
        "recall":       round(r,  4),
        "F1":           round(f1, 4),
        "speed_ms/img": round(float(np.mean(latencies)), 2),
        "neg_acc":      round(neg_acc, 4),
        "sahi":         USE_SAHI,
        "preprocess":   USE_PREPROCESSING,
        "size_MB":      round(size_mb,  1),
        "params_M":     round(params_m, 1),
    }

    per_class = {}
    for i, name in enumerate(CLASS_NAMES):
        if i < len(metrics.box.ap50):
            per_class[name] = round(float(metrics.box.ap50[i]), 4)

    del best_model
    gc.collect()
    _safe_cuda_empty_cache()
    return row, per_class
"""

# ══════════════════════════════════════════════════════════════
# CELL 5: Run Benchmark
# ══════════════════════════════════════════════════════════════

# --- paste into cell 5 ---
"""
rows = []
all_per_class = {}

print("RUN_TRAINING=True — full training for each entry in MODELS.\n")
for model_name in MODELS:
    try:
        row, per_class = benchmark_model(model_name)
        rows.append(row)
        all_per_class[row["model"]] = per_class
        print(f"\n  ┌─────────────────────────────────┐")
        print(f"  │ {row['model']:^31s} │")
        print(f"  ├─────────────────────────────────┤")
        print(f"  │ mAP@0.5      : {row['mAP@0.5']:<15} │")
        print(f"  │ mAP@0.5:0.95 : {row['mAP@0.5:0.95']:<15} │")
        print(f"  │ Precision    : {row['precision']:<15} │")
        print(f"  │ Recall       : {row['recall']:<15} │")
        print(f"  │ F1           : {row['F1']:<15} │")
        print(f"  │ Neg Accuracy : {row['neg_acc']:<15} │")
        print(f"  │ Speed        : {row['speed_ms/img']} ms/img{' '*(8-len(str(row['speed_ms/img'])))}│")
        print(f"  │ SAHI / Pre   : {str(row['sahi'])[0]}/{str(row['preprocess'])[0]}{' '*(13)}│")
        print(f"  │ Size         : {row['size_MB']} MB{' '*(11-len(str(row['size_MB'])))}│")
        print(f"  │ Params       : {row['params_M']} M{' '*(12-len(str(row['params_M'])))}│")
        print(f"  └─────────────────────────────────┘")
    except Exception as e:
        print(f"  ❌ SKIPPED {model_name}: {e}")
        import traceback; traceback.print_exc()
        gc.collect()
        _safe_cuda_empty_cache()

# Save CSVs
_cols = [
    "model", "mAP@0.5", "mAP@0.5:0.95", "precision", "recall", "F1",
    "speed_ms/img", "neg_acc", "sahi", "preprocess", "size_MB", "params_M",
]
df = pd.DataFrame(rows, columns=_cols) if rows else pd.DataFrame(columns=_cols)
df.to_csv(RESULTS_CSV, index=False)

if all_per_class:
    df_pc = pd.DataFrame(all_per_class).T
else:
    df_pc = pd.DataFrame(columns=CLASS_NAMES)
df_pc.index.name = "model"
df_pc.to_csv(PERCLASS_CSV)

print(f"\n✅ Saved -> {RESULTS_CSV} ({len(df)} row(s))")
print(f"✅ Saved -> {PERCLASS_CSV}")
"""

# ══════════════════════════════════════════════════════════════
# CELL 6: Display Results Table
# ══════════════════════════════════════════════════════════════

# --- paste into cell 6 ---
"""
from IPython.display import display

_csv = Path(RESULTS_CSV)
if not _csv.is_file() or _csv.stat().st_size < 5:
    print("No results CSV yet.")
else:
    df = pd.read_csv(RESULTS_CSV)
    if df.empty or "model" not in df.columns:
        print("Empty CSV.")
    else:
        print("=" * 60)
        print("  YOLOv8 BENCHMARK — OOD Dataset (22 classes)")
        print("=" * 60)
        styled = (
            df.style
            .set_caption("YOLOv8 Benchmark — OOD Dataset")
            .format({
                "mAP@0.5":      "{:.4f}",
                "mAP@0.5:0.95": "{:.4f}",
                "precision":    "{:.4f}",
                "recall":       "{:.4f}",
                "F1":           "{:.4f}",
                "neg_acc":      "{:.4f}",
                "speed_ms/img": "{:.1f} ms",
                "size_MB":      "{:.1f} MB",
                "params_M":     "{:.1f} M",
            })
            .highlight_max(subset=["mAP@0.5", "mAP@0.5:0.95", "precision", "recall", "F1", "neg_acc"], color="#2d6a2e")
            .highlight_min(subset=["speed_ms/img", "size_MB", "params_M"], color="#1a5276")
            .set_properties(**{"text-align": "center", "font-size": "13px"})
            .set_table_styles([
                {"selector": "caption", "props": [("font-size", "16px"), ("font-weight", "bold"), ("padding", "10px")]},
                {"selector": "th", "props": [("background-color", "#1a1a2e"), ("color", "white"), ("padding", "8px")]},
            ])
            .hide(axis="index")
        )
        display(styled)
"""

# ══════════════════════════════════════════════════════════════
# CELL 7: Per-Class Table
# ══════════════════════════════════════════════════════════════

# --- paste into cell 7 ---
"""
_pcsv = Path(PERCLASS_CSV)
if _pcsv.is_file() and _pcsv.stat().st_size > 5:
    df_pc = pd.read_csv(PERCLASS_CSV, index_col=0)
    if not df_pc.empty:
        print("Per-class mAP@0.5 across YOLOv8 variants")
        print("-" * 60)
        styled_pc = (
            df_pc.style
            .set_caption("Per-Class mAP@0.5 — YOLOv8 Benchmark")
            .format("{:.4f}")
            .background_gradient(cmap="RdYlGn", axis=None, vmin=0, vmax=1)
            .set_properties(**{"text-align": "center", "font-size": "12px"})
            .set_table_styles([
                {"selector": "caption", "props": [("font-size", "15px"), ("font-weight", "bold")]},
                {"selector": "th", "props": [("background-color", "#1a1a2e"), ("color", "white"), ("font-size", "11px"), ("padding", "6px")]},
            ])
        )
        display(styled_pc)
"""

# ══════════════════════════════════════════════════════════════
# CELL 8: Charts
# ══════════════════════════════════════════════════════════════

# --- paste into cell 8 ---
"""
import matplotlib.pyplot as plt

_csv = Path(RESULTS_CSV)
if _csv.is_file() and _csv.stat().st_size > 5:
    df = pd.read_csv(RESULTS_CSV)
    if not df.empty and "model" in df.columns:
        fig, axes = plt.subplots(1, 3, figsize=(18, 5))
        axes[0].barh(df["model"], df["mAP@0.5"], color="#2d6a2e")
        axes[0].set_xlabel("mAP@0.5")
        axes[0].set_title("Accuracy (mAP@0.5)")
        axes[0].set_xlim(0, 1)
        axes[1].barh(df["model"], df["speed_ms/img"], color="#1a5276")
        axes[1].set_xlabel("ms / image")
        axes[1].set_title("Inference Speed")
        axes[2].barh(df["model"], df["size_MB"], color="#c0392b")
        axes[2].set_xlabel("MB")
        axes[2].set_title("Model Size")
        plt.suptitle("YOLOv8 Benchmark — OOD Dataset", fontsize=16, fontweight="bold")
        plt.tight_layout()
        plt.savefig("benchmark_yolov8_chart.png", dpi=150, bbox_inches="tight")
        plt.show()
"""

# ══════════════════════════════════════════════════════════════
# CELL 9: Download best weights
# ══════════════════════════════════════════════════════════════

# --- paste into cell 9 ---
"""
import shutil

# Copy all best.pt weights to /kaggle/working/ for easy download
for model_name in MODELS:
    run_name = model_name.replace(".pt", "") + "_ood"
    best = Path(f"/kaggle/working/runs/detect/{run_name}/weights/best.pt")
    if best.exists():
        dst = Path(f"/kaggle/working/{run_name}_best.pt")
        shutil.copy2(best, dst)
        print(f"✅ {dst.name} ({dst.stat().st_size / 1e6:.1f} MB)")

# Also copy the CSVs
for f in [RESULTS_CSV, PERCLASS_CSV]:
    if Path(f).exists():
        print(f"✅ {f}")
"""
