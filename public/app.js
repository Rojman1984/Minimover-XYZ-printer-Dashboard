// public/app.js - UI client: consumes normalized 'status' objects and updates UI

const socket = io();

const connEl = document.getElementById('connection');
const extruderTemp = document.getElementById('extruderTemp');
const extruderTarget = document.getElementById('extruderTarget');
const filamentLen = document.getElementById('filamentLen');
const filamentEst = document.getElementById('filamentEst');
const filamentName = document.getElementById('filamentName');
const jobFile = document.getElementById('jobFile');
const jobBar = document.getElementById('jobBar');
const jobTimes = document.getElementById('jobTimes');
const logEl = document.getElementById('log');
const camImg = document.getElementById('camFrame');

// Filament modal elements
const filamentModal = document.getElementById('filamentModal');
const filamentClose = document.getElementById('filamentClose');
const filamentSave = document.getElementById('filamentSave');
const filamentMaterial = document.getElementById('filamentMaterial');
const filamentDiameter = document.getElementById('filamentDiameter');
const filamentSpoolWeight = document.getElementById('filamentSpoolWeight');
const filamentTareWeight = document.getElementById('filamentTareWeight');
const filamentDensity = document.getElementById('filamentDensity');
const filamentCalc = document.getElementById('filamentCalc');

const materialDensityMap = {
  PLA: 1.24,
  ABS: 1.04,
  PETG: 1.27,
  TPE: 1.21,
  PVA: 1.19
};

function calcFilamentLengthMeters() {
  const diameterMm = parseFloat(filamentDiameter.value);
  const spoolWeightG = parseFloat(filamentSpoolWeight.value);
  const tareWeightG = parseFloat(filamentTareWeight.value) || 0;
  const density = parseFloat(filamentDensity.value);
  if (!diameterMm || !spoolWeightG || !density) return null;
  const filamentMassG = Math.max(0, spoolWeightG - tareWeightG);
  const radiusMm = diameterMm / 2.0;
  const areaMm2 = Math.PI * radiusMm * radiusMm;
  const volumeMm3 = (filamentMassG / density) * 1000.0; // cm^3 to mm^3
  const lengthMm = volumeMm3 / areaMm2;
  return lengthMm / 1000.0;
}

function updateFilamentCalc() {
  const lenM = calcFilamentLengthMeters();
  filamentCalc.textContent = lenM ? `Estimated length: ${lenM.toFixed(2)} m` : 'Estimated length: -- m';
}

function openFilamentModal() {
  const saved = JSON.parse(localStorage.getItem('filamentProfile') || '{}');
  if (saved.material) filamentMaterial.value = saved.material;
  if (saved.diameter) filamentDiameter.value = saved.diameter;
  if (saved.spoolWeight) filamentSpoolWeight.value = saved.spoolWeight;
  if (saved.tareWeight) filamentTareWeight.value = saved.tareWeight;
  if (saved.density) filamentDensity.value = saved.density;
  updateFilamentCalc();
  filamentModal.classList.remove('hidden');
}

function closeFilamentModal() {
  filamentModal.classList.add('hidden');
}

function saveFilamentProfile() {
  const profile = {
    material: filamentMaterial.value,
    diameter: parseFloat(filamentDiameter.value),
    spoolWeight: parseFloat(filamentSpoolWeight.value),
    tareWeight: parseFloat(filamentTareWeight.value) || 0,
    density: parseFloat(filamentDensity.value)
  };
  localStorage.setItem('filamentProfile', JSON.stringify(profile));
  updateFilamentCalc();
  closeFilamentModal();
  updateFilamentEstimateUI();
}

function updateFilamentEstimateUI() {
  const lenM = calcFilamentLengthMeters();
  if (lenM) filamentEst.textContent = `Spool est: ${lenM.toFixed(2)} m`;
  else filamentEst.textContent = '--';
}

function pushLog(s) {
  const p = document.createElement('div');
  p.textContent = `${new Date().toLocaleTimeString()} - ${s}`;
  logEl.prepend(p);
}

// connection status
socket.on('connect', () => connEl.textContent = 'Connected');
socket.on('disconnect', () => connEl.textContent = 'Disconnected');

// receive normalized status
socket.on('status', (st) => {
  if (!st) return;
  // extruder
  if (st.extruderActual_C !== null && st.extruderActual_C !== undefined) {
    extruderTemp.textContent = `${st.extruderActual_C} °C`;
  } else {
    extruderTemp.textContent = '-- °C';
  }
  if (st.extruderTarget_C) extruderTarget.textContent = `target: ${st.extruderTarget_C} °C`;

  // bed
  if (st.bedActual_C !== null && st.bedActual_C !== undefined) {
    // optionally display bed in the extruder tile if you prefer
  }

  // filament
  if (st.filamentRemaining_mm !== null && st.filamentRemaining_mm !== undefined) {
    const m = (st.filamentRemaining_mm / 10000.0).toFixed(2);
    filamentLen.textContent = `${m} m`;
  } else {
    const est = calcFilamentLengthMeters();
    filamentLen.textContent = est ? `${est.toFixed(2)} m` : '-- m';
  }
  if (st.filamentSerial) filamentName.textContent = st.filamentSerial;
  else filamentName.textContent = (st.filamentInfo && st.filamentInfo[0]) ? st.filamentInfo[0] : '--';

  updateFilamentEstimateUI();

  // job
  if (st.fileName) jobFile.textContent = st.fileName;
  else if (st.jobMessage) jobFile.textContent = st.jobMessage;
  else jobFile.textContent = 'No job';

  if (st.printPercent !== null && st.printPercent !== undefined) {
    const pct = Math.max(0, Math.min(100, st.printPercent));
    jobBar.style.width = `${pct}%`;
    jobBar.textContent = `${Math.round(pct)}%`;
  } else {
    jobBar.style.width = `0%`;
    jobBar.textContent = '';
  }

  if (st.elapsedMin || st.timeLeftMin) {
    jobTimes.textContent = `${st.elapsedMin || '--'}m / ${st.timeLeftMin || '--'}m left`;
  }

  // printer state (only log state changes, not every update)
  if (st.printerStateStr && st.printerStateStr !== window.lastPrinterState) {
    window.lastPrinterState = st.printerStateStr;
    pushLog(`State: ${st.printerStateStr}`);
  }

  // raw sample for debugging
  if (st.raw && st.raw.length) {
    // don't spam logs, show only latest few
    const preview = st.raw.slice(-3).join(' | ');
    // pushLog(preview);
  }
});

// generic log lines
socket.on('log', (l) => {
  if (l && l.line) pushLog(l.line);
  else if (l && l.json) pushLog(JSON.stringify(l.json));
});

// calibrate events
socket.on('calibrate', (ev) => {
  if (!ev || !ev.parsed) return;
  const stage = ev.parsed.stage || ev.parsed.stat || ev.parsed.raw;
  pushLog(`Calibrate event: ${stage}`);
  // Update UI hints
  if (stage === 'pressdetector' || stage === 'start') {
    pushLog('Please LOWER detector on printer, then click "Lower Detector Done"');
  } else if (stage === 'processing') {
    pushLog('Calibration processing...');
  } else if (stage === 'ok') {
    pushLog('Calibration OK. Please RAISE detector and click "Raise Detector Done"');
  } else if (stage === 'complete') {
    pushLog('Calibration complete.');
  } else if (stage === 'fail') {
    pushLog('Calibration failed. Try again.');
  }
});

// webcam
socket.on('frame', (f) => {
  if (f && f.b64) camImg.src = 'data:image/jpeg;base64,' + f.b64;
});

// Buttons
document.getElementById('cal_start').onclick = () => socket.emit('command', { action: 'calibrate_start' });
document.getElementById('cal_lower').onclick = () => socket.emit('command', { action: 'calibrate_detector_lowered' });
document.getElementById('cal_raise').onclick = () => socket.emit('command', { action: 'calibrate_detector_raised' });
document.getElementById('toggle_autolevel').onclick = () => {
  const en = confirm('Enable auto-level? OK=yes, Cancel=no');
  socket.emit('command', { action: 'toggle_autolevel', enable: en });
};
document.getElementById('pause').onclick = () => {
  const token = null; // you may add a UI input to supply token; server will use latestStatus.token fallback
  socket.emit('command', { action: 'pause', token });
};
document.getElementById('resume').onclick = () => {
  const token = null;
  socket.emit('command', { action: 'resume', token });
};
document.getElementById('cancel').onclick = () => {
  const token = null;
  socket.emit('command', { action: 'cancel', token });
};
document.getElementById('home').onclick = () => socket.emit('command', { action: 'home' });
document.getElementById('load').onclick = () => {
  socket.emit('command', { action: 'load_filament' });
  openFilamentModal();
};
document.getElementById('load_stop').onclick = () => socket.emit('command', { action: 'load_filament_stop' });
document.getElementById('unload').onclick = () => socket.emit('command', { action: 'unload_filament' });
document.getElementById('unload_stop').onclick = () => socket.emit('command', { action: 'unload_filament_stop' });
document.getElementById('clean_nozzle').onclick = () => socket.emit('command', { action: 'clean_nozzle' });
document.getElementById('setZ').onclick = () => {
  const off = parseInt(document.getElementById('zoff').value || '0', 10);
  socket.emit('command', { action: 'set_zoffset', offset: off });
};

// Jog controls
function jog(axis, dir) {
  const len = document.getElementById('jogDistance').value;
  socket.emit('command', { action: 'jog', axis, dir, len });
}
document.getElementById('jogXPlus').onclick = () => jog('x', '+');
document.getElementById('jogXMinus').onclick = () => jog('x', '-');
document.getElementById('jogYPlus').onclick = () => jog('y', '+');
document.getElementById('jogYMinus').onclick = () => jog('y', '-');
document.getElementById('jogZPlus').onclick = () => jog('z', '+');
document.getElementById('jogZMinus').onclick = () => jog('z', '-');
document.getElementById('jogHome').onclick = () => socket.emit('command', { action: 'home' });

// Jog controls
function jog(axis, dir) {
  const len = document.getElementById('jogDistance').value;
  socket.emit('command', { action: 'jog', axis, dir, len });
}
document.getElementById('jogXPlus').onclick = () => jog('x', '+');
document.getElementById('jogXMinus').onclick = () => jog('x', '-');
document.getElementById('jogYPlus').onclick = () => jog('y', '+');
document.getElementById('jogYMinus').onclick = () => jog('y', '-');
document.getElementById('jogZPlus').onclick = () => jog('z', '+');
document.getElementById('jogZMinus').onclick = () => jog('z', '-');
document.getElementById('jogHome').onclick = () => socket.emit('command', { action: 'home' });

// Upload UI
const uploadFileEl = document.getElementById('uploadFile');
const uploadBtn = document.getElementById('uploadBtn');
const uploadProgressBar = document.getElementById('uploadProgressBar');
const uploadStatus = document.getElementById('uploadStatus');
const uploadsList = document.getElementById('uploadsList');

function setUploadProgress(percent, text) {
  uploadProgressBar.style.width = `${percent}%`;
  uploadProgressBar.textContent = `${Math.round(percent)}%`;
  if (text) uploadStatus.textContent = text;
}

async function refreshUploads() {
  try {
    const r = await fetch('/uploads');
    const j = await r.json();
    uploadsList.innerHTML = '';
    if (j.ok && Array.isArray(j.files)) {
      j.files.forEach(f => {
        const li = document.createElement('li');
        li.textContent = f + ' ';
        
        const printBtn = document.createElement('button');
        printBtn.textContent = 'Print';
        printBtn.onclick = async () => {
          printBtn.disabled = true;
          const res = await fetch('/print', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: f })
          });
          const jr = await res.json();
          if (!jr.ok) uploadStatus.textContent = `Print error: ${jr.error || 'unknown'}`;
          else uploadStatus.textContent = `Print started for ${f}`;
          printBtn.disabled = false;
        };
        li.appendChild(printBtn);
        
        const delBtn = document.createElement('button');
        delBtn.textContent = 'Delete';
        delBtn.style.marginLeft = '5px';
        delBtn.onclick = async () => {
          if (!confirm(`Delete ${f}?`)) return;
          delBtn.disabled = true;
          try {
            const res = await fetch(`/uploads/${encodeURIComponent(f)}`, { method: 'DELETE' });
            const jr = await res.json();
            if (jr.ok) {
              uploadStatus.textContent = `Deleted ${f}`;
              await refreshUploads();
            } else {
              uploadStatus.textContent = `Delete error: ${jr.error || 'unknown'}`;
              delBtn.disabled = false;
            }
          } catch (e) {
            uploadStatus.textContent = `Delete failed: ${e.message}`;
            delBtn.disabled = false;
          }
        };
        li.appendChild(delBtn);
        
        uploadsList.appendChild(li);
      });
    }
  } catch (e) {
    uploadStatus.textContent = 'Failed to list uploads';
  }
}

// XHR upload to support progress events
uploadBtn.onclick = () => {
  const files = uploadFileEl.files;
  if (!files || !files.length) { uploadStatus.textContent = 'No file selected'; return; }
  const file = files[0];
  const fd = new FormData();
  fd.append('file', file, file.name);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/upload', true);

  xhr.upload.onprogress = (ev) => {
    if (ev.lengthComputable) {
      const pct = (ev.loaded / ev.total) * 100;
      setUploadProgress(pct, 'Uploading...');
    }
  };

  xhr.onload = async () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        const res = JSON.parse(xhr.responseText);
        if (res.ok) {
          let statusMsg = `Uploaded ${res.filename}`;
          if (res.converted) {
            statusMsg += ` (converted from ${res.originalFormat})`;
          }
          setUploadProgress(100, statusMsg);
          await refreshUploads();
        } else {
          uploadStatus.textContent = `Upload failed: ${res.error || 'unknown'}`;
        }
      } catch (e) {
        uploadStatus.textContent = 'Upload response parse error';
      }
    } else {
      uploadStatus.textContent = `Upload failed: ${xhr.statusText || xhr.status}`;
    }
  };

  xhr.onerror = () => { uploadStatus.textContent = 'Upload network error'; };
  xhr.send(fd);
  setUploadProgress(0, 'Starting upload...');
};

// socket events for upload progress
socket.on('upload_started', (info) => {
  uploadStatus.textContent = `Upload started: ${info.filename || ''}`;
  setUploadProgress(0);
});
socket.on('upload_progress', (p) => {
  if (p && p.total) {
    const pct = (p.sent / p.total) * 100;
    setUploadProgress(pct, `Sending to printer: ${p.sent}/${p.total}`);
  } else if (p && p.percent) {
    setUploadProgress(p.percent, `Sending to printer: ${p.percent}%`);
  }
});
socket.on('upload_finished', (r) => {
  uploadStatus.textContent = `Upload finished. Token: ${r.token || ''}`;
  setUploadProgress(100);
  refreshUploads();
});
socket.on('upload_error', (e) => {
  uploadStatus.textContent = `Upload error: ${e && e.error ? e.error : e}`;
});

filamentMaterial.addEventListener('change', () => {
  if (materialDensityMap[filamentMaterial.value]) {
    filamentDensity.value = materialDensityMap[filamentMaterial.value];
  }
  updateFilamentCalc();
});
[filamentDiameter, filamentSpoolWeight, filamentTareWeight, filamentDensity].forEach((el) => {
  el.addEventListener('input', updateFilamentCalc);
});
filamentClose.addEventListener('click', closeFilamentModal);
filamentSave.addEventListener('click', saveFilamentProfile);

window.addEventListener('load', () => {
  refreshUploads();
  updateFilamentEstimateUI();
  
  // Try to load MJPG stream, fallback to socket.io frames on error
  const mjpgStream = document.getElementById('mjpgStream');
  const camFrame = document.getElementById('camFrame');
  
  const streamUrl = `http://${window.location.hostname}:8080/?action=stream`;
  console.log('Attempting to load camera stream from:', streamUrl);
  
  mjpgStream.src = streamUrl;
  mjpgStream.onload = () => console.log('Camera stream loaded successfully');
  mjpgStream.onerror = () => {
    console.log('MJPG stream failed, using socket.io fallback');
    mjpgStream.style.display = 'none';
    camFrame.style.display = 'block';
  };
});
