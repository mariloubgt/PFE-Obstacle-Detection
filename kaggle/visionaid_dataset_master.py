# ==============================================================================
# VISIONAID DATASET MASTER FIXER (22 CLASSES) - KAGGLE VERSION
# ==============================================================================
# Ce script prépare votre dataset pour le training final :
# 1. COCO Integration (Person, Traffic Light)
# 2. Grounding DINO Auto-labeling (Tree, Pole, Street Light)
# 3. Negative Samples (Images sans obstacles)
# ==============================================================================


import os
import shutil
import yaml
import numpy as np
from pathlib import Path
from collections import Counter

# Import techniques
try:
    import fiftyone as fo
    import fiftyone.zoo as foz
    FIFTYONE_AVAILABLE = True
except ImportError:
    FIFTYONE_AVAILABLE = False

from ultralytics import YOLOWorld

# ─── 1. CONFIGURATION ───
ORIGINAL_DATA_YAML = "/kaggle/input/visionaid-dataset/data.yaml" # À adapter
WORKING_DIR = Path("/kaggle/working/visionaid_dataset_v22")

CLASS_NAMES = [
    'bench', 'bicycle', 'bus', 'bus_stop', 'car', 'crutch', 'curb', 'dog',
    'fire_hydrant', 'motorcycle', 'person', 'pole', 'spherical_roadblock',
    'stairs', 'stop_sign', 'street_light', 'traffic_light', 'train', 'tree',
    'truck', 'warning_column', 'waste_container'
]

# ─── 2. SETUP DIRECTORIES & INITIAL COPY ───
def setup_dirs(src_path):
    if WORKING_DIR.exists():
        print(f"♻️  Working directory {WORKING_DIR} already exists. Skipping initial copy.")
        return

    print(f"📂 Copying original dataset from {src_path} to {WORKING_DIR}...")
    # On commence par copier tout le dataset original comme base
    shutil.copytree(src_path, WORKING_DIR)
    print("✅ Initial copy complete.")

# ─── 3. COCO INJECTION (PERSON & TRAFFIC LIGHT) ───
def coco_injection(num_samples=500):
    if not FIFTYONE_AVAILABLE:
        print("⚠️ FiftyOne is not installed. Run !pip install fiftyone first.")
        return
    
    train_img_dir = WORKING_DIR / 'train' / 'images'
    # Sécurité : on regarde si des images coco- sont déjà là
    if list(train_img_dir.glob("coco_*")):
        print("⏭️  COCO samples already detected in dataset. Skipping injection.")
        return

    print(f"📥 [STEP 1/3] Injecting {num_samples} COCO samples...")
    
    # 1. Charger COCO depuis le Zoo (uniquement les classes qui nous intéressent)
    dataset = foz.load_zoo_dataset(
        "coco-2017",
        splits=["train"],
        label_types=["detections"],
        classes=["person", "traffic light"],
        max_samples=num_samples,
    )
    
    # VisionAid IDs: Person = 10, Traffic Light = 16
    COCO_MAP = {"person": 10, "traffic light": 16}
    
    # 2. Exporter vers le format YOLO et fusionner
    train_img_dir = WORKING_DIR / 'train' / 'images'
    train_lbl_dir = WORKING_DIR / 'train' / 'labels'
    
    for sample in dataset:
        src_path = Path(sample.filepath)
        dst_path = train_img_dir / ("coco_" + src_path.name)
        
        # Copier l'image
        shutil.copy(src_path, dst_path)
        
        # Créer le label YOLO
        lbl_path = train_lbl_dir / (dst_path.stem + ".txt")
        with open(lbl_path, "w") as f:
            # FiftyOne charge COCO dans 'ground_truth' par défaut
            if sample.ground_truth is not None:
                for det in sample.ground_truth.detections:
                    if det.label in COCO_MAP:
                        cls_id = COCO_MAP[det.label]
                        x, y, w, h = det.bounding_box
                        cx, cy = x + w/2, y + h/2
                        f.write(f"{cls_id} {cx} {cy} {w} {h}\n")
    
    print(f"✅ Successfully injected COCO samples into {train_img_dir}")

# ─── 4. AUTO-LABELING (YOLO-WORLD) ───
def auto_label_missing_objects(confidence_threshold=0.25):
    tag_file = WORKING_DIR / ".auto_label_full_done"
    if tag_file.exists():
        print("⏭️  Full Auto-labeling already done. Skipping.")
        return

    print("🔍 [STEP 2/3] Scanning ENTIRE dataset (12k+ images) for missing Trees and Poles...")
    model = YOLOWorld('yolov8s-worldv2.pt') 
    model.set_classes(["tree", "pole"])
    MAP_ID = {0: 18, 1: 11} 
    
    train_img_dir = WORKING_DIR / 'train' / 'images'
    train_lbl_dir = WORKING_DIR / 'train' / 'labels'
    
    images = list(train_img_dir.glob("*.jpg"))
    print(f"Processing {len(images)} images... (This may take 10-15 mins on Kaggle GPU)")

    count_added = 0
    # On traite TOUTES les images cette fois
    for img_p in images:
        # On évite de traiter les images COCO qu'on vient d'ajouter (elles sont déjà ok)
        if "coco_" in img_p.name: continue
        
        results = model.predict(str(img_p), conf=confidence_threshold, verbose=False)
        lbl_p = train_lbl_dir / (img_p.stem + ".txt")
        new_annotations = []
        
        for box in results[0].boxes:
            cls_id = int(box.cls[0])
            target_id = MAP_ID[cls_id]
            xywh = box.xywhn[0].tolist()
            new_annotations.append(f"{target_id} {' '.join(map(str, xywh))}")
            
        if new_annotations:
            with open(lbl_p, "a") as f:
                for line in new_annotations:
                    f.write(line + "\n")
            count_added += len(new_annotations)
    
    tag_file.touch()
    print(f"✅ Full Auto-labeling complete. Added {count_added} boxes to your dataset!")

# ─── 5. CLASS BALANCING (LIMIT PERSON TO 2500) ───
import random

def balance_classes(max_person=2500):
    print(f"⚖️ [STEP 3/4] Balancing classes (Limiting 'person' to {max_person})...")
    train_lbl_dir = WORKING_DIR / 'train' / 'labels'
    
    # 1. Lister toutes les annotations 'person' (ID 10)
    person_locations = [] # [(file_path, line_index, line_content), ...]
    
    for lbl_p in train_lbl_dir.glob("*.txt"):
        with open(lbl_p, "r") as f:
            lines = f.readlines()
        for i, line in enumerate(lines):
            if line.startswith("10 "): # ID 10 = Person
                person_locations.append((lbl_p, i))
                
    curr_count = len(person_locations)
    print(f"  - Currently have {curr_count} persons.")
    
    if curr_count > max_person:
        to_remove = curr_count - max_person
        print(f"  - Removing {to_remove} excess person annotations...")
        
        # Tirage aléatoire des annotations à supprimer
        random.shuffle(person_locations)
        remove_map = {} # {file_path: [indices_to_remove]}
        for i in range(to_remove):
            f_path, line_idx = person_locations[i]
            if f_path not in remove_map: remove_map[f_path] = []
            remove_map[f_path].append(line_idx)
            
        # Appliquer la suppression
        for f_path, indices in remove_map.items():
            with open(f_path, "r") as f:
                lines = f.readlines()
            # On garde seulement les lignes qui ne sont pas dans indices
            new_lines = [line for idx, line in enumerate(lines) if idx not in indices]
            with open(f_path, "w") as f:
                f.writelines(new_lines)
    
    print("✅ Balancing complete.")

# ─── 6. DATASET STATISTICS REPORT ───
def report_dataset_stats(dataset_path):
    print(f"\n📊 [STATS] Analyzing Dataset: {dataset_path}")
    stats = {"images": 0, "annotations": 0, "classes": Counter()}
    
    for split in ['train', 'valid', 'test']:
        img_dir = Path(dataset_path) / split / 'images'
        lbl_dir = Path(dataset_path) / split / 'labels'
        
        if not img_dir.exists(): continue
        
        imgs = list(img_dir.glob("*.jpg"))
        stats["images"] += len(imgs)
        
        for lbl in lbl_dir.glob("*.txt"):
            with open(lbl, "r") as f:
                lines = f.readlines()
                stats["annotations"] += len(lines)
                for line in lines:
                    cls_id = int(line.split()[0])
                    cls_name = CLASS_NAMES[cls_id] if cls_id < len(CLASS_NAMES) else f"ID_{cls_id}"
                    stats["classes"][cls_name] += 1
    
    print(f"  - Total Images: {stats['images']}")
    print(f"  - Total Annotations: {stats['annotations']}")
    print("  - Per-Class Breakdown:")
    for cls, count in stats["classes"].most_common():
        print(f"    {cls:20s}: {count}")

# ─── 7. FINAL V22 YAML GENERATION ───
def generate_v22_yaml():
    print("📝 Generating data_v22.yaml...")
    v22_cfg = {
        'path': str(WORKING_DIR),
        'train': 'train/images',
        'val': 'valid/images',
        'test': 'test/images',
        'nc': 22,
        'names': CLASS_NAMES
    }
    with open('/kaggle/working/data_v22.yaml', 'w') as f:
        yaml.dump(v22_cfg, f)
    print("✅ data_v22.yaml created successfully!")

# ─── EXECUTION ───
if __name__ == "__main__":
    # 1. Rapport initial (Dataset Source)
    input_path = Path(ORIGINAL_DATA_YAML).parent
    if input_path.exists():
        print("📊 [BEFORE] ORIGINAL DATASET STATS:")
        report_dataset_stats(input_path)
        
        # 2. Préparation du dossier de travail (Copie initiale)
        setup_dirs(input_path)
    else:
        print(f"⚠️ Error: Could not find original dataset at {input_path}")
        print("Please check the path in ORIGINAL_DATA_YAML.")
        exit(1)
    
    # 3. Exécuter les étapes de FIX
    coco_injection(num_samples=0) # On peut mettre 0 si on a déjà trop de personnes
    auto_label_missing_objects()
    balance_classes(max_person=2500) # RÉÉQUILIBRAGE ICI
    add_negative_samples(ratio=0.1) 
    
    generate_v22_yaml()
    
    # 3. Rapport final (New Dataset)
    print("\n📊 [AFTER] PROCESSED DATASET STATS:")
    report_dataset_stats(WORKING_DIR)
    print("\n🚀 DATASET READY FOR 22-CLASS TRAINING")
