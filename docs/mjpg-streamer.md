mjpg-streamer — install & configuration for Raspberry Pi
========================================================

Why use mjpg-streamer
- Lightweight, C implementation. Very efficient at forwarding MJPEG frames.
- Best choice for sustained 25–30 FPS on Raspberry Pi 3B/3B+ when your camera supports MJPEG.
- Serves an MJPEG stream that can be embedded with a simple <img src="..."> tag.

Prereqs
- Raspberry Pi 3B/3B+ (recommended)
- Camera that supports MJPEG (your camera does — good)
- Dependencies on the Pi:
  sudo apt-get update
  sudo apt-get install -y build-essential libjpeg-dev libv4l-dev cmake git

Build & install (scripted)
- Use the provided script in scripts/install_mjpg_streamer.sh (recommended).

Service
- A systemd unit is provided: systemd/mjpg-streamer.service
- Environment file: /etc/default/mjpg-streamer
  - Use it to tune device (/dev/video0), resolution, framerate, jpeg quality, http port.
- The unit file uses /usr/local/bin/mjpg_streamer and the plugins directory /usr/local/lib/mjpg-streamer

Recommended settings (good balance)
- Device: /dev/video0
- Resolution: 640x480
- Framerate: 25–30
- JPEG quality: 80–90

Example input parameters:
  -i "input_uvc.so -d /dev/video0 -r 640x480 -f 30 -q 85"
Example output parameters:
  -o "output_http.so -w ./www -p 8080"

Security / access
- mjpg-streamer by default exposes an unprotected HTTP endpoint (for a LAN). If you need access over the Internet,
  add an HTTP auth proxy (nginx) or restrict access via firewall. For LAN use this is usually fine.

Troubleshooting
- Use v4l2-ctl to verify camera supported formats:
  v4l2-ctl --list-formats-ext -d /dev/video0
- If the camera does not support MJPEG, ffmpeg will need to re-encode; CPU use will increase dramatically.
- If you see no frames: check mjpg-streamer logs, device permissions (user in video group), and that another process (e.g. snapshot service) isn't holding the camera.

Advanced
- If you prefer the Node server to proxy the stream, see the ffmpeg-in-node branch/notes (not recommended for 25–30 fps on Pi 3B).