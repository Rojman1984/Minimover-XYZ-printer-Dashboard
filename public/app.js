const socket = io();

const connEl = document.getElementById('connection');
const extruderTemp = document.getElementById('extruderTemp');
const extruderTarget = document.getElementById('extruderTarget');
const filamentLen = document.getElementById('filamentLen');
const filamentName = document.getElementById('filamentName');
const jobFile = document.getElementById('jobFile');
const jobBar = document.getElementById('jobBar');
const jobTimes = document.getElementById('jobTimes');
const logEl = document.getElementById('log');
const camImg = document.getElementById('camFrame');

function pushLog(s) {
  const p = document.createElement('div'); p.textContent = s; logEl.prepend(p);
}

socket.on('connect', () => connEl.textContent = 'Connected');
socket.on('disconnect', () => connEl.textContent = 'Disconnected');

socket.on('status', (st) => {
  const p = st.parsed || {};
  if (p.statusJson && p.statusJson.data) {
    const d = p.statusJson.data;
    if (d.t && d.t[0]) {
      extruderTemp.textContent = (d.t[0] + ' °C');
    }
    if (d.f) {
      jobFile.textContent = 'File: ' + (d.f[0] || '--');
    }
  }
  if (p.json && p.json.data) {
    pushLog('status JSON');
  }
});

socket.on('log', (l) => {
  if (l.type === 'calibrate') {
    pushLog('[CAL] ' + l.line);
  } else if (l.line) pushLog(l.line);
});

socket.on('calibrateEvent', (ev) => {
  pushLog('Calibrate: ' + ev.payload);
});

socket.on('frame', (f) => {
  camImg.src = 'data:image/jpeg;base64,' + f.b64;
});

// Buttons
document.getElementById('cal_start').onclick = () => socket.emit('command', { action: 'calibrate_start' });
document.getElementById('cal_lower').onclick = () => socket.emit('command', { action: 'calibrate_detector_lowered' });
document.getElementById('cal_raise').onclick = () => socket.emit('command', { action: 'calibrate_detector_raised' });
document.getElementById('toggle_autolevel').onclick = () => {
  const en = confirm('Enable auto-level? OK=yes, Cancel=no');
  socket.emit('command', { action: 'toggle_autolevel', enable: en });
};
document.getElementById('pause').onclick = () => socket.emit('command', { action: 'pause', token: '' });
document.getElementById('resume').onclick = () => socket.emit('command', { action: 'resume', token: '' });
document.getElementById('cancel').onclick = () => socket.emit('command', { action: 'cancel', token: '' });
document.getElementById('home').onclick = () => socket.emit('command', { action: 'home' });
document.getElementById('load').onclick = () => socket.emit('command', { action: 'load_filament' });
document.getElementById('unload').onclick = () => socket.emit('command', { action: 'unload_filament' });
document.getElementById('setZ').onclick = () => {
  const off = parseInt(document.getElementById('zoff').value || '0', 10);
  socket.emit('command', { action: 'set_zoffset', offset: off });
};