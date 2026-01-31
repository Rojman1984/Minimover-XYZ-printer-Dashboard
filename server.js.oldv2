// server.js - Node bridge: serial <-> websocket + optional webcam
// Minimal, production-ready code should add more error handling and logging.

const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const socketio = require('socket.io');

const CONFIG_FILE = path.join(__dirname, 'config.json');
const config = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE)) : {
  serialPath: '/dev/ttyUSB0',
  baudRate: 115200,
  pollIntervalMs: 500,
  enableWebcam: true,
  webcamIntervalMs: 500,
  webcamDevice: '/dev/video0',
  port: 3000
};

const app = express();
const server = http.createServer(app);
const io = socketio(server);

// serve static UI
app.use(express.static(path.join(__dirname, 'public')));

// serialport lazily loaded (optional dependency if you don't need serial)
let port = null;
let parser = null;
let SerialPort = null;
try {
  SerialPort = require('serialport').SerialPort;
  const Readline = require('@serialport/parser-readline').ReadlineParser;
  port = new SerialPort({ path: config.serialPath, baudRate: config.baudRate, autoOpen: false });
  parser = port.pipe(new Readline({ delimiter: '\n' }));

  port.open(err => {
    if (err) {
      console.error('Serial open error:', err.message);
    } else {
      console.log('Serial opened at', config.serialPath);
    }
  });

  parser.on('data', line => handleLine(line));
  port.on('error', err => console.error('Serial error', err));
  port.on('close', () => {
    console.warn('Serial port closed');
  });
} catch (e) {
  console.warn('serialport not installed or failed to load; serial features disabled.');
}

// state
let latestStatus = { isValid: false, raw: [], parsed: {} };
let lastPoll = 0;

function sendRaw(msg) {
  if (!port || !port.isOpen) {
    console.warn('Serial not open, cannot send:', msg);
    return false;
  }
  const s = msg.endsWith('\r\n') || msg.endsWith('\n') ? msg : msg + '\r\n';
  port.write(s, (err) => {
    if (err) console.error('Serial write err', err.message);
  });
  return true;
}

function handleLine(raw) {
  const line = raw.toString().trim();
  if (!line) return;
  latestStatus.raw.push(line);
  // Simple classification
  if (line.startsWith('calibratejr:')) {
    const payload = line.substring('calibratejr:'.length).trim();
    latestStatus.parsed.calibrate = payload;
    io.emit('calibrateEvent', { line, payload });
  } else if (line.startsWith('j:') || line.startsWith('s:') || line.startsWith('o:') || line.startsWith('z:')) {
    latestStatus.parsed.sysline = line;
    io.emit('log', { type: 'sysline', line });
  } else {
    // try JSON
    const firstBrace = line.indexOf('{'), lastBrace = line.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const sub = line.substring(firstBrace, lastBrace + 1);
      try {
        const json = JSON.parse(sub);
        latestStatus.parsed.json = json;
        io.emit('status', { parsed: latestStatus.parsed, rawLine: line });
        return;
      } catch (e) {
        // non-JSON or partial; fall through
      }
    }
    io.emit('log', { type: 'line', line });
  }
}

// poll loop for status
setInterval(() => {
  if (!port || !port.isOpen) return;
  const now = Date.now();
  if (now - lastPoll < config.pollIntervalMs) return;
  lastPoll = now;
  sendRaw('XYZv3/query=a');
}, 100);

// socket.io
io.on('connection', socket => {
  console.log('UI connected');
  socket.emit('status', { parsed: latestStatus.parsed, raw: latestStatus.raw });

  socket.on('command', cmd => {
    console.log('cmd', cmd);
    switch (cmd.action) {
      case 'calibrate_start': sendRaw('XYZv3/action=calibratejr:new'); break;
      case 'calibrate_detector_lowered': sendRaw('XYZv3/action=calibratejr:detectorok'); break;
      case 'calibrate_detector_raised': sendRaw('XYZv3/action=calibratejr:release'); break;
      case 'toggle_autolevel': sendRaw(`XYZv3/config=autolevel:${cmd.enable ? 'on' : 'off'}`); break;
      case 'pause':
      case 'resume':
      case 'cancel': {
        const state = cmd.action === 'pause' ? 1 : (cmd.action === 'resume' ? 2 : 3);
        const tk = cmd.token || '';
        const j = JSON.stringify({ command: 6, state, token: tk });
        sendRaw(j);
        break;
      }
      case 'home': sendRaw('XYZv3/action=home'); break;
      case 'jog': sendRaw(`XYZv3/action=jog:${cmd.axis}:${cmd.dist}`); break;
      case 'load_filament': sendRaw('XYZv3/action=loadfilament'); break;
      case 'unload_filament': sendRaw('XYZv3/action=unloadfilament'); break;
      case 'clean_nozzle': sendRaw('XYZv3/action=clean_nozzle'); break;
      case 'set_zoffset': sendRaw(`XYZv3/config=zoffset:[${cmd.offset}]`); break;
      default:
        if (cmd.raw) sendRaw(cmd.raw);
        else console.warn('Unknown command', cmd);
    }
  });
});

// optional webcam: node-webcam, low-fps base64 frames
if (config.enableWebcam) {
  try {
    const NodeWebcam = require('node-webcam');
    const webcamOpts = { width: 640, height: 480, device: config.webcamDevice, output: 'jpeg', callbackReturn: 'buffer', verbose: false };
    const Webcam = NodeWebcam.create(webcamOpts);
    setInterval(() => {
      Webcam.capture('tmp', (err, buffer) => {
        if (err) return;
        const b64 = buffer.toString('base64');
        io.emit('frame', { b64 });
      });
    }, config.webcamIntervalMs);
    console.log('Webcam streamer enabled.');
  } catch (e) {
    console.warn('Webcam streamer disabled (node-webcam not installed).');
  }
}

// start http server
const portHttp = config.port || 3000;
server.listen(portHttp, () => {
  console.log(`Server listening on http://0.0.0.0:${portHttp}`);
});