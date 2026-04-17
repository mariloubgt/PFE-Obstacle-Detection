import json
import os
from pathlib import Path

# Config
OUTDOOR_CLASSES = ['bench', 'bicycle', 'bus', 'bus_stop', 'car', 'crutch', 'curb', 'dog', 'fire_hydrant', 'motorcycle', 'person', 'pole', 'spherical_roadblock', 'stairs', 'stop_sign', 'street_light', 'traffic_light', 'train', 'tree', 'truck', 'warning_column', 'waste_container']
INDOOR_CLASSES = ['chair', 'clock', 'exit', 'fireextinguisher', 'printer', 'screen', 'trashbin']

OUTDOOR_DIR = Path("benchmark")
INDOOR_DIR = Path("benchmark_indoor")

OUTDOOR_NOTEBOOKS = ["yolov8.ipynb", "yolov10.ipynb", "yolov11.ipynb", "yolov12.ipynb", "yolov26.ipynb"]
INDOOR_NOTEBOOKS = ["YOLOv8.ipynb", "YOLOv10.ipynb", "YOLOv11.ipynb", "YOLOv12.ipynb", "YOLO26.ipynb"]

def revert_to_outdoor(nb_path):
    print(f"Reverting {nb_path} to Outdoor focus...")
    with open(nb_path, 'r', encoding='utf-8') as f:
        nb = json.load(f)
        
    for cell in nb['cells']:
        if cell['cell_type'] == 'markdown':
            source = "".join(cell['source'])
            if "Benchmark on Indoor Dataset" in source:
                new_source = source.replace("Benchmark on Indoor Dataset (7 classes)", "Benchmark on OOD Dataset (22 classes)")
                new_source = new_source.replace("_indoor*", "_ood*")
                cell['source'] = [new_source]
                
        if cell['cell_type'] == 'code':
            source = "".join(cell['source'])
            
            # Remove Kaggle specific logic if teammate doesn't expect it (actually just revert paths)
            if "if IS_KAGGLE:" in source:
                new_lines = []
                in_kaggle_block = False
                for line in cell['source']:
                    if "if IS_KAGGLE:" in line:
                        in_kaggle_block = True
                        continue
                    elif in_kaggle_block and "else:" in line:
                        in_kaggle_block = False
                        continue
                    elif in_kaggle_block and (line.startswith("    ") or line.startswith("\t")):
                        continue
                    else:
                        if "DATA_YAML =" in line and "=" in line:
                            new_lines.append("DATA_YAML    = \"../data.yaml\"\n")
                        elif "TEST_IMG_DIR =" in line and "=" in line:
                            new_lines.append("TEST_IMG_DIR = Path(\"../dataset/test/images\")\n")
                        else:
                            new_lines.append(line)
                cell['source'] = new_lines
                source = "".join(cell['source'])

            # Classes
            if "CLASS_NAMES =" in source:
                cell['source'] = [f"CLASS_NAMES = {json.dumps(OUTDOOR_CLASSES)}\n"]
            
            # Suffixes
            if "_indoor" in source:
                cell['source'] = [line.replace("_indoor", "_ood") for line in cell['source']]

    with open(nb_path, 'w', encoding='utf-8') as f:
        json.dump(nb, f, indent=1)

def fix_indoor_paths(nb_path):
    print(f"Fixing paths in {nb_path}...")
    with open(nb_path, 'r', encoding='utf-8') as f:
        nb = json.load(f)
        
    for cell in nb['cells']:
        if cell['cell_type'] == 'code':
            source = "".join(cell['source'])
            
            # Replace hardcoded speed benchmark paths with the global TEST_IMG_DIR variable
            if "test_img_dir = Path(" in source:
                new_lines = []
                for line in cell['source']:
                    if "test_img_dir = Path(" in line:
                        new_lines.append("    test_img_dir = TEST_IMG_DIR\n")
                    else:
                        new_lines.append(line)
                cell['source'] = new_lines

    with open(nb_path, 'w', encoding='utf-8') as f:
        json.dump(nb, f, indent=1)

if __name__ == "__main__":
    # 1. Revert Outdoor
    for nb in OUTDOOR_NOTEBOOKS:
        p = OUTDOOR_DIR / nb
        if p.exists():
            revert_to_outdoor(p)
            
    # 2. Fix Indoor
    for nb in INDOOR_NOTEBOOKS:
        p = INDOOR_DIR / nb
        if p.exists():
            fix_indoor_paths(p)
