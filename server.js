// server.js - Node bridge: serial <-> websocket + optional webcam
// Uses lib/parser.js to normalize printer messages.

const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const os = require('os');

const Parser = require('./lib/parser');

const CONFIG_FILE = path.join(__dirname, 'config.json');
const config = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE)) : {
  serialPath: '/dev/ttyUSB0',
  baudRate: 115200,
  pollIntervalMs: 500,
  enableWebcam: true,
  webcamIntervalMs: 500,
  webcamDevice: '/dev/video0',
  // Optional basic auth
  port: 3000
};

const app = express();
const socketio = require('socket.io');

const server = http.createServer(app);
const io = socketio(server);

const upload = require('./lib/upload');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const { startUpload } = require('./lib/upload_serial');
const SerialBridge = require('./lib/serial_bridge');
const UploadV3 = require('./lib/upload_v3');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// instantiate parser
const parser = new Parser();

// Initialize port variable (will be set if serialport loads successfully)
let port = null;

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
try {
  const { SerialPort } = require('serialport');
  const { ReadlineParser } = require('@serialport/parser-readline');
  
  // Auto-detect serial port if config path doesn't exist
  async function detectSerialPort() {
    const ports = await SerialPort.list();
    console.log('Available serial ports:', ports.map(p => p.path).join(', '));
    
    // Try config path first
    if (ports.find(p => p.path === config.serialPath)) {
      return config.serialPath;
    }
    
    // Look for common USB serial devices
    const usbPort = ports.find(p => 
      p.path.startsWith('/dev/ttyUSB') || 
      p.path.startsWith('/dev/ttyACM')
    );
    
    if (usbPort) {
      console.log(`Auto-detected serial port: ${usbPort.path}`);
      return usbPort.path;
    }
    
    return config.serialPath; // fallback
  }
  
  detectSerialPort().then(serialPath => {
    port = new SerialPort({ path: serialPath, baudRate: config.baudRate, autoOpen: false });
    const parserSerial = port.pipe(new ReadlineParser({ delimiter: '\n' }));

    port.on('open', () => console.log('Serial opened', serialPath));
    port.on('error', (e) => console.error('Serial error', e.message));
    port.on('close', () => console.warn('Serial closed'));

    parserSerial.on('data', (line) => {
      parser.feed(line);
    });

    port.open((err) => {
      if (err) console.error('Failed to open serial port', err.message);
    });
  });

} catch (e) {
  console.warn('serialport not installed or failed - serial disabled.');
  console.warn('Error details:', e.message);
  console.warn('Install serialport and @serialport/parser-readline for serial support.');
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
        const dir = cmd.dist < 0 ? '-' : '+';
        const len = Math.abs(cmd.dist);
        sendRaw(`XYZv3/action=jog:{"axis":"${cmd.axis}","dir":"${dir}","len":"${len}"}`);
        break;
      case 'load_filament':
        sendRaw('XYZv3/action=load:new');
        break;
      case 'load_filament_stop':
        sendRaw('XYZv3/action=load:cancel');
        break;
      case 'unload_filament':
        sendRaw('XYZv3/action=unload:new');
        break;
      case 'unload_filament_stop':
        sendRaw('XYZv3/action=unload:cancel');
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
  const serialBridge = new SerialBridge(config);
  const uploadV3 = new UploadV3(serialBridge);
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

// Get local IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const localIP = getLocalIP();

server.listen(portHttp, () => {
  console.log(`Server listening on http://${localIP}:${portHttp}`);
  console.log(`  Also accessible at http://0.0.0.0:${portHttp}`);
});
