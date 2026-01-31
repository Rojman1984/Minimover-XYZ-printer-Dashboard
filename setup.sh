#!/bin/bash
# setup.sh - installer for Raspberry Pi
set -e

echo "Installing system packages..."
sudo apt-get update
sudo apt-get install -y curl build-essential ffmpeg v4l-utils

if ! command -v node >/dev/null 2>&1; then
  echo "Installing Node.js 18.x..."
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "Installing npm dependencies..."
npm install

echo "Adding $USER to dialout and video groups..."
sudo usermod -a -G dialout,video $USER

echo "Creating systemd service (requires sudo)"
sudo cp minimover-dashboard.service /etc/systemd/system/minimover-dashboard.service
sudo systemctl daemon-reload
sudo systemctl enable minimover-dashboard.service

echo "Setup complete. Reboot recommended to apply group changes."