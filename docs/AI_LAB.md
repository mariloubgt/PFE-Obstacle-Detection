# VisionAid AI Lab — free testing workflow

Test obstacle detection, Groq scene describe, and Gemini **anytime** without rebuilding the mobile app.

## 1. Start the AI server (Mac / PC)

```bash
cd PFE-Obstacle-Detection
bash scripts/ai-lab-start.sh
```

Keep this terminal open. The script prints:

- **Simulator:** `http://127.0.0.1:8787`
- **Physical phone (same Wi‑Fi):** `http://YOUR_LAN_IP:8787`

Put API keys in `.env` at the project root:

```env
GROQ_API_KEY=gsk_...
ENABLE_GROQ=1
GEMINI_API_KEY=...        # optional
ENABLE_GEMINI=1           # optional
YOLO_WEIGHTS=yolov8n.pt   # or path to your best.pt
GROQ_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
```

## 2. Run the mobile app

```bash
cd PFE-Mobile-App
npx expo start --dev-client
```

Open on simulator or phone (dev client build).

## 3. AI Lab in the app

**Settings → AI Lab — test models & server URL**

| Action | What it does |
|--------|----------------|
| **Test & load config** | Checks `/health`, shows LAN URL, loads server models |
| **Use server LAN URL** | One tap to set phone URL when on Wi‑Fi |
| **Presets** | Save URLs (home PC, lab, simulator) |
| **Use Groq / Gemini** | Sent on every `/predict` from the app |
| **Groq mode** | `describe` vs `navigate` |
| **Groq model field + Apply on server** | Changes model **without restart** |
| **Scene description / Live navigation** | Jump to test screens |

## 4. Change models

### From the app (no server restart)

- Groq on/off, Gemini on/off, describe vs navigate
- Groq model name → **Apply on server**

### From `.env` (restart server)

| Variable | Effect |
|----------|--------|
| `YOLO_WEIGHTS` | YOLO checkpoint path |
| `GROQ_MODEL` | Groq Llama model id |
| `GEMINI_MODEL` | Gemini model |
| `YOLO_CONF` / `YOLO_IMGSZ` | Detection tuning |

After changing weights path, restart `ai-lab-start.sh`, or call `POST /lab/reload-yolo` with `{"yolo_weights": "path/to/best.pt"}`.

### API (curl)

```bash
# View config + LAN URL
curl http://127.0.0.1:8787/lab/config

# Switch Groq model live
curl -X PUT http://127.0.0.1:8787/lab/config \
  -H "Content-Type: application/json" \
  -d '{"groq_model":"meta-llama/llama-4-scout-17b-16e-instruct","enable_groq":true}'

# Reset overrides
curl -X POST http://127.0.0.1:8787/lab/reset
```

## 5. Compare model performance

1. Set URL in AI Lab → **Test**
2. Toggle **Groq describe** → Scene description → note latency & text
3. Switch **Groq mode** to `navigate` → Main → **AI test** → listen to guidance
4. Enable **Gemini** (if key on PC) → compare describe output
5. Change **Groq model** on server → **Apply** → repeat without restarting app

## 6. Deploy for always-on testing (optional)

- **Same Wi‑Fi:** LAN IP + `ai-lab-start.sh` is enough for daily testing.
- **Outside home Wi‑Fi:** use a tunnel (ngrok, Tailscale) to expose port 8787 and save that URL as a preset.
- **Internal TestFlight:** EAS `preview` build + AI Lab presets pointing to your server URL.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Cannot reach server | Same Wi‑Fi; phone URL = LAN not `localhost` |
| Simulator black camera | Features → Camera → pick a source |
| Missing GROQ_API_KEY | Add to `.env`, restart server |
| Old model still used | AI Lab → Apply on server, or POST `/lab/reset` |
