#!/usr/bin/env bash
# install_mjpg_streamer.sh
# Build and install mjpg-streamer from source (jacksonliam's fork)
# Run on Raspberry Pi (requires internet).
set -e
REPO="https://github.com/jacksonliam/mjpg-streamer.git"
WORKDIR="/tmp/mjpg-streamer-build"
PREFIX="/usr/local"

echo "Installing prerequisites..."
sudo apt-get update
sudo apt-get install -y build-essential libjpeg-dev libv4l-dev cmake git

echo "Cleaning previous build dir..."
sudo rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

echo "Cloning mjpg-streamer..."
git clone --depth 1 "$REPO" mjpg-streamer
cd mjpg-streamer/mjpg-streamer-experimental

echo "Compiling..."
make

echo "Installing..."
sudo mkdir -p "${PREFIX}/lib/mjpg-streamer"
sudo mkdir -p "${PREFIX}/share/mjpg-streamer/www"
# copy binary and plugins
sudo cp mjpg_streamer "${PREFIX}/bin/" || sudo cp mjpg_streamer "${PREFIX}/bin/mjpg_streamer"
sudo cp -r ./plugins/* "${PREFIX}/lib/mjpg-streamer/" || true
# copy www static pages
sudo cp -r www/* "${PREFIX}/share/mjpg-streamer/www/"

echo "Installed mjpg-streamer to ${PREFIX}"

echo "Cleaning build dir..."
cd /
sudo rm -rf "$WORKDIR"

echo "Done. Example usage:"
echo "${PREFIX}/bin/mjpg_streamer -i \"input_uvc.so -d /dev/video0 -r 640x480 -f 30 -q 85\" -o \"output_http.so -w ${PREFIX}/share/mjpg-streamer/www -p 8080\""