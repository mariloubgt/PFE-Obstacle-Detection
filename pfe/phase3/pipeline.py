"""
Main pipeline: YOLO Detection → Depth Estimation → Darija TTS Feedback.

Usage:
    python -m pfe.phase3.pipeline                     # webcam
    python -m pfe.phase3.pipeline --source video.mp4  # video file
    python -m pfe.phase3.pipeline --source 0           # webcam
    python -m pfe.phase3.pipeline --source "http://192.168.1.5:8080/video"  # iPhone IP cam
"""
import argparse
import cv2
import time
import sys
from pathlib import Path
from ultralytics import YOLO

from . import config
from .depth_estimator import estimate_distance, get_danger_level, get_danger_color
from .gemini_tts import generate_alert, play_audio
from .scene_analyzer import SceneAnalyzer
from .tracking_manager import TrackingManager


def draw_detection(frame, box, class_name, conf, distance_m, danger, track_id=None):
    """Draw bounding box with distance, danger and track ID info on the frame."""
    x1, y1, x2, y2 = map(int, box)
    color = get_danger_color(danger)

    # Bounding box
    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

    # Label
    track_str = f"ID:{track_id} " if track_id is not None and track_id != -1 else ""
    if distance_m is not None:
        label = f"{track_str}{class_name} {conf:.0%} | {distance_m}m [{danger}]"
    else:
        label = f"{track_str}{class_name} {conf:.0%}"

    # Background for text
    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 1)
    cv2.rectangle(frame, (x1, y1 - th - 10), (x1 + tw + 4, y1), color, -1)
    cv2.putText(frame, label, (x1 + 2, y1 - 5),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)

    return frame


def run_pipeline(source=None, weights=None, show=True, save_output=False):
    """
    Run the full detection + depth + TTS pipeline.

    Args:
        source: Camera index, video path, or IP stream URL. Default: config.CAMERA_SOURCE
        weights: Path to YOLO weights. Default: config.YOLO_WEIGHTS
        show: Whether to display the video window
        save_output: Whether to save the output video
    """
    source = source if source is not None else config.CAMERA_SOURCE
    weights = weights or config.YOLO_WEIGHTS

    # ── Load YOLO ───────────────────────────────────────────
    print(f"Loading YOLO model: {weights}")
    if not Path(weights).exists():
        print(f"ERROR: Weights not found at {weights}")
        print("Update YOLO_WEIGHTS in pfe/phase3/config.py")
        sys.exit(1)

    model = YOLO(weights)
    class_names = model.names  # {0: 'bench', 1: 'bicycle', ...}
    tracker = TrackingManager(cooldown=config.TRACK_COOLDOWN)
    scene_analyzer = SceneAnalyzer(interval=5.0)  # Réduit à 5s pour le test
    print(f"Classes: {list(class_names.values())}")

    # ── Open camera / video ─────────────────────────────────
    # Try to parse source as int (webcam index)
    try:
        source = int(source)
    except (ValueError, TypeError):
        pass

    print(f"Opening source: {source}")
    cap = cv2.VideoCapture(source)

    if not cap.isOpened():
        print(f"ERROR: Cannot open source: {source}")
        sys.exit(1)

    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"Resolution: {w}x{h} @ {fps:.0f} FPS")

    # Video writer for saving output
    writer = None
    if save_output:
        out_path = "output_detection.mp4"
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(out_path, fourcc, fps, (w, h))
        print(f"Saving output to: {out_path}")

    # ── Main loop ───────────────────────────────────────────
    frame_count = 0
    fps_display = 0
    t_fps = time.time()

    print("\n" + "=" * 50)
    print("  Pipeline running! Press 'q' to quit.")
    print("=" * 50 + "\n")

    while True:
        ret, frame = cap.read()
        if not ret:
            # If video file, loop or stop
            if isinstance(source, str) and Path(source).is_file():
                print("Video ended.")
                break
            continue

        t0 = time.perf_counter()

        # ── 1. YOLO tracking ───────────────────────────────
        results = model.track(frame, conf=config.YOLO_CONF, iou=config.YOLO_IOU,
                              imgsz=config.IMG_SIZE, verbose=False, persist=True,
                              tracker=config.TRACKER_TYPE)

        # ── 2. Process detections ───────────────────────────
        closest_detection = None  # Track the closest danger for TTS
        current_frame_ids = []

        if results and results[0].boxes is not None:
            boxes = results[0].boxes
            for box in boxes:
                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                conf = float(box.conf[0])
                cls_id = int(box.cls[0])
                class_name = class_names.get(cls_id, f"cls_{cls_id}")

                # ── 3. Depth estimation ─────────────────────
                bbox_h = y2 - y1
                distance_m = estimate_distance(class_name, int(bbox_h), h)
                danger = get_danger_level(distance_m) if distance_m else "INFO"
                
                # Get track ID if available
                track_id = int(box.id[0]) if box.id is not None else -1
                if track_id != -1:
                    current_frame_ids.append(track_id)

                # Draw on frame
                draw_detection(frame, (x1, y1, x2, y2), class_name, conf, distance_m, danger, track_id)

                # Track closest dangerous object
                if distance_m and danger in ("DANGER", "WARNING"):
                    if closest_detection is None or distance_m < closest_detection[1]:
                        closest_detection = (class_name, distance_m, danger, track_id)

        # ── 3b. Cleanup tracker memory ──────────────────────
        tracker.update_active(current_frame_ids)

        # ── 4. TTS alert for closest danger ─────────────────
        if closest_detection:
            cls, dist, dng, track_id = closest_detection
            if tracker.should_alert(track_id):
                wav = generate_alert(cls, dist, dng)
                if wav:
                    play_audio(wav)

        # ── 5. Scene Recognition (Periodical) ───────────────
        scene_analyzer.analyze_scene_async(frame)

        # ── 6. Display stats ────────────────────────────────
        dt = time.perf_counter() - t0
        frame_count += 1

        # FPS counter (update every second)
        if time.time() - t_fps >= 1.0:
            fps_display = frame_count / (time.time() - t_fps)
            frame_count = 0
            t_fps = time.time()

        # Stats overlay
        stats = f"FPS: {fps_display:.0f} | Inference: {dt*1000:.0f}ms"
        cv2.putText(frame, stats, (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2, cv2.LINE_AA)

        if closest_detection:
            cls, dist, dng, track_id = closest_detection
            alert_text = f"CLOSEST: {cls} @ {dist}m [{dng}] (ID:{track_id})"
            alert_color = get_danger_color(dng)
            cv2.putText(frame, alert_text, (10, 65),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, alert_color, 2, cv2.LINE_AA)

        # ── 6. Show / save ──────────────────────────────────
        if show:
            cv2.imshow("Obstacle Detection + Depth + TTS", frame)
            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break

        if writer:
            writer.write(frame)

    # ── Cleanup ─────────────────────────────────────────────
    cap.release()
    if writer:
        writer.release()
    if show:
        cv2.destroyAllWindows()
    print("\nPipeline stopped.")


def main():
    parser = argparse.ArgumentParser(description="Obstacle Detection + Depth + TTS Pipeline")
    parser.add_argument("--source", default=None,
                        help="Camera index (0), video file, or IP stream URL")
    parser.add_argument("--weights", default=None,
                        help="Path to YOLO best.pt weights")
    parser.add_argument("--no-show", action="store_true",
                        help="Don't display video window")
    parser.add_argument("--save", action="store_true",
                        help="Save output video")
    parser.add_argument("--api-key", default=None,
                        help="Gemini API key")
    args = parser.parse_args()

    if args.api_key:
        config.GEMINI_API_KEY = args.api_key

    run_pipeline(
        source=args.source,
        weights=args.weights,
        show=not args.no_show,
        save_output=args.save,
    )


if __name__ == "__main__":
    main()
