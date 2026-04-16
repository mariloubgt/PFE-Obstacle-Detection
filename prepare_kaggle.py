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

ROOT = Path(__file__).parent.resolve()

def create_kaggle_zip(source_dir, yaml_name, zip_name, class_names):
    zip_path = ROOT / zip_name
    if not source_dir.is_dir():
        print(f"Skipping {zip_name}: source directory {source_dir} not found.")
        return
        
    print(f"Creating {zip_name}...")
    
    # Create the internal data.yaml (relative paths)
    yaml_content = f"""path: .
train: train/images
val: valid/images
test: test/images

nc: {len(class_names)}
names: {class_names}
"""
    
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        zipf.writestr("data.yaml", yaml_content)
        for root, dirs, files in os.walk(source_dir):
            for file in files:
                file_path = Path(root) / file
                arcname = file_path.relative_to(source_dir)
                zipf.write(file_path, arcname)
                
    print(f"  Done: {zip_name} ({zip_path.stat().st_size / 1024 / 1024:.1f} MB)")

def main():
    # Indoor Only
    indoor_classes = ['chair', 'clock', 'exit', 'fireextinguisher', 'printer', 'screen', 'trashbin']
    create_kaggle_zip(ROOT / "dataset_indoor_yolo_new", "data.yaml", "indoor_for_kaggle.zip", indoor_classes)

if __name__ == "__main__":
    main()
