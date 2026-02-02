# Minimover-XYZ-printer-Dashboard

Web dashboard for XYZ / miniMover printers. Runs on Raspberry Pi (3B+ or better recommended).  
Features:

- Serial connection to printer (USB)
- Active polling for near-realtime status (mirrors miniMover request/response)
- Web UI with control buttons: calibrate, autolevel toggle, pause/resume/cancel, home, jog, load/unload, clean nozzle, z-offset
- **File upload with automatic format conversion**:
  - **.3w files** (XYZ proprietary) → AES-decrypted to .gcode → **Ready to print**
  - **.gcode files** → **Ready to print**
  - **.3mf files** → Extracted to .stl → **Requires external slicing** (not printable directly)
- Optional USB webcam print monitor via mjpg-streamer
- Systemd service example and installer script
- Serial auto-reconnect
- Max 10 stored uploads with delete functionality

## Prerequisites — build & test the miniMover console (printer interface)

Before using the dashboard it is strongly recommended to build and test the original miniMover console utility (the code that implements the protocol and example commands). This ensures your Pi has the correct device drivers and you can communicate with the printer over USB.

The instructions below are for Debian / Raspberry Pi OS (Pi 3B+ or better recommended). Adjust package names for other distros.

## 1) Install OS packages

Update and install basic build tools, v4l2 utilities and related packages:

```bash
sudo apt-get update
sudo apt-get install -y build-essential git pkg-config libv4l-dev v4l-utils ffmpeg curl
```

## Minimover-XYZ-printer-Dashboard Quick start (on Raspberry Pi)

1. Install Node (18+) on Pi (or use NodeSource packages).
2. Add your user to dialout and video groups:

```bash
   sudo usermod -a -G dialout,video $USER
   logout/login
```

3. Copy files or clone repo into ~/minimover-dashboard
4. Install deps:

```bash
   npm install // optional (webcam & serial)
   npm install serialport @serialport/parser-readline node-webcam
```

5. Edit config.json to set the correct serial device (/dev/ttyUSB0 or /dev/serial/by-id/...).
6. Start:
   npm start
7. Open browser: http://<pi-ip>:3000

## Running Tests

To validate the parser and status mappings:
```bash
node test/parser.test.js
```

Systemd service and setup script included (setup.sh and minimover-dashboard.service).
See docs/ for further notes.

### Camera streaming (mjpg-streamer)

For high-frame-rate monitoring (25–30 FPS) we recommend using mjpg-streamer on the Pi.

Quick steps:

1. Build and install mjpg-streamer (script provided):

```bash
   sudo bash scripts/install_mjpg_streamer.sh
```

2. Copy the example env and enable the service:

```bash
   sudo cp config/mjpg-streamer.env.example /etc/default/mjpg-streamer
```

# Edit /etc/default/mjpg-streamer if you want to change device/res/fps

```bash
   sudo cp systemd/mjpg-streamer.service /etc/systemd/system/mjpg-streamer.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now mjpg-streamer.service
```

3. Verify stream in a browser:
   http://<pi-ip>:8080/?action=stream

4. The dashboard will attempt to show the stream at http://localhost:8080/?action=stream.
   If accessing the dashboard from another machine, replace "localhost" with the Pi's IP
   in the embedded image src or visit the stream URL directly.

## File Upload & .3mf Support

The dashboard supports uploading both .gcode and .3mf files:

- **GCode files** (.gcode) are stored directly in the uploads folder
- **.3mf files** are automatically converted to gcode during upload
  - XYZ .3mf files contain pre-sliced gcode in the archive
  - The converter extracts and converts the gcode automatically
  - Requires `unzip` to be installed (usually pre-installed on Raspberry Pi OS)

Upload files via the "Uploads & Print" section in the dashboard.

Roadmap:

- Improve server parser to map exact XYZPrinterStatus fields (Task A) **COMPLETE**
- Add high-performance MJPEG camera streaming via ffmpeg (Task B) **COMPLETE**
- File upload & print start implementation (Task C) **COMPLETE**
- .3mf to gcode conversion (Task D) **COMPLETE**
