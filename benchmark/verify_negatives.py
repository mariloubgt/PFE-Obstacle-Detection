"""
Helper script to verify negative samples in the dataset.
Counts images without labels (background images) in the test set.
"""
import os
from pathlib import Path
import yaml

def verify_dataset_negatives(data_yaml):
    with open(data_yaml) as f:
        cfg = yaml.safe_load(f)
    
    root = Path(cfg.get('path', '.'))
    test_split = cfg.get('test', 'test/images')
    
    img_dir = root / test_split
    lbl_dir = root / test_split.replace('images', 'labels')
    
    if not img_dir.exists():
        print(f"Error: Image directory {img_dir} does not exist.")
        return
    
    images = list(img_dir.glob("*.*"))
    total_images = len(images)
    negative_samples = 0
    positive_samples = 0
    
    for img_path in images:
        lbl_path = lbl_dir / (img_path.stem + ".txt")
        if not lbl_path.exists() or lbl_path.stat().st_size == 0:
            negative_samples += 1
        else:
            positive_samples += 1
            
    print(f"\n--- Dataset Composition ({test_split}) ---")
    print(f"Total Images:     {total_images}")
    print(f"Positive Samples:  {positive_samples} ({positive_samples/total_images:.1%})")
    print(f"Negative Samples:  {negative_samples} ({negative_samples/total_images:.1%})")
    print("-" * 40)
    
    return negative_samples, total_images

if __name__ == "__main__":
    # Example usage for local testing
    if Path("dataset/data.yaml").exists():
        verify_dataset_negatives("dataset/data.yaml")
