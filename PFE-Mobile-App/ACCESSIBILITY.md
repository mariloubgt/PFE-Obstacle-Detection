# VisionAid — Accessibility on the navigation screen

VisionAid avoids requiring users to hunt for a small on-screen Describe control.

## Primary shortcuts

1. **Physical volume buttons** — Settings → **Accessibility** → **Physical volume buttons**.
   On the live navigation camera screen, press volume up or down to either run a spoken **describe environment** flow, jump to **voice scene chat**, or do nothing (**Off**).

2. **Hands-free phrase (optional)** — Settings → Accessibility → **Hands-free phrase**.
   Enable this only if you accept brief camera preview pauses while the microphone is used.
   Say **describe** and **environment** in natural speech.

3. **Describe pill** remains available as an optional shortcut (e.g. for testing).

All describe actions use the same server pipeline (`onDescribeEnvironmentCommand`) including an immediate spoken “Describing.” cue before capture.
