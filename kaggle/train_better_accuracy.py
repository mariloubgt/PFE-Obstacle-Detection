"""
Kaggle — entraînement YOLO pour meilleure accuracy (vs yolov8n).

À mettre dans un notebook Kaggle après avoir ajouté ton dataset (Add Data)
et installé: pip install ultralytics

Réglages clés pour monter le mAP:
  - yolov8s ou yolov8m (ou yolov8l si GPU suffisant) au lieu de yolov8n
  - imgsz 800 si objets petits / loin (sinon 640)
  - epochs 120–200, patience 30–40
  - batch: baisser si CUDA out of memory (16 → 8 → 4)

Sur Kaggle, chemin data.yaml souvent:
  /kaggle/input/<nom-du-dataset>/data.yaml
"""

from __future__ import annotations

import os
from pathlib import Path

from ultralytics import YOLO

# ---------------------------------------------------------------------------
# À ADAPTER: chemin vers data.yaml DANS ton input Kaggle
# ---------------------------------------------------------------------------
DATA_YAML = os.environ.get(
    "DATA_YAML",
    "/kaggle/input/your-ood-dataset/data.yaml",
)

# Plus gros = souvent meilleur mAP, plus lent et plus de VRAM
MODEL_NAME = os.environ.get("MODEL_NAME", "yolov8m.pt")  # n < s < m < l < x

# T4 16 Go: imgsz 800 + m → batch souvent 8–12 ; si OOM → imgsz 640 ou batch 4
IMGSZ = int(os.environ.get("IMGSZ", "640"))
EPOCHS = int(os.environ.get("EPOCHS", "120"))
BATCH = int(os.environ.get("BATCH", "12"))
PATIENCE = int(os.environ.get("PATIENCE", "35"))

# Sortie sous /kaggle/working (persisté pour téléchargement)
PROJECT_DIR = os.environ.get("PROJECT_DIR", "/kaggle/working/runs/detect")
RUN_NAME = os.environ.get("RUN_NAME", "yolo_ood_better")


def main() -> None:
    data = Path(DATA_YAML)
    if not data.is_file():
        raise FileNotFoundError(
            f"data.yaml introuvable: {data}\n"
            "Fixe DATA_YAML ou le chemin dans ce script (Add Data sur Kaggle)."
        )

    Path(PROJECT_DIR).mkdir(parents=True, exist_ok=True)

    model = YOLO(MODEL_NAME)

    model.train(
        data=str(data),
        epochs=EPOCHS,
        imgsz=IMGSZ,
        batch=BATCH,
        patience=PATIENCE,
        device=0,
        project=PROJECT_DIR,
        name=RUN_NAME,
        exist_ok=True,
        pretrained=True,
        amp=True,
        cos_lr=True,
        close_mosaic=10,
        # Augmentations fortes (défaut Ultralytics déjà bon; ici léger renfort)
        mosaic=1.0,
        mixup=0.1,
        degrees=5.0,
        translate=0.1,
        scale=0.5,
        fliplr=0.5,
        hsv_h=0.015,
        hsv_s=0.7,
        hsv_v=0.4,
        optimizer="auto",
        verbose=True,
        plots=True,
    )

    # Validation finale sur test si défini dans data.yaml
    metrics = model.val(data=str(data), split="test")
    print("Final metrics:", metrics)


if __name__ == "__main__":
    main()
