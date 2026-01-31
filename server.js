// server.js - Node bridge: serial <-> websocket + optional webcam
// Uses lib/parser.js to normalize printer messages.

const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const socketio = require('socket.io');

const Parser = require('./lib/parser');

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

const upload = require('./lib/upload');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const { startUpload } = require('./lib/upload_serial');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// instantiate parser
const parser = new Parser();

// store latest normalized status
let latestStatus = parser._buildNormalizedStatus ? parser._buildNormalizedStatus() : { isValid: false };

// wire up parser events
parser.on('status', (st) => {
  latestStatus = st;
  io.emit('status', st);
});

parser.on('calibrate', (ev) => {
  io.emit('calibrate', ev);
});

parser.on('log', (l) => {
  io.emit('log', l);
});

parser.on('token', (tk) => {
  // store token in latestStatus
  latestStatus.token = tk;
  io.emit('token', tk);
});

// Serial port setup (optional dependency)
let port = null;
let Readline = null;
try {
  const SerialPort = require('serialport').SerialPort;
  Readline = require('@serialport/parser-readline').ReadlineParser;
  port = new SerialPort({ path: config.serialPath, baudRate: config.baudRate, autoOpen: false });
  const parserSerial = port.pipe(new Readline({ delimiter: '\n' }));

  port.on('open', () => console.log('Serial opened', config.serialPath));
  port.on('error', (e) => console.error('Serial error', e.message));
  port.on('close', () => console.warn('Serial closed'));

  parserSerial.on('data', (line) => {
    parser.feed(line);
  });

  port.open((err) => {
    if (err) console.error('Failed to open serial port', err.message);
  });

} catch (e) {
  console.warn('serialport not installed or failed - serial disabled. Install serialport and @serialport/parser-readline for serial support.');
}

// helper to send raw messages to printer
function sendRaw(msg) {
  if (port && port.isOpen) {
    const s = msg.endsWith('\r\n') || msg.endsWith('\n') ? msg : msg + '\r\n';
    port.write(s, (err) => { if (err) console.error('Write failed', err.message); });
    return true;
  } else {
    console.warn('Serial not open: cannot send', msg);
    return false;
  }
}

// polling loop
let lastPoll = 0;
setInterval(() => {
  if (!port || !port.isOpen) return;
  const now = Date.now();
  if (now - lastPoll < config.pollIntervalMs) return;
  lastPoll = now;
  sendRaw('XYZv3/query=a');
}, 100);

// Socket.io endpoints (UI -> server)
io.on('connection', (socket) => {
  console.log('Client connected');
  socket.emit('status', latestStatus);

  socket.on('command', (cmd) => {
    console.log('Received cmd', cmd);
    switch (cmd.action) {
      case 'calibrate_start':
        sendRaw('XYZv3/action=calibratejr:new');
        break;
      case 'calibrate_detector_lowered':
        sendRaw('XYZv3/action=calibratejr:detectorok');
        break;
      case 'calibrate_detector_raised':
        sendRaw('XYZv3/action=calibratejr:release');
        break;
      case 'toggle_autolevel':
        sendRaw(`XYZv3/config=autolevel:${cmd.enable ? 'on' : 'off'}`);
        break;
      case 'pause':
      case 'resume':
      case 'cancel': {
        const state = cmd.action === 'pause' ? 1 : (cmd.action === 'resume' ? 2 : 3);
        const tk = cmd.token || latestStatus.token || '';
        const j = JSON.stringify({ command: 6, state, token: tk });
        sendRaw(j);
        break;
      }
      case 'home':
        sendRaw('XYZv3/action=home');
        break;
      case 'jog':
        sendRaw(`XYZv3/action=jog:${cmd.axis}:${cmd.dist}`);
        break;
      case 'load_filament':
        sendRaw('XYZv3/action=loadfilament');
        break;
      case 'unload_filament':
        sendRaw('XYZv3/action=unloadfilament');
        break;
      case 'clean_nozzle':
        sendRaw('XYZv3/action=cleannozzle:new');
        break;
      case 'set_zoffset':
        sendRaw(`XYZv3/config=zoffset:[${cmd.offset}]`);
        break;
      default:
        if (cmd.raw) sendRaw(cmd.raw);
        else console.warn('Unknown command', cmd);
    }
  });
});

// Optional basic webcam streaming (low-fps jpeg base64 frames)
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
    console.warn('Webcam disabled (node-webcam not installed).');
  }
}

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'no file uploaded' });
  // The filename is already set by storage in lib/upload.js
  return res.json({ 
    ok: true, 
    filename: req.file.filename, 
    size: req.file.size 
  });
});

app.get('/uploads', (req, res) => {
  try {
    const files = fs.readdirSync(uploadsDir).filter(f => fs.statSync(path.join(uploadsDir, f)).isFile());
    res.json({ ok: true, files });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/print', (req, res) => {
  const filename = req.body && req.body.filename;
  if (!filename) return res.status(400).json({ ok: false, error: 'missing filename' });
  const filePath = path.join(uploadsDir, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'file not found' });
  if (!port || !port.isOpen) return res.status(500).json({ ok: false, error: 'serial not open' });

  const ee = startUpload(filePath, port, parser);

  ee.on('started', (info) => {
    io.emit('upload_started', { filename: info.fileName, total: info.total });
  });
  ee.on('progress', (p) => {
    io.emit('upload_progress', p);
  });
  ee.on('finished', (r) => {
    latestStatus.token = r.token;
    io.emit('upload_finished', r);
  });
  ee.on('error', (e) => {
    io.emit('upload_error', { error: String(e) });
  });

  return res.json({ ok: true, started: true });
});

const portHttp = config.port || 3000;
server.listen(portHttp, () => {
  console.log(`Server listening on http://0.0.0.0:${portHttp}`);
});
