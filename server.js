// server.js - Node bridge: serial <-> websocket + optional webcam
// Uses lib/parser.js to normalize printer messages.

const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const os = require('os');

const Parser = require('./lib/parser');
const { convert3mfToGcode } = require('./lib/convert_3mf');
const { convert3wToGcode } = require('./lib/convert_3w');

const CONFIG_FILE = path.join(__dirname, 'config.json');
const config = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE)) : {
  serialPath: '/dev/ttyUSB0',
  baudRate: 115200,
  pollIntervalMs: 2000,
  enableWebcam: true,
  webcamIntervalMs: 500,
  webcamDevice: '/dev/video0',
  cameraFps: 15, // Camera framerate (max 30fps, lower for slower Pi models)
  // Optional basic auth
  port: 3000
};

const app = express();
const socketio = require('socket.io');

const server = http.createServer(app);
const io = socketio(server);

const { upload, uploadsDir } = require('./lib/upload');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const { startUpload } = require('./lib/upload_serial');
const SerialBridge = require('./lib/serial_bridge');
const UploadV3 = require('./lib/upload_v3');
const XYZv3Uploader = require('./lib/upload_xyz_v3');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Endpoint to get camera configuration
app.get('/api/camera-url', (req, res) => {
  // Try to get the server's actual IP address
  const interfaces = os.networkInterfaces();
  let serverIp = null;
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        serverIp = iface.address;
        break;
      }
    }
    if (serverIp) break;
  }
  
  const baseIp = serverIp || req.hostname;
  const fps = Math.min(Math.max(config.cameraFps || 15, 1), 30); // Clamp between 1-30fps
  
  // Only include printer camera - laser camera reserved for LightBurn
  res.json({ 
    cameras: [
      { id: 'cam0', device: '/dev/videousb0', url: `http://${baseIp}:8080` }
    ],
    fps 
  });
});

// Reconnect camera endpoint
app.post('/api/reconnect-camera', (req, res) => {
  const { spawn } = require('child_process');
  const restart = spawn('sudo', ['systemctl', 'restart', 'mjpg-streamer']);
  
  restart.on('close', (code) => {
    if (code === 0) {
      res.json({ success: true, message: 'Camera service restarted' });
    } else {
      res.status(500).json({ success: false, message: 'Failed to restart camera service' });
    }
  });
});

// instantiate parser
const parser = new Parser();

// Initialize port variable (will be set if serialport loads successfully)
let port = null;
let xyzUploader = null; // Will be initialized after port is ready

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

    port.on('open', () => {
      console.log('Serial opened', serialPath);
      // Initialize uploader after port is open
      xyzUploader = new XYZv3Uploader(port, io, {
        pausePoll: () => { pollPaused = true; },
        resumePoll: () => { pollPaused = false; }
      }, parser);
    });
    port.on('error', (e) => console.error('Serial error', e.message));
    port.on('close', () => console.warn('Serial closed'));
    
    // Debug: listen to raw port data (disabled - too verbose)
    // let dataCount = 0;
    // port.on('data', (data) => {
    //   dataCount++;
    //   if (dataCount % 10 === 0) {
    //     console.log('[RAW PORT DATA] Received', dataCount, 'chunks, last:', data.toString().substring(0, 50));
    //   }
    // });

    parserSerial.on('data', (line) => {
      // Only log non-static data (disabled to reduce console spam)
      // console.log('[PARSER DATA]', line);
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
let pollPaused = false; // Pause polling during upload
let pollDebugCounter = 0;
let initialPollDone = false;

setInterval(() => {
  if (!port || !port.isOpen || pollPaused) return;
  const now = Date.now();
  if (now - lastPoll < config.pollIntervalMs) return;
  lastPoll = now;
  
  // Send initial full query on first poll to get model/serial
  if (!initialPollDone) {
    sendRaw('XYZv3/query=wf'); // Full status query
    initialPollDone = true;
    console.log('[POLL] Initial full status query sent');
  } else {
    sendRaw('XYZv3/query=a'); // Temperature/status query
  }
  
  if (++pollDebugCounter % 20 === 0) {
    console.log('[POLL] Status query sent (count:', pollDebugCounter, ')');
  }
}, 100);

// Socket.io endpoints (UI -> server)
io.on('connection', (socket) => {
  console.log('Client connected');
  // Send current status immediately on connection
  socket.emit('status', latestStatus);
  console.log('Sent initial status to client:', { model: latestStatus.model, serialNumber: latestStatus.serialNumber });

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
        const dir = cmd.dir || '+';
        const len = cmd.len || '10';
        sendRaw(`XYZv3/action=jog:{"axis":"${cmd.axis}","dir":"${dir}","len":"${len}"}`);
        break;
      case 'load_filament':
        sendRaw('XYZv3/action=load:new');
        break;
      case 'load_filament_stop':
        sendRaw('XYZv3/action=load:cancel');
        // Query filament status after load completes
        setTimeout(() => sendRaw('XYZv3/query=wf'), 1000);
        break;
      case 'unload_filament':
        sendRaw('XYZv3/action=unload:new');
        break;
      case 'unload_filament_stop':
        sendRaw('XYZv3/action=unload:cancel');
        // Query filament status after unload completes
        setTimeout(() => sendRaw('XYZv3/query=wf'), 1000);
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

app.post('/upload', upload.single('file'), async (req, res) => {
  console.log('[UPLOAD] Received file:', req.file ? req.file.filename : 'none');
  if (!req.file) return res.status(400).json({ ok: false, error: 'no file uploaded' });
  
  // Check if it's a .3mf file that needs conversion
  if (req.file.filename.toLowerCase().endsWith('.3mf')) {
    console.log('[UPLOAD] Converting .3mf file:', req.file.filename);
    try {
      const gcodeFilename = req.file.filename.replace(/\.3mf$/i, '.gcode');
      const gcodePath = path.join(uploadsDir, gcodeFilename);
      
      console.log('[UPLOAD] Converting from:', req.file.path, 'to:', gcodePath);
      await convert3mfToGcode(req.file.path, gcodePath);
      
      // Remove the original .3mf file
      fs.unlinkSync(req.file.path);
      
      console.log('[UPLOAD] Conversion successful:', gcodeFilename);
      return res.json({
        ok: true,
        filename: gcodeFilename,
        size: fs.statSync(gcodePath).size,
        converted: true,
        originalFormat: '3mf'
      });
    } catch (error) {
      console.error('[UPLOAD] Conversion failed:', error.message);
      console.error('[UPLOAD] Error stack:', error.stack);
      return res.status(500).json({ 
        ok: false, 
        error: `Failed to convert .3mf file: ${error.message}` 
      });
    }
  }
  
  // Check if it's a .3w file and whether to convert it
  const shouldConvert = req.body.convert3w === 'true';
  
  if (req.file.filename.toLowerCase().endsWith('.3w') && shouldConvert) {
    console.log('[UPLOAD] Converting .3w file to gcode:', req.file.filename);
    try {
      const gcodeFilename = req.file.filename.replace(/\.3w$/i, '.gcode');
      const gcodePath = path.join(uploadsDir, gcodeFilename);
      
      console.log('[UPLOAD] Decrypting .3w from:', req.file.path, 'to:', gcodePath);
      const result = await convert3wToGcode(req.file.path, gcodePath);
      
      if (!result.success) {
        throw new Error(result.error || 'Decryption failed');
      }
      
      // Remove the original .3w file
      fs.unlinkSync(req.file.path);
      
      console.log('[UPLOAD] Decryption successful:', gcodeFilename);
      return res.json({
        ok: true,
        filename: gcodeFilename,
        size: fs.statSync(gcodePath).size,
        converted: true,
        originalFormat: '3w',
        message: result.message
      });
    } catch (error) {
      console.error('[UPLOAD] Decryption failed:', error.message);
      console.error('[UPLOAD] Error stack:', error.stack);
      return res.status(500).json({ 
        ok: false, 
        error: `Failed to decrypt .3w file: ${error.message}` 
      });
    }
  }
  
  // .3w file uploaded directly (not converted) - printer will decrypt natively
  if (req.file.filename.toLowerCase().endsWith('.3w')) {
    console.log('[UPLOAD] .3w file uploaded directly (encrypted):', req.file.filename);
    return res.json({
      ok: true,
      filename: req.file.filename,
      size: req.file.size,
      converted: false,
      format: '3w (encrypted)',
      message: '.3w file will be sent encrypted - printer decrypts natively'
    });
  }
  
  // Regular gcode file
  console.log('[UPLOAD] Gcode file uploaded:', req.file.filename);
  return res.json({
    ok: true,
    filename: req.file.filename,
    size: req.file.size
  });
});

app.get('/uploads', (req, res) => {
  try {
    const files = fs.readdirSync(uploadsDir)
      .filter(f => fs.statSync(path.join(uploadsDir, f)).isFile())
      .map(f => ({ name: f, time: fs.statSync(path.join(uploadsDir, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time)
      .slice(0, 10)
      .map(f => f.name);
    res.json({ ok: true, files });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.delete('/uploads/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    if (!filename) return res.status(400).json({ ok: false, error: 'missing filename' });
    const filePath = path.join(uploadsDir, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'file not found' });
    fs.unlinkSync(filePath);
    res.json({ ok: true, message: 'File deleted' });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/print', async (req, res) => {
  const filename = req.body && req.body.filename;
  if (!filename) return res.status(400).json({ ok: false, error: 'missing filename' });
  const filePath = path.join(uploadsDir, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'file not found' });
  
  console.log('[PRINT] Starting print job:', filename);
  
  // Check if uploader is ready
  if (!xyzUploader) {
    return res.status(503).json({ 
      ok: false, 
      error: 'Serial port not ready. Please wait for connection to establish.' 
    });
  }
  
  // Start upload which will automatically start printing
  // Don't await - let it run in background
  xyzUploader.uploadFile(filePath, filename).catch(err => {
    console.error('[PRINT] Upload/print error:', err.message);
    io.emit('upload_error', { error: err.message });
  });
  
  res.json({ ok: true, started: true });
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
