import os

fp = r"C:\Users\admin\PFE\PFE-Obstacle-Detection\kaggle\benchmark_yolov8.ipynb"
with open(fp, 'r', encoding='utf-8') as f:
    content = f.read()

bad_part = """<<<<<<< HEAD
    "# VisionAid Master Benchmark — 22 Classes (SAHI + Negatives)\\n",
=======
    "# YOLOv8 Benchmark \\u2014 OOD Dataset (17 classes)\\n",
>>>>>>> ad42c176e9a127111dc25617771927880939154f"""

good_part = """    "# VisionAid Master Benchmark — Ultimate\\n","""

if bad_part in content:
    content = content.replace(bad_part, good_part)
    with open(fp, 'w', encoding='utf-8') as f:
        f.write(content)
    print("Fixed markdown conflict in benchmark_yolov8.ipynb")
else:
    print("Conflict not found!")
