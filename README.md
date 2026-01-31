# Minimover-XYZ-printer-Dashboard

Web dashboard for XYZ / miniMover printers. Runs on Raspberry Pi (3B+ or better recommended).  
Features:
- Serial connection to printer (USB)
- Active polling for near-realtime status (mirrors miniMover request/response)
- Web UI with control buttons: calibrate, autolevel toggle, pause/resume/cancel, home, jog, load/unload, clean nozzle, z-offset
- Optional USB webcam print monitor (low-framerate base64 images) — can be extended to MJPEG with mjpg-streamer / ffmpeg
- Systemd service example and installer script

Quick start (on Raspberry Pi):
1. Install Node (18+) on Pi (or use NodeSource packages).
2. Add your user to dialout and video groups:
   sudo usermod -a -G dialout,video $USER
   logout/login
3. Copy files or clone repo into ~/minimover-dashboard
4. Install deps:
   npm install
   // optional (webcam & serial):
   npm install serialport @serialport/parser-readline node-webcam
5. Edit config.json to set the correct serial device (/dev/ttyUSB0 or /dev/serial/by-id/...).
6. Start:
   npm start
7. Open browser: http://<pi-ip>:3000

Systemd service and setup script included (setup.sh and minimover-dashboard.service).
See docs/ for further notes.

Roadmap:
- Improve server parser to map exact XYZPrinterStatus fields (Task A)
- Add high-performance MJPEG camera streaming via ffmpeg (Task B)
- File upload & print start implementation (Task C)