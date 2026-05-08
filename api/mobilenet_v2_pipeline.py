from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import torch
from PIL import Image
from torchvision import models, transforms


@dataclass
class MobileNetConfig:
    enabled: bool
    scene_checkpoint: str | None
    nav_checkpoint: str | None
    scene_labels: list[str]
    nav_labels: list[str]
    device: str


class MobileNetV2Classifier:
    """Simple MobileNetV2 classifier wrapper for transfer-learning checkpoints."""

    def __init__(self, checkpoint_path: str | None, labels: list[str], device: str):
        self.labels = labels
        self.device = torch.device(device)
        self.model = self._build_model(num_classes=len(labels))
        self.available = False
        self.error: str | None = None

        if checkpoint_path:
            self._load_checkpoint(checkpoint_path)
        else:
            self.error = "No checkpoint path provided."

    def _build_model(self, num_classes: int) -> torch.nn.Module:
        weights = models.MobileNet_V2_Weights.IMAGENET1K_V2
        model = models.mobilenet_v2(weights=weights)
        in_features = model.classifier[1].in_features
        model.classifier[1] = torch.nn.Linear(in_features, num_classes)
        model.to(self.device)
        model.eval()
        return model

    def _load_checkpoint(self, checkpoint_path: str) -> None:
        try:
            ckpt = torch.load(checkpoint_path, map_location=self.device)
            state = ckpt["state_dict"] if isinstance(ckpt, dict) and "state_dict" in ckpt else ckpt
            self.model.load_state_dict(state, strict=False)
            self.available = True
        except Exception as exc:  # noqa: BLE001 - keep server alive on model load errors
            self.error = f"Failed to load checkpoint: {exc}"

    @torch.inference_mode()
    def predict_topk(self, image: Image.Image, topk: int = 3) -> list[dict[str, Any]] | None:
        if not self.available:
            return None

        tfm = transforms.Compose(
            [
                transforms.Resize((224, 224)),
                transforms.ToTensor(),
                transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
            ]
        )
        x = tfm(image).unsqueeze(0).to(self.device)
        logits = self.model(x)
        probs = torch.softmax(logits, dim=1)[0]
        k = min(topk, len(self.labels))
        vals, idxs = torch.topk(probs, k=k)
        out: list[dict[str, Any]] = []
        for p, i in zip(vals.tolist(), idxs.tolist()):
            out.append({"label": self.labels[i], "probability": round(float(p), 4)})
        return out


class MobileNetV2ImageNetScene:
    """Ready-to-use scene/object tags from pure pretrained ImageNet MobileNetV2."""

    def __init__(self, device: str):
        self.device = torch.device(device)
        self.available = False
        self.error: str | None = None
        try:
            self.weights = models.MobileNet_V2_Weights.IMAGENET1K_V2
            self.model = models.mobilenet_v2(weights=self.weights).to(self.device).eval()
            self.labels = list(self.weights.meta.get("categories", []))
            self.tfm = self.weights.transforms()
            self.available = True
        except Exception as exc:  # noqa: BLE001
            self.error = f"Failed to load pretrained ImageNet MobileNetV2: {exc}"

    @torch.inference_mode()
    def predict_topk(self, image: Image.Image, topk: int = 5) -> list[dict[str, Any]] | None:
        if not self.available:
            return None
        x = self.tfm(image).unsqueeze(0).to(self.device)
        logits = self.model(x)
        probs = torch.softmax(logits, dim=1)[0]
        k = min(topk, len(self.labels))
        vals, idxs = torch.topk(probs, k=k)
        return [{"label": self.labels[i], "probability": round(float(p), 4)} for p, i in zip(vals.tolist(), idxs.tolist())]


def _split_labels(raw: str | None, fallback: list[str]) -> list[str]:
    if not raw:
        return fallback
    labels = [s.strip() for s in raw.split(",") if s.strip()]
    return labels if labels else fallback


def _load_labels_from_json(path_str: str | None, fallback: list[str]) -> list[str]:
    if not path_str:
        return fallback
    path = Path(path_str)
    if not path.exists():
        return fallback
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, list):
            labels = [str(x).strip() for x in payload if str(x).strip()]
            return labels if labels else fallback
    except Exception:  # noqa: BLE001
        return fallback
    return fallback


def _default_scene_labels() -> list[str]:
    return ["indoor", "outdoor", "street", "corridor", "stairs"]


def _default_nav_labels() -> list[str]:
    return ["go_forward", "slow_down", "turn_left", "turn_right", "stop"]


def load_config() -> MobileNetConfig:
    enabled = os.environ.get("ENABLE_MOBILENET_V2", "0").strip().lower() in ("1", "true", "yes", "on")
    scene_checkpoint = (os.environ.get("MBV2_SCENE_CKPT") or "").strip() or None
    nav_checkpoint = (os.environ.get("MBV2_NAV_CKPT") or "").strip() or None

    scene_labels = _load_labels_from_json(
        (os.environ.get("MBV2_SCENE_LABELS_JSON") or "").strip() or None,
        _split_labels(os.environ.get("MBV2_SCENE_LABELS"), _default_scene_labels()),
    )
    nav_labels = _load_labels_from_json(
        (os.environ.get("MBV2_NAV_LABELS_JSON") or "").strip() or None,
        _split_labels(os.environ.get("MBV2_NAV_LABELS"), _default_nav_labels()),
    )

    auto_device = "cuda" if torch.cuda.is_available() else "cpu"
    device = (os.environ.get("MBV2_DEVICE") or auto_device).strip()
    return MobileNetConfig(enabled, scene_checkpoint, nav_checkpoint, scene_labels, nav_labels, device)


class MobileNetV2Pipeline:
    def __init__(self):
        cfg = load_config()
        self.config = cfg

        if not cfg.enabled:
            self.scene_model = None
            self.nav_model = None
            self.scene_imagenet = None
            return

        self.scene_model = MobileNetV2Classifier(cfg.scene_checkpoint, cfg.scene_labels, cfg.device)
        self.nav_model = MobileNetV2Classifier(cfg.nav_checkpoint, cfg.nav_labels, cfg.device)
        self.scene_imagenet = MobileNetV2ImageNetScene(cfg.device)

    def scene_top5(self, image: Image.Image) -> list[dict[str, Any]] | None:
        if self.scene_model is None:
            return None
        # If fine-tuned scene checkpoint exists, use it. Otherwise use pure ImageNet pretrained model.
        top = self.scene_model.predict_topk(image, topk=5)
        if top:
            return top
        if self.scene_imagenet is None:
            return None
        return self.scene_imagenet.predict_topk(image, topk=5)

    def navigation(self, image: Image.Image, detections: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        if self.nav_model is None:
            return {"label": None, "probability": None, "error": "MobileNetV2 disabled."}
        top = self.nav_model.predict_topk(image, topk=1)
        if top:
            first = top[0]
            return {"label": first["label"], "probability": first["probability"], "error": None}

        # No navigation checkpoint: fallback heuristic so API can be called without training.
        if not detections:
            err = self.nav_model.error if self.nav_model else "Navigation model unavailable."
            return {"label": None, "probability": None, "error": err}
        with_dist = [d for d in detections if isinstance(d.get("distance_m"), (int, float))]
        if not with_dist:
            return {"label": "go_forward", "probability": 0.5, "error": "Heuristic fallback (no distance)."}
        closest = min(with_dist, key=lambda d: float(d["distance_m"]))
        dist = float(closest["distance_m"])
        cx = (float(closest.get("x1", 0.5)) + float(closest.get("x2", 0.5))) / 2.0
        if dist < 1.0:
            return {"label": "stop", "probability": 0.9, "error": "Heuristic fallback (no nav checkpoint)."}
        if dist < 2.0:
            if cx < 0.4:
                return {"label": "turn_right", "probability": 0.75, "error": "Heuristic fallback (no nav checkpoint)."}
            if cx > 0.6:
                return {"label": "turn_left", "probability": 0.75, "error": "Heuristic fallback (no nav checkpoint)."}
            return {"label": "slow_down", "probability": 0.7, "error": "Heuristic fallback (no nav checkpoint)."}
        return {"label": "go_forward", "probability": 0.65, "error": "Heuristic fallback (no nav checkpoint)."}

    def status(self) -> dict[str, Any]:
        if not self.config.enabled:
            return {"enabled": False, "error": "ENABLE_MOBILENET_V2=0"}
        return {
            "enabled": True,
            "device": self.config.device,
            "scene_loaded": bool(self.scene_model and self.scene_model.available),
            "scene_error": self.scene_model.error if self.scene_model else None,
            "scene_imagenet_loaded": bool(self.scene_imagenet and self.scene_imagenet.available),
            "scene_imagenet_error": self.scene_imagenet.error if self.scene_imagenet else None,
            "nav_loaded": bool(self.nav_model and self.nav_model.available),
            "nav_error": self.nav_model.error if self.nav_model else None,
        }
