import json

nb_path = r"C:\Users\admin\PFE\PFE-Obstacle-Detection\kaggle\VISIONAID_ACTION_PLAN.ipynb"

with open(nb_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

# Update Action 1 cell
action1_cell = data['cells'][2]
src1 = "".join(action1_cell['source'])
src1 = src1.replace(
    "model = YOLO('runs/detect/VisionAid_ULTIMATE_yolov8/weights/best.pt')",
    "model = YOLO('/kaggle/input/ton-modele-best/best.pt') # ⚠️ METS LE CHEMIN DE TON POIDS UPLOADÉ ICI"
)
action1_cell['source'] = [src1]

# Insert a markdown cell clarifying that the dataset MUST be loaded
data['cells'].insert(1, {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "> [!IMPORTANT]\n",
    "> **POUR QUE L'ACTION 1 FONCTIONNE :** Tu **DOIS** ajouter à la fois ton fichier \n",
    "> **`best.pt`** (le poids de ton modèle) **ET le dataset** dans les _Inputs Kaggle_ ! \n",
    "> Ultralytics a besoin des images de validation et de leurs labels pour calculer le F1-Score et la précision."
   ]
})

# Update Action 2 cell
# Note: Action 2 cell is now index 5
action2_cell = data['cells'][5]
src2 = "".join(action2_cell['source'])
src2 = src2.replace(
    "model = YOLO('yolov8s.pt')",
    "model = YOLO('/kaggle/input/ton-modele-best/best.pt') # ⚠️ ON START DE TON MEILLEUR MODÈLE, pas de Zéro !"
)
action2_cell['source'] = [src2]

with open(nb_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=1)

print("Updated VISIONAID_ACTION_PLAN.ipynb")
