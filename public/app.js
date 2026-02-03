// public/app.js - UI client: consumes normalized 'status' objects and updates UI

console.log('app.js loaded - initializing Socket.IO...');
const socket = io();
console.log('Socket.IO instance created:', socket);

const connEl = document.getElementById('connection');
const printerModelEl = document.getElementById('printerModel');
const disconnectBtn = document.getElementById('disconnectBtn');
const helpBtn = document.getElementById('helpBtn');
const helpModal = document.getElementById('helpModal');
const helpClose = document.getElementById('helpClose');
const extruderTemp = document.getElementById('extruderTemp');
const extruderTarget = document.getElementById('extruderTarget');
const filamentLen = document.getElementById('filamentLen');
const filamentEst = document.getElementById('filamentEst');
const filamentName = document.getElementById('filamentName');
const jobFile = document.getElementById('jobFile');
const jobBar = document.getElementById('jobBar');
const jobTimes = document.getElementById('jobTimes');
const logEl = document.getElementById('log');

// Button state tracking
let isLoadingFilament = false;
let isUnloadingFilament = false;
let isCalibrating = false;
let printerModel = null;
let isNanoModel = false; // Track if it's a Nano (no manual calibration needed)

// Cache last values to avoid unnecessary DOM updates
let lastModelSerial = '';
let lastFilamentName = '';

// Manual filament tracking (for non-RFID filaments)
let manualFilament = {
  enabled: false,
  initialLength: 0, // meters
  startTime: null,
  printStartLength: 0, // remaining when print started
  printStartTime: null
};

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
  
  // Calculate length and populate the manual tracking dialog
  const lenM = calcFilamentLengthMeters();
  if (lenM) {
    document.getElementById('filamentInitialLength').value = lenM.toFixed(2);
  }
  
  closeFilamentModal();
  updateFilamentEstimateUI();
  
  // Return to the load dialog
  document.getElementById('filamentDialog').style.display = 'flex';
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
socket.on('connect', () => {
  console.log('Socket.IO connected!');
  connEl.textContent = 'Connected';
  connEl.style.color = '#2ecc71';
  disconnectBtn.textContent = 'Disconnect';
});
socket.on('disconnect', () => {
  console.log('Socket.IO disconnected');
  connEl.textContent = 'Disconnected';
  connEl.style.color = '#e74c3c';
  disconnectBtn.textContent = 'Connect';
});
socket.on('connect_error', (error) => {
  console.error('Socket.IO connection error:', error);
  connEl.textContent = 'Connection Error';
  connEl.style.color = '#e74c3c';
});
socket.on('error', (error) => {
  console.error('Socket.IO error:', error);
});

// receive normalized status
socket.on('status', (st) => {
  if (!st) return;
  
  // Update printer model/SN display - only update DOM if changed
  let modelSerial = '';
  if (st.model && st.serialNumber) {
    modelSerial = `${st.model} | SN: ${st.serialNumber}`;
    printerModel = st.model;
  } else if (st.model) {
    modelSerial = st.model;
    printerModel = st.model;
  }
  
  if (modelSerial && modelSerial !== lastModelSerial) {
    printerModelEl.textContent = modelSerial;
    lastModelSerial = modelSerial;
  }
  
  // Detect if it's a Nano model (automatic calibration only)
  if (printerModel && printerModel.toLowerCase().includes('nano')) {
    isNanoModel = true;
  } else if (printerModel) {
    // Non-Nano model detected - may need manual calibration buttons
    isNanoModel = false;
  }
  
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

  // filament - check if filament is actually loaded using status flags
  // fm=1 means filament mounted, fd=1 means filament detected
  // Handle both number and string comparisons, and be lenient if flags aren't available
  const hasFilament = (st.filamentMounted == 1 || st.filamentDetected == 1) || 
                      ((st.filamentMounted === null || st.filamentMounted === undefined) && 
                       st.filamentRemaining_mm !== null && st.filamentRemaining_mm > 0) ||
                      (st.filamentSerial && st.filamentSerial.length > 0) ||
                      (st.filamentInfo && st.filamentInfo.length > 0 && st.filamentInfo[0]);
  
  // Update manual tracking if print is running
  if (manualFilament.enabled && st.printPercent > 0 && st.printPercent < 100) {
    if (!manualFilament.printStartTime) {
      // Print just started
      manualFilament.printStartTime = Date.now();
      manualFilament.printStartLength = manualFilament.initialLength;
    }
  } else if (manualFilament.enabled && (st.printPercent === 0 || st.printPercent >= 100)) {
    // Print finished or not running - reset print tracking
    if (manualFilament.printStartTime) {
      manualFilament.printStartTime = null;
    }
  }
  
  if (st.filamentRemaining_mm !== null && st.filamentRemaining_mm !== undefined && st.filamentRemaining_mm > 0) {
    const m = (st.filamentRemaining_mm / 10000.0).toFixed(2);
    filamentLen.textContent = `${m} m`;
    filamentEst.textContent = ''; // Clear estimate when actual value is available
    // Hide manual tracking when RFID data available
    document.getElementById('filamentManual').style.display = 'none';
    manualFilament.enabled = false;
  } else if (manualFilament.enabled && manualFilament.initialLength > 0) {
    // Manual tracking for non-RFID filament
    let remainingM = manualFilament.initialLength;
    let usedM = 0;
    
    // Estimate consumption based on print progress and time
    if (manualFilament.printStartTime && st.printPercent > 0) {
      // Rough estimate: assume linear consumption with print percentage
      // This is not perfect but better than nothing
      const consumptionRate = manualFilament.printStartLength * (st.printPercent / 100);
      usedM = consumptionRate;
      remainingM = Math.max(0, manualFilament.printStartLength - usedM);
    }
    
    filamentLen.textContent = `${remainingM.toFixed(2)} m`;
    filamentEst.textContent = '';
    document.getElementById('filamentManualUsed').textContent = `${usedM.toFixed(2)} m`;
    document.getElementById('filamentManual').style.display = 'block';
  } else {
    // No filament length data
    filamentLen.textContent = '-- m';
    const est = calcFilamentLengthMeters();
    filamentEst.textContent = est ? `Spool est: ${est.toFixed(2)} m` : '';
    document.getElementById('filamentManual').style.display = 'none';
  }
  
  // Show filament info if we have it, regardless of flags (factory spools always have serial)
  let filamentNameText = '';
  if (st.filamentSerial && st.filamentSerial.length > 0) {
    filamentNameText = st.filamentSerial;
  } else if (st.filamentInfo && st.filamentInfo.length > 0 && st.filamentInfo[0]) {
    filamentNameText = st.filamentInfo[0];
  } else if (hasFilament) {
    filamentNameText = 'Filament loaded';
  } else {
    filamentNameText = 'No filament loaded';
  }
  
  // Only update DOM if changed
  if (filamentNameText !== lastFilamentName) {
    filamentName.textContent = filamentNameText;
    lastFilamentName = filamentNameText;
  }

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
  
  // Nano model has fully automatic calibration, other models may need manual steps
  if (stage === 'pressdetector' || stage === 'start') {
    if (isNanoModel) {
      pushLog('Calibration starting (automatic)...');
    } else {
      pushLog('Please LOWER probe on printer, then click "Lower Probe Done"');
      isCalibrating = true;
      document.getElementById('cal_lower').style.display = 'inline-block';
      document.getElementById('cal_raise').style.display = 'none';
      document.getElementById('cal_start').style.display = 'none';
    }
  } else if (stage === 'processing') {
    pushLog('Calibration processing...');
  } else if (stage === 'ok') {
    if (isNanoModel) {
      pushLog('Calibration OK.');
    } else {
      pushLog('Calibration OK. Please RAISE probe and click "Raise Probe Done"');
      document.getElementById('cal_lower').style.display = 'none';
      document.getElementById('cal_raise').style.display = 'inline-block';
    }
    
    // Parse calibration sensor values if available
    if (ev.parsed.values && Array.isArray(ev.parsed.values) && ev.parsed.values.length === 9) {
      analyzeBedLevel(ev.parsed.values);
    }
  } else if (stage === 'complete') {
    pushLog('Calibration complete.');
    isCalibrating = false;
    if (!isNanoModel) {
      document.getElementById('cal_lower').style.display = 'none';
      document.getElementById('cal_raise').style.display = 'none';
      document.getElementById('cal_start').style.display = 'inline-block';
    }
    document.getElementById('bedAdjust').style.display = 'none';
  } else if (stage.includes('fail') || stage.includes('unlevel')) {
    pushLog('Calibration failed. Please adjust bed manually and try again.');
    // Parse calibration sensor values for adjustment guidance
    if (ev.parsed.values && Array.isArray(ev.parsed.values) && ev.parsed.values.length === 9) {
      analyzeBedLevel(ev.parsed.values);
    }
  }
});

// Analyze bed level sensor readings and provide adjustment guidance
function analyzeBedLevel(values) {
  // Values are 9 bed level sensor readings from calibration
  // Typical layout for Da Vinci printers:
  // 0 1 2
  // 3 4 5  
  // 6 7 8
  // Front-left and front-right typically have adjustment knobs (positions 6 and 8 for Nano)
  
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const threshold = 15; // Tolerance in sensor units
  
  const frontLeft = values[6];  // Front-left sensor
  const frontRight = values[8]; // Front-right sensor
  
  const instructions = [];
  
  if (Math.abs(frontLeft - avg) > threshold) {
    const diff = frontLeft - avg;
    const direction = diff > 0 ? 'counterclockwise' : 'clockwise';
    const steps = Math.ceil(Math.abs(diff) / 10);
    instructions.push(`Front-left knob: Turn ${direction} ${steps} click${steps > 1 ? 's' : ''}`);
  }
  
  if (Math.abs(frontRight - avg) > threshold) {
    const diff = frontRight - avg;
    const direction = diff > 0 ? 'counterclockwise' : 'clockwise';
    const steps = Math.ceil(Math.abs(diff) / 10);
    instructions.push(`Front-right knob: Turn ${direction} ${steps} click${steps > 1 ? 's' : ''}`);
  }
  
  if (instructions.length > 0) {
    document.getElementById('bedAdjustInstructions').innerHTML = instructions.join('<br>');
    document.getElementById('bedAdjust').style.display = 'block';
    pushLog('Bed adjustment needed - see calibration section');
  } else {
    document.getElementById('bedAdjust').style.display = 'none';
  }
}

// webcam (deprecated - using mjpg-streamer instead)
socket.on('frame', (f) => {
  // Frame handling disabled - using direct camera stream
});

// Buttons
document.getElementById('cal_start').onclick = () => {
  socket.emit('command', { action: 'calibrate_start' });
  pushLog('Starting calibration...');
};
document.getElementById('cal_lower').onclick = () => {
  socket.emit('command', { action: 'calibrate_detector_lowered' });
};
document.getElementById('cal_raise').onclick = () => {
  socket.emit('command', { action: 'calibrate_detector_raised' });
};
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

// Load/Unload filament with conditional button visibility
document.getElementById('load').onclick = () => {
  // Show manual tracking dialog
  document.getElementById('filamentDialog').style.display = 'flex';
  document.getElementById('filamentInitialLength').value = '';
};

document.getElementById('filamentDialogCalc').onclick = () => {
  // Open weight calculator modal
  openFilamentModal();
};

document.getElementById('filamentDialogSkip').onclick = () => {
  // Skip manual tracking - just start load (RFID filament)
  document.getElementById('filamentDialog').style.display = 'none';
  manualFilament.enabled = false;
  socket.emit('command', { action: 'load_filament' });
  isLoadingFilament = true;
  document.getElementById('load_stop').style.display = 'inline-block';
};

document.getElementById('filamentDialogStart').onclick = () => {
  const initialLength = parseFloat(document.getElementById('filamentInitialLength').value);
  document.getElementById('filamentDialog').style.display = 'none';
  
  if (initialLength && initialLength > 0) {
    // Enable manual tracking
    manualFilament.enabled = true;
    manualFilament.initialLength = initialLength;
    manualFilament.startTime = Date.now();
    manualFilament.printStartLength = 0;
    manualFilament.printStartTime = null;
    pushLog(`Manual tracking enabled: ${initialLength} m initial`);
  } else {
    manualFilament.enabled = false;
  }
  
  socket.emit('command', { action: 'load_filament' });
  isLoadingFilament = true;
  document.getElementById('load_stop').style.display = 'inline-block';
};

document.getElementById('load_stop').onclick = () => {
  socket.emit('command', { action: 'load_filament_stop' });
  isLoadingFilament = false;
  document.getElementById('load_stop').style.display = 'none';
};

document.getElementById('unload').onclick = () => {
  // Show final tally before unloading
  if (manualFilament.enabled) {
    const used = manualFilament.initialLength - (manualFilament.printStartLength || manualFilament.initialLength);
    const remaining = manualFilament.printStartLength || manualFilament.initialLength;
    pushLog(`Unload Summary: Used ${used.toFixed(2)} m, Remaining ${remaining.toFixed(2)} m`);
    alert(`Filament Summary:\nInitial: ${manualFilament.initialLength.toFixed(2)} m\nUsed: ${used.toFixed(2)} m\nRemaining: ${remaining.toFixed(2)} m`);
  }
  
  socket.emit('command', { action: 'unload_filament' });
  isUnloadingFilament = true;
  document.getElementById('unload_stop').style.display = 'inline-block';
};

document.getElementById('unload_stop').onclick = () => {
  socket.emit('command', { action: 'unload_filament_stop' });
  isUnloadingFilament = false;
  document.getElementById('unload_stop').style.display = 'none';
  
  // Reset manual tracking on unload
  manualFilament.enabled = false;
  manualFilament.initialLength = 0;
  manualFilament.startTime = null;
  manualFilament.printStartLength = 0;
  manualFilament.printStartTime = null;
  document.getElementById('filamentManual').style.display = 'none';
};

document.getElementById('clean_nozzle').onclick = () => socket.emit('command', { action: 'clean_nozzle' });

// Disconnect/Reconnect button
disconnectBtn.onclick = () => {
  const btnText = disconnectBtn.textContent.trim();
  if (btnText === 'Disconnect') {
    socket.disconnect();
    disconnectBtn.textContent = 'Connect';
    connEl.textContent = 'Disconnected';
    connEl.style.color = '#e74c3c';
  } else {
    socket.connect();
    // Status will update when 'connect' event fires
    connEl.textContent = 'Connecting...';
    connEl.style.color = '#f39c12';
  }
};

// Help button
if (helpBtn && helpModal && helpClose) {
  helpBtn.onclick = () => {
    helpModal.style.display = 'flex';
  };

  helpClose.onclick = () => {
    helpModal.style.display = 'none';
  };

  window.addEventListener('click', (e) => {
    if (e.target === helpModal) {
      helpModal.style.display = 'none';
    }
  });
}

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
          if (!confirm(`Send ${f} to printer and start printing?`)) return;
          printBtn.disabled = true;
          const res = await fetch('/print', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: f })
          });
          const jr = await res.json();
          if (!jr.ok) uploadStatus.textContent = `Print error: ${jr.error || 'unknown'}`;
          else uploadStatus.textContent = `Sending ${f} to printer...`;
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
  
  // Check if it's a .3w file and ask user about conversion
  if (file.name.toLowerCase().endsWith('.3w')) {
    const modal = document.getElementById('convert3wModal');
    const yesBtn = document.getElementById('convert3wYes');
    const noBtn = document.getElementById('convert3wNo');
    
    // Show the modal
    modal.style.display = 'flex';
    
    // Handle user choice
    const handleChoice = (convert) => {
      modal.style.display = 'none';
      yesBtn.onclick = null;
      noBtn.onclick = null;
      performUpload(file, convert);
    };
    
    yesBtn.onclick = () => handleChoice(true);
    noBtn.onclick = () => handleChoice(false);
    return;
  }
  
  // Regular gcode file - upload directly
  performUpload(file, false);
};

function performUpload(file, convertToGcode) {
  const fd = new FormData();
  fd.append('file', file, file.name);
  fd.append('convert3w', convertToGcode ? 'true' : 'false');

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
  setUploadProgress(0, 'Uploading to Pi...');
};

// socket events for upload progress
socket.on('upload_started', (info) => {
  uploadStatus.textContent = `Sending to printer: ${info.filename || ''}`;
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
  uploadStatus.textContent = `Sent to printer. Ready to print.`;
  setUploadProgress(100);
  refreshUploads();
});
socket.on('upload_error', (e) => {
  uploadStatus.textContent = `Send error: ${e && e.error ? e.error : e}`;
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

window.addEventListener('load', async () => {
  refreshUploads();
  updateFilamentEstimateUI();
  
  // Camera stream handling with Edge browser compatibility
  const camStream = document.getElementById('camStream');
  const cameraSelect = document.getElementById('cameraSelect');
  
  // Get camera URLs and FPS from server
  let cameras = [];
  let cameraFps = 15; // Default to 15fps
  try {
    const response = await fetch('/api/camera-url');
    const data = await response.json();
    cameras = data.cameras || [];
    cameraFps = data.fps || 15;
    console.log('Cameras:', cameras, 'at', cameraFps, 'fps');
    
    // Populate dropdown
    cameras.forEach((cam, index) => {
      const option = document.createElement('option');
      option.value = cam.id;
      option.textContent = cam.device;
      cameraSelect.appendChild(option);
    });
  } catch (err) {
    // Fallback to using window location
    const hostname = window.location.hostname;
    cameras = [
      { id: 'cam0', device: '/dev/video-printer', url: `http://${hostname}:8080` },
      { id: 'cam1', device: '/dev/video-laser', url: `http://${hostname}:8081` }
    ];
    console.log('Failed to get cameras from server, using fallback:', cameras);
    
    // Populate dropdown with fallback
    cameras.forEach((cam) => {
      const option = document.createElement('option');
      option.value = cam.id;
      option.textContent = cam.device;
      cameraSelect.appendChild(option);
    });
  }
  
  const snapshotInterval = Math.round(1000 / cameraFps); // Convert FPS to milliseconds
  let snapshotTimer = null;
  
  function startSnapshotMode(baseUrl) {
    console.log(`Using snapshot mode for camera at ${cameraFps}fps (${snapshotInterval}ms interval)`);
    
    // Clear existing timer if any
    if (snapshotTimer) clearInterval(snapshotTimer);
    
    // Refresh snapshot at configured FPS
    snapshotTimer = setInterval(() => {
      camStream.src = `${baseUrl}/?action=snapshot&_t=${Date.now()}`;
    }, snapshotInterval);
  }
  
  function loadCamera(cameraId) {
    const camera = cameras.find(cam => cam.id === cameraId);
    if (!camera) {
      console.error('Camera not found:', cameraId);
      return;
    }
    
    const baseUrl = camera.url;
    console.log('Switching to camera:', camera.device, baseUrl);
    
    // Clear any existing snapshot timer
    if (snapshotTimer) {
      clearInterval(snapshotTimer);
      snapshotTimer = null;
    }
    
    // Detect if browser is Edge or doesn't support MJPEG well
    const isEdge = /Edg/.test(navigator.userAgent);
    
    if (isEdge) {
      // Edge doesn't handle MJPEG streams well, use snapshot mode
      console.log('Edge browser detected, using snapshot mode');
      startSnapshotMode(baseUrl);
    } else {
      // Try MJPEG stream for Chrome/Firefox
      const streamUrl = `${baseUrl}/?action=stream`;
      console.log('Attempting MJPEG stream from:', streamUrl);
      
      camStream.onerror = () => {
        console.log('MJPEG stream failed, switching to snapshot mode');
        startSnapshotMode(baseUrl);
      };
      
      camStream.src = streamUrl;
      
      // Fallback: if stream doesn't load within 3 seconds, use snapshots
      setTimeout(() => {
        if (!camStream.complete || camStream.naturalHeight === 0) {
          console.log('MJPEG stream timeout, switching to snapshot mode');
          startSnapshotMode(baseUrl);
        }
      }, 3000);
    }
  }
  
  // Camera selector change event
  cameraSelect.addEventListener('change', (e) => {
    loadCamera(e.target.value);
  });
  
  // Load first camera by default
  if (cameras.length > 0) {
    loadCamera(cameras[0].id);
  }
  
  // Reconnect camera button
  const reconnectBtn = document.getElementById('reconnectCamera');
  reconnectBtn.addEventListener('click', async () => {
    reconnectBtn.disabled = true;
    reconnectBtn.textContent = '...';
    try {
      const response = await fetch('/api/reconnect-camera', { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        // Reload camera after short delay
        setTimeout(() => {
          if (cameras.length > 0) loadCamera(cameras[0].id);
          reconnectBtn.textContent = '⟳';
          reconnectBtn.disabled = false;
        }, 2000);
      } else {
        alert('Failed to restart camera');
        reconnectBtn.textContent = '⟳';
        reconnectBtn.disabled = false;
      }
    } catch (err) {
      console.error('Error reconnecting camera:', err);
      alert('Error reconnecting camera');
      reconnectBtn.textContent = '⟳';
      reconnectBtn.disabled = false;
    }
  });
});
