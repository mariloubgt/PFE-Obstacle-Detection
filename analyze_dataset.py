"""Quick dataset health check."""
from pathlib import Path
from collections import Counter

dataset = Path("dataset")

# 1. Bbox sanity
out_of_range = 0
for s in ["train", "valid", "test"]:
    lbl_dir = dataset / s / "labels"
    if not lbl_dir.exists():
        continue
    for lf in lbl_dir.glob("*.txt"):
        content = lf.read_text().strip()
        if not content:
            continue
        for ln, line in enumerate(content.split("\n"), 1):
            parts = line.strip().split()
            if len(parts) >= 5:
                try:
                    vals = [float(x) for x in parts[1:5]]
                    for v in vals:
                        if v < 0 or v > 1:
                            out_of_range += 1
                            if out_of_range <= 5:
                                print(f"  OOR: {lf.name}:{ln} -> {vals}")
                            break
                except ValueError:
                    pass
if out_of_range == 0:
    print("All bbox values in [0,1] - OK")
else:
    print(f"{out_of_range} annotations with values outside [0,1]")

# 2. Image sizes
try:
    from PIL import Image
    sizes = Counter()
    for s in ["train", "valid", "test"]:
        img_dir = dataset / s / "images"
        imgs = [f for f in img_dir.iterdir() if f.suffix.lower() in {".jpg", ".jpeg", ".png"}]
        for ip in imgs[:200]:
            try:
                with Image.open(ip) as im:
                    sizes[im.size] += 1
            except Exception:
                pass
    print("\nTop image sizes (w x h):")
    for sz, cnt in sizes.most_common(10):
        print(f"  {sz[0]}x{sz[1]}: {cnt} images")
except ImportError:
    print("PIL not available, skipping image size check")

# 3. data.yaml path check
print("\n--- data.yaml path check ---")
import yaml
with open("dataset/data.yaml") as f:
    cfg = yaml.safe_load(f)
print(f"  path: {cfg.get('path', 'NOT SET')}")
print(f"  train: {cfg.get('train', 'NOT SET')}")
print(f"  val: {cfg.get('val', 'NOT SET')}")
print(f"  test: {cfg.get('test', 'NOT SET')}")
p = Path(cfg["path"])
if p.is_absolute():
    print(f"  WARNING: path is ABSOLUTE -> {p}")
    print("  This will BREAK on Kaggle where datasets mount at /kaggle/input/...")

# 4. Check what prepare_kaggle.py puts in the ZIP
print("\n--- ZIP data.yaml check ---")
import zipfile, io
for zname in ["outdoor_for_kaggle.zip"]:
    zpath = Path(zname)
    if not zpath.exists():
        print(f"  {zname} not found, skipping")
        continue
    with zipfile.ZipFile(zpath) as zf:
        if "data.yaml" in zf.namelist():
            content = zf.read("data.yaml").decode()
            print(f"  [{zname}] data.yaml contents:")
            for line in content.strip().split("\n"):
                print(f"    {line}")
        else:
            print(f"  [{zname}] NO data.yaml found inside ZIP!")
