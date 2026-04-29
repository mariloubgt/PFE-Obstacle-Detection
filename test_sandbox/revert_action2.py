import json

nb_path = r"C:\Users\admin\PFE\PFE-Obstacle-Detection\kaggle\VISIONAID_ACTION_PLAN.ipynb"

with open(nb_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

# The user wants to revert Action 2 (which is Cell index 5) from using best.pt to yolov8s.pt
action2_cell = data['cells'][5]
src2 = "".join(action2_cell['source'])
src2 = src2.replace(
    "model = YOLO('/kaggle/input/ton-modele-best/best.pt') # ⚠️ ON START DE TON MEILLEUR MODÈLE, pas de Zéro !",
    "model = YOLO('yolov8s.pt') # On part des poids COCO par défaut comme tu l'as demandé"
)
action2_cell['source'] = [src2]

with open(nb_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=1)

print("Reverted Action 2 starting point in VISIONAID_ACTION_PLAN.ipynb")
