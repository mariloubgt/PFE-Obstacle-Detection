"""
Quick test — runs the pipeline on a single image to verify everything works.

Usage:
    python -m pfe.phase3.test_single path/to/image.jpg
"""
import sys
import cv2
from pathlib import Path
from ultralytics import YOLO

from . import config
from .depth_estimator import estimate_distance, get_danger_level, get_danger_color
from .gemini_tts import generate_alert, _get_darija_phrase


def test_single_image(image_path: str, weights: str = None):
    """Test detection + depth on a single image."""
    weights = weights or config.YOLO_WEIGHTS

    print(f"Loading model: {weights}")
    if not Path(weights).exists():
        print(f"ERROR: {weights} not found!")
        print("Update YOLO_WEIGHTS in pfe/phase3/config.py")
        return

    model = YOLO(weights)
    class_names = model.names

    img = cv2.imread(image_path)
    if img is None:
        print(f"ERROR: Cannot read image: {image_path}")
        return

    print(f"Image: {image_path} ({img.shape[1]}x{img.shape[0]})")
    print("-" * 60)

    results = model(img, conf=config.YOLO_CONF, imgsz=config.IMG_SIZE, verbose=False)

    if not results or results[0].boxes is None or len(results[0].boxes) == 0:
        print("No detections found.")
        return

    boxes = results[0].boxes
    print(f"Found {len(boxes)} detections:\n")

    for i, box in enumerate(boxes):
        x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
        conf = float(box.conf[0])
        cls_id = int(box.cls[0])
        class_name = class_names.get(cls_id, f"cls_{cls_id}")
        bbox_h = y2 - y1
        ih, iw = img.shape[:2]

        distance_m = estimate_distance(
            class_name,
            float(x1),
            float(y1),
            float(x2),
            float(y2),
            iw,
            ih,
            horizontal_fov_deg=getattr(config, "CAMERA_HORIZONTAL_FOV_DEG", 56.0),
        )
        danger = get_danger_level(distance_m) if distance_m else "INFO"

        print(f"  [{i+1}] {class_name} ({conf:.0%})")
        print(f"      bbox: ({int(x1)},{int(y1)}) -> ({int(x2)},{int(y2)})  h={int(bbox_h)}px")
        if distance_m:
            print(f"      distance: {distance_m}m  danger: {danger}")
            phrase = _get_darija_phrase(class_name, distance_m, danger)
            print(f"      darija: {phrase}")
        print()

        # Draw on image
        color = get_danger_color(danger)
        cv2.rectangle(img, (int(x1), int(y1)), (int(x2), int(y2)), color, 2)
        label = f"{class_name} {distance_m}m" if distance_m else class_name
        cv2.putText(img, label, (int(x1), int(y1) - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

    # Save annotated image
    out_path = "test_detection_output.jpg"
    cv2.imwrite(out_path, img)
    print(f"Saved annotated image to: {out_path}")

    # Show
    cv2.imshow("Test Detection", img)
    print("Press any key to close...")
    cv2.waitKey(0)
    cv2.destroyAllWindows()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m pfe.phase3.test_single path/to/image.jpg")
        sys.exit(1)
    test_single_image(sys.argv[1])
