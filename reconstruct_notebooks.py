import json
import os
from pathlib import Path

# Data
OUTDOOR_CLASSES = ['bench', 'bicycle', 'bus', 'bus_stop', 'car', 'crutch', 'curb', 'dog', 'fire_hydrant', 'motorcycle', 'person', 'pole', 'spherical_roadblock', 'stairs', 'stop_sign', 'street_light', 'traffic_light', 'train', 'tree', 'truck', 'warning_column', 'waste_container']
INDOOR_CLASSES = ['chair', 'clock', 'exit', 'fireextinguisher', 'printer', 'screen', 'trashbin']

OUTDOOR_DIR = Path("benchmark")
INDOOR_DIR = Path("benchmark_indoor")

# Templates
def get_outdoor_config(v):
    return [
        "from ultralytics import YOLO\n",
        "from pathlib import Path\n",
        "import pandas as pd\n",
        "import numpy as np\n",
        "import time\n",
        "import gc, torch, os\n",
        "\n",
        "# Only evaluate saved weights for tables by default.\n",
        "RUN_TRAINING = False\n",
        f"BENCHMARK_VARIANTS = [\"{v}n\", \"{v}s\", \"{v}m\"]\n",
        "\n",
        "WORKERS = 2\n",
        "AMP = True\n",
        "RESUME_CKPT = None\n",
        "RESUME_MODEL = None\n",
        "\n",
        "DATA_YAML    = \"../data.yaml\"\n",
        "IMG_SIZE     = 640\n",
        "EPOCHS       = 70\n",
        "BATCH        = 16\n",
        "DEVICE       = 0\n",
        "PATIENCE     = 20\n",
        f"RESULTS_CSV  = \"benchmark_{v}.csv\"\n",
        f"PERCLASS_CSV = \"benchmark_{v}_perclass.csv\"\n",
        "\n",
        f"CLASS_NAMES = {json.dumps(OUTDOOR_CLASSES)}\n",
        "\n",
        "MODELS = [\n",
        f"    \"{v}n.pt\",\n",
        f"    \"{v}s.pt\",\n",
        f"    \"{v}m.pt\",\n",
        "]"
    ]

def get_indoor_config(v):
    name_map = {"yolov8": "YOLOv8", "yolov10": "YOLOv10", "yolov11": "YOLOv11", "yolov12": "YOLOv12", "yolov26": "YOLO26"}
    v_clean = v.replace("yolo", "") # e.g. v8
    return [
        "from ultralytics import YOLO\n",
        "from pathlib import Path\n",
        "import pandas as pd\n",
        "import numpy as np\n",
        "import time\n",
        "import gc, torch, os\n",
        "\n",
        "IS_KAGGLE = os.path.exists(\"/kaggle/input\")\n",
        "\n",
        "def _safe_cuda_empty_cache():\n",
        "    if not torch.cuda.is_available(): return\n",
        "    try: torch.cuda.synchronize()\n",
        "    except: pass\n",
        "    try: torch.cuda.empty_cache()\n",
        "    except: pass\n",
        "\n",
        "RUN_TRAINING = True\n",
        f"BENCHMARK_VARIANTS = [\"{v}n\", \"{v}s\", \"{v}m\"]\n",
        "WORKERS = 2\n",
        "AMP = True\n",
        "RESUME_CKPT = None\n",
        "RESUME_MODEL = None\n",
        "\n",
        "if IS_KAGGLE:\n",
        "    KAGGLE_INPUT = \"/kaggle/input/datasets/mariabouguettaya/dataset-indoor\"\n",
        "    DATA_YAML_ORIG = f\"{KAGGLE_INPUT}/data.yaml\"\n",
        "    DATA_YAML = \"/kaggle/working/data_kaggle.yaml\"\n",
        "    TEST_IMG_DIR = Path(f\"{KAGGLE_INPUT}/test/images\")\n",
        "    import yaml\n",
        "    if os.path.exists(DATA_YAML_ORIG):\n",
        "        with open(DATA_YAML_ORIG, 'r') as f: y_data = yaml.safe_load(f)\n",
        "        y_data['path'] = KAGGLE_INPUT\n",
        "        y_data['train'] = \"train/images\"\n",
        "        y_data['val'] = \"valid/images\"\n",
        "        y_data['test'] = \"test/images\"\n",
        "        with open(DATA_YAML, 'w') as f: yaml.dump(y_data, f)\n",
        "else:\n",
        "    DATA_YAML = \"../data_indoor_balanced.yaml\"\n",
        "    TEST_IMG_DIR = Path(\"../dataset_indoor_yolo_new/test/images\")\n",
        "\n",
        "IMG_SIZE = 640\n",
        "EPOCHS = 100\n",
        "BATCH = 32\n",
        "DEVICE = \"0,1\"\n",
        "PATIENCE = 20\n",
        f"RESULTS_CSV  = \"benchmark_{v}_indoor.csv\"\n",
        f"PERCLASS_CSV = \"benchmark_{v}_indoor_perclass.csv\"\n",
        f"CLASS_NAMES = {json.dumps(INDOOR_CLASSES)}\n",
        "\n",
        "MODELS = [\n",
        f"    \"{v}n.pt\",\n",
        f"    \"{v}s.pt\",\n",
        f"    \"{v}m.pt\",\n",
        "]"
    ]

def patch_nb(path, config_lines, title):
    with open(path, 'r', encoding='utf-8') as f:
        nb = json.load(f)
    for cell in nb['cells']:
        if cell['cell_type'] == 'markdown' and ("Benchmark on" in "".join(cell['source'])):
            cell['source'] = [f"# {title}\n"]
        if cell['cell_type'] == 'code':
            src = "".join(cell['source'])
            if "from ultralytics import YOLO" in src or "CLASS_NAMES =" in src:
                cell['source'] = config_lines
            # Fix function paths globally
            if "test_img_dir = Path(" in src:
                new = []
                for l in cell['source']:
                    if "test_img_dir = Path(\"../dataset/test/images\")" in l or "test_img_dir = Path(\"../dataset_indoor_yolo_new/test/images\")" in l:
                        new.append("    test_img_dir = TEST_IMG_DIR\n")
                    else:
                        new.append(l)
                cell['source'] = new
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(nb, f, indent=1)

if __name__ == "__main__":
    for v in ["yolov8", "yolov10", "yolov11", "yolov12", "yolov26"]:
        # Outdoor
        p_out = OUTDOOR_DIR / f"{v}.ipynb"
        if p_out.exists():
            patch_nb(p_out, get_outdoor_config(v), f"{v.upper()} — Benchmark on OOD Dataset (22 classes)")
        # Indoor
        nb_name = "YOLO26.ipynb" if v == "yolov26" else (f"YOLOv{v.replace('yolov','')}.ipynb")
        p_in = INDOOR_DIR / nb_name
        if p_in.exists():
            patch_nb(p_in, get_indoor_config(v), f"{v.upper()} — Benchmark on Indoor Dataset (7 classes)")
