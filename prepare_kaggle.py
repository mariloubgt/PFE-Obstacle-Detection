"""
Create Kaggle-ready ZIP files for both datasets.
Structure:
- data.yaml (with relative paths)
- train/
- valid/
- test/
"""
import zipfile, os, sys
from pathlib import Path

ROOT = Path(r"c:\Users\admin\PFE\PFE-Obstacle-Detection")

def create_kaggle_zip(source_dir, yaml_name, zip_name, class_names):
    zip_path = ROOT / zip_name
    print(f"Creating {zip_name}...")
    
    # Create the internal data.yaml (relative paths)
    # Since the zip will flatten the structure (train/, valid/, test/ at root)
    # the path should be '.'
    yaml_content = f"""path: .
train: train/images
val: valid/images
test: test/images

nc: {len(class_names)}
names: {class_names}
"""
    
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        # Add the YAML
        zipf.writestr("data.yaml", yaml_content)
        
        # Add the dataset files
        # We walk through source_dir and add them with relative paths
        for root, dirs, files in os.walk(source_dir):
            for file in files:
                file_path = Path(root) / file
                # Relative path inside the zip should be split/subdir/file
                arcname = file_path.relative_to(source_dir)
                zipf.write(file_path, arcname)
                
    print(f"  Done: {zip_name} ({zip_path.stat().st_size / 1024 / 1024:.1f} MB)")

def main():
    # Outdoor
    outdoor_classes = ['bench', 'bicycle', 'bus', 'bus_stop', 'car', 'crutch', 'curb', 'dog', 'fire_hydrant', 'motorcycle', 'person', 'pole', 'spherical_roadblock', 'stairs', 'stop_sign', 'street_light', 'traffic_light', 'train', 'tree', 'truck', 'warning_column', 'waste_container']
    create_kaggle_zip(ROOT / "dataset", "data.yaml", "outdoor_for_kaggle.zip", outdoor_classes)
    
    # Indoor
    indoor_classes = ['chair', 'clock', 'exit', 'fireextinguisher', 'printer', 'screen', 'trashbin']
    create_kaggle_zip(ROOT / "dataset_indoor_balanced", "data.yaml", "indoor_for_kaggle.zip", indoor_classes)

if __name__ == "__main__":
    main()
