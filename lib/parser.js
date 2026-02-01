// lib/parser.js
// Lightweight parser for miniMover / XYZ protocol lines.
// Emits:
//  - 'status' with a normalized status object
//  - 'calibrate' with { stage, data, raw }
//  - 'log' with { line }
//  - 'token' with token string (when found in responses)

const EventEmitter = require('events');

class Parser extends EventEmitter {
  constructor() {
    super();
    this.latest = {
      rawLines: [],
      parsed: {}
    };
    this.token = null;
  }

  feed(raw) {
    if (!raw) return;
    const line = raw.toString().trim();
    if (!line) return;

    // Save raw
    this.latest.rawLines.push(line);
    if (this.latest.rawLines.length > 200) this.latest.rawLines.shift();

    // Calibrate special prefix
    if (line.startsWith('calibratejr:')) {
      const payload = line.substring('calibratejr:'.length).trim();
      const parsed = this._parseCalibratePayload(payload);
      this.latest.parsed.calibrate = parsed;
      this.emit('calibrate', { raw: line, parsed });
      return;
    }

    // j: lines (status codes), e.g. "j:9535,41"
    if (line.startsWith('j:')) {
      const v = line.substring(2).split(',');
      const code = parseInt(v[0], 10);
      const sub = v.length > 1 ? parseInt(v[1], 10) : undefined;
      this.latest.parsed.j = { code, sub, raw: line };
      // Also emit status update with printerState fields
      const normalized = this._buildNormalizedStatus();
      this.emit('status', normalized);
      return;
    }

    // other tokenized lines: s:, o:, z:, etc. Keep them in parsed.
    if (/^[sozp]:/.test(line)) {
      const prefix = line[0];
      this.latest.parsed[prefix] = line.substring(2);
      this.emit('log', { line });
      return;
    }

    // Filament remaining: f:count,len,len2
    if (line.startsWith('f:')) {
      const parts = line.substring(2).split(',');
      const sj = this.latest.parsed.statusJson || {};
      const count = parseInt(parts[0], 10);
      const len1 = parts.length > 1 ? parseInt(parts[1], 10) : null;
      const len2 = parts.length > 2 ? parseInt(parts[2], 10) : null;
      if (!Number.isNaN(count)) sj.filamentSpoolCount = count;
      if (!Number.isNaN(len1)) sj.filamentRemaining_mm = len1;
      if (!Number.isNaN(len2)) sj.filament2Remaining_mm = len2;
      this.latest.parsed.statusJson = sj;
      const normalized = this._buildNormalizedStatus();
      this.emit('status', normalized);
      return;
    }

    // Filament serial: w:count,serial (or serial1,serial2)
    if (line.startsWith('w:')) {
      const parts = line.substring(2).split(',');
      const sj = this.latest.parsed.statusJson || {};
      if (parts.length >= 2) {
        const serial1 = parts[1];
        sj.filamentSerial = serial1;
        sj.filamentInfo = [serial1];
        if (parts.length >= 3) {
          const serial2 = parts[2];
          sj.filamentSerial2 = serial2;
          sj.filamentInfo.push(serial2);
        }
      }
      this.latest.parsed.statusJson = sj;
      const normalized = this._buildNormalizedStatus();
      this.emit('status', normalized);
      return;
    }

    // Handle temperature line: t:heaterIndex,actual,target
    if (line.startsWith('t:')) {
      const parts = line.substring(2).split(',');
      const sj = this.latest.parsed.statusJson || {};
      // Format: t:1,38,0 means heater 1, actual 38°C, target 0°C
      if (parts[1]) sj.extruderActual_C = parseFloat(parts[1]);
      if (parts[2]) sj.extruderTarget_C = parseFloat(parts[2]);
      this.latest.parsed.statusJson = sj;
      const normalized = this._buildNormalizedStatus();
      this.emit('status', normalized);
      return;
    }

    // Handle bed temperature line: b:actual or b:actual,target
    if (line.startsWith('b:')) {
      const parts = line.substring(2).split(',');
      const sj = this.latest.parsed.statusJson || {};
      if (parts[0] && parts[0] !== '0') sj.bedActual_C = parseFloat(parts[0]);
      if (parts[1]) sj.bedTarget_C = parseFloat(parts[1]);
      this.latest.parsed.statusJson = sj;
      const normalized = this._buildNormalizedStatus();
      this.emit('status', normalized);
      return;
    }

    // Try to find a JSON object inside the line
    const firstBrace = line.indexOf('{');
    const lastBrace = line.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const jsonSub = line.substring(firstBrace, lastBrace + 1);
      try {
        const obj = JSON.parse(jsonSub);
        // store parsed json
        this.latest.parsed.json = obj;
        // if this JSON looks like a status payload (has data) or has a token, handle it
        if (obj.data || obj.command === 2 || obj.result !== undefined) {
          this._mapStatusFromJson(obj);
          const normalized = this._buildNormalizedStatus();
          this.emit('status', normalized);
        } else {
          // Emit generic json log
          this.emit('log', { type: 'json', json: obj, raw: line });
        }
        // token extraction for file upload responses: many responses include "token":"..."
        if (obj.token && typeof obj.token === 'string') {
          this.token = obj.token;
          this.emit('token', this.token);
        } else if (obj.data && obj.data.token) {
          this.token = obj.data.token;
          this.emit('token', this.token);
        }
        return;
      } catch (e) {
        // Not strict JSON (or partially malformed); fall through
      }
    }

    // If we get here, it's an unstructured line; emit as log
    this.emit('log', { line });
  }

  _parseCalibratePayload(payload) {
    // payload might be strictly JSON or something like {"stat":"ok",438,453,...}
    const firstBrace = payload.indexOf('{');
    const lastBrace = payload.indexOf('}');
    let stage = null, data = null;
    if (firstBrace !== -1 && lastBrace !== -1) {
      const jsonPart = payload.substring(firstBrace, lastBrace + 1);
      try {
        const parsed = JSON.parse(jsonPart);
        stage = parsed.stat || parsed.status || null;
        // After the brace there may be comma-separated numeric readings
        const rest = payload.substring(lastBrace + 1).trim();
        if (rest && rest.length > 0) {
          // find numbers
          const nums = rest.match(/-?\d+/g);
          if (nums) data = nums.map(n => parseInt(n, 10));
        }
        return { stage, data, raw: payload };
      } catch (e) {
        // fallback: try simple stat extract
        const m = payload.match(/"stat"\s*:\s*"([^"]+)"/);
        if (m) {
          stage = m[1];
          const nums = payload.substring(lastBrace + 1).match(/-?\d+/g) || [];
          data = nums.map(n => parseInt(n, 10));
          return { stage, data, raw: payload };
        }
      }
    }
    return { stage: payload, data: null, raw: payload };
  }

  _mapStatusFromJson(obj) {
    // Best-effort mapping from the repo's status JSON structure into our parsed object
    const out = this.latest.parsed.statusJson || {};
    const data = obj.data || obj;

    // Bed temperatures
    if (data.b !== undefined) out.bedActual_C = parseInt(data.b, 10);
    if (data.B !== undefined) out.bedTarget_C = parseInt(data.B, 10);

    // Print progress and timing
    if (data.d) {
      const parts = data.d.toString().split(',');
      if (parts.length >= 3) {
        out.printPercent = parseInt(parts[0], 10);
        out.elapsedMin = parseInt(parts[1], 10);
        out.timeLeftMin = parseInt(parts[2], 10);
      }
    } else if (data.D !== undefined) {
      out.printPercent = parseInt(data.D, 10);
    }

    // Extruder temperatures
    if (data.t) {
      if (Array.isArray(data.t)) {
        const actual = parseFloat(data.t[0]);
        if (!Number.isNaN(actual)) out.extruderActual_C = actual;
        if (data.t.length > 1) {
          const target = parseFloat(data.t[1]);
          if (!Number.isNaN(target)) out.extruderTarget_C = target;
        }
      } else if (!Number.isNaN(parseFloat(data.t))) {
        out.extruderActual_C = parseFloat(data.t);
      }
    }

    // Filament and metadata
    if (data.f && Array.isArray(data.f)) out.filamentFlags = data.f;
    if (data.p) out.model = data.p;
    if (data.i) out.serialNumber = data.i;
    if (data.v) out.versions = data.v;

    if (data.j !== undefined) {
      out.printerState = parseInt(data.j, 10);
      out.printerStateStr = (typeof data.j === 'string') ? data.j : null;
    }

    if (data.o && typeof data.o === 'object') {
      out.oPacketSize = data.o.p || data.o.packet || out.oPacketSize;
    }

    if (data.l) out.filamentRemaining_mm = data.l;
    if (data.w && Array.isArray(data.w)) {
      out.filamentInfo = data.w;
      if (data.w.length > 0) out.filamentSerial = data.w[0];
    }
    if (data.G) out.GLastUsed = data.G;

    // store back
    this.latest.parsed.statusJson = out;
  }

  _buildNormalizedStatus() {
    // Build the normalized shape described in the plan. Use best-effort values from latest.parsed
    const p = this.latest.parsed || {};
    const sj = p.statusJson || {};
    const normalized = {
      isValid: true,
      timestamp: Date.now(),
      printerState: sj.printerState || (p.j && p.j.code) || null,
      printerStateStr: sj.printerStateStr || null,
      extruderActual_C: sj.extruderActual_C !== undefined ? sj.extruderActual_C : null,
      extruderTarget_C: sj.extruderTarget_C !== undefined ? sj.extruderTarget_C : null,
      bedActual_C: sj.bedActual_C !== undefined ? sj.bedActual_C : null,
      bedTarget_C: sj.bedTarget_C !== undefined ? sj.bedTarget_C : null,
      printPercent: sj.printPercent !== undefined ? sj.printPercent : null,
      elapsedMin: sj.elapsedMin !== undefined ? sj.elapsedMin : null,
      timeLeftMin: sj.timeLeftMin !== undefined ? sj.timeLeftMin : null,
      filamentRemaining_mm: sj.filamentRemaining_mm !== undefined ? sj.filamentRemaining_mm : null,
      filamentSerial: sj.filamentSerial || null,
      fileName: sj.fileName || null,
      oPacketSize: sj.oPacketSize || (sj.o && sj.o.p) || null,
      raw: this.latest.rawLines.slice(-50),
      token: this.token || null,
      rawParsed: this.latest.parsed
    };
    return normalized;
  }
}

module.exports = Parser;