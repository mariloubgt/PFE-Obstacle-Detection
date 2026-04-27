import cv2
import time
import win32com.client
from ultralytics import YOLO
from pfe.phase3.depth_estimator import estimate_distance
from pfe.phase3.voice_manager import VoiceManager

# --- INITIALISATION ---
speaker = win32com.client.Dispatch("SAPI.SpVoice")
SVSFlagsAsync = 1
model = YOLO('yolov8n.pt')
voice = VoiceManager()

cap = cv2.VideoCapture(0)

print("-" * 40)
print("🚀 VISIONAID - PUR RADAR (FIXED ROUNDING)")
print("-" * 40)

while cap.isOpened():
    success, frame = cap.read()
    if not success: break
    h, w, _ = frame.shape
    
    results = model.predict(frame, conf=0.45, imgsz=320, verbose=False)[0]
    
    detections = []
    for box in results.boxes:
        x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
        name = results.names[int(box.cls[0])]
        
        dist = estimate_distance(name, x1, y1, x2, y2, w, h)
        
        if dist:
            # ON FORCE LE TYPE FLOAT ET L'ARRONDI ICI AUSSI
            d_val = float(dist)
            detections.append({"name": name, "distance_m": d_val})
            
            # FORMATAGE STRICT :.2f (interdit les chiffres longs)
            color = (0, 0, 255) if d_val < 1.8 else (0, 255, 0)
            cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), color, 2)
            cv2.putText(frame, f"{name}: {d_val:.2f}m", (int(x1), int(y1)-10), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

    announcement = voice.get_priority_announcement(detections)
    if announcement:
        speaker.Speak(announcement, SVSFlagsAsync)

    cv2.imshow("VisionAid Stable Radar", frame)
    if cv2.waitKey(1) & 0xFF == ord('q'): break

cap.release()
cv2.destroyAllWindows()
