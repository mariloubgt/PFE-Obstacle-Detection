# VisionAid: Obstacle Detection for the Visually Impaired 🛡️👁️

VisionAid is an AI-powered co-pilot designed to help visually impaired individuals navigate safely. It detects obstacles in real-time, estimates their distance using a trigonometric pinhole camera model, and provides vocal feedback in **Algerian Darija**.

---

## 🚀 Getting Started

### 1. Prerequisites
- **Python 3.10+** (on PC)
- **Node.js & Expo Go** (on iPhone/Android)
- **Gemini API Key** (from Google AI Studio)

### 2. PC Setup (The Brain)
1. **Clone the repo:**
   ```bash
   git clone https://github.com/mariloubgt/PFE-Obstacle-Detection.git
   cd PFE-Obstacle-Detection
   ```
2. **Create a clean Virtual Environment:**
   ```bash
   python -m venv .venv
   .\.venv\Scripts\activate
   pip install -r requirements.txt
   ```
3. **Configure Environment:**
   - Copy `.env.example` to `.env`.
   - Add your `GEMINI_API_KEY` to the `.env` file.
4. **Start the Inference Server:**
   ```bash
   python api/inference_server.py
   ```
   *Note the IPv4 address of your PC (e.g., http://192.168.1.15:8787).*

### 3. Mobile Setup (The Eyes)
1. **Install dependencies:**
   ```bash
   cd PFE-Mobile-App
   npm install
   ```
2. **Start Expo:**
   ```bash
   npx expo start
   ```
3. **Connect:**
   - Open Expo Go on your phone.
   - Go to **Settings** in the app and enter your PC's IP address (the one from step 2.4).

---

## 📂 Project Structure

- `api/` : FastAPI server and the core Vision Pipeline.
- `pfe/phase3/` : Logic for scene analysis, distance estimation, and TTS.
- `pfe/optimization/` : Elk Herd Optimizer (EHO) for fine-tuning YOLO.
- `PFE-Mobile-App/` : React Native application for real-time navigation.
- `models/` : Trained YOLO `.pt` weights.
- `dataset/` : Active dataset configuration for training.

---

## 🛠️ Key Features
- **Hybrid Inference:** YOLOv8 (Objects) + BLIP-Large (Scene) + Gemini (Context).
- **Precision Distance:** Trigonometric model optimized for close-range safety.
- **Local TTS:** Cached Darija voice alerts with fallback for offline stability.
- **EHO Tuning:** Meta-heuristic optimization of model hyperparameters.

---

## MobileNetV2 Scene + Navigation

You can now run an offline `MobileNetV2` transfer-learning pipeline for:
- **Scene recognition** (top-5 labels),
- **Navigation action classification** (`go_forward`, `slow_down`, `turn_left`, `turn_right`, `stop` by default).

### 1) Train your checkpoints

Prepare datasets in ImageFolder format:
- `dataset/scene/train/<class_name>/*.jpg`
- `dataset/scene/val/<class_name>/*.jpg`
- `dataset/navigation/train/<class_name>/*.jpg`
- `dataset/navigation/val/<class_name>/*.jpg`

Train scene model:
```bash
python scripts/train_mobilenet_v2.py --data-dir dataset/scene --output models/mbv2_scene.pt --labels-json models/mbv2_scene_labels.json --epochs 10
```

Train navigation model:
```bash
python scripts/train_mobilenet_v2.py --data-dir dataset/navigation --output models/mbv2_nav.pt --labels-json models/mbv2_nav_labels.json --epochs 10
```

### 2) Enable in API

Set environment variables before starting the server:
```bash
set ENABLE_MOBILENET_V2=1
set MBV2_SCENE_CKPT=models/mbv2_scene.pt
set MBV2_NAV_CKPT=models/mbv2_nav.pt
set MBV2_SCENE_LABELS_JSON=models/mbv2_scene_labels.json
set MBV2_NAV_LABELS_JSON=models/mbv2_nav_labels.json
```

Then run:
```bash
python api/inference_server.py
```

The `/predict` response now includes:
- `scene.top5` from MobileNetV2 (fallback to Gemini scene caption if unavailable),
- `navigation_mobilenet_v2` with predicted navigation action.

---

## 📜 Credits
Developed as a PFE (Final Year Project) for obstacle detection and scene understanding using deep learning and multimodal AI.
