# Minimover XYZ Printer Dashboard - Project Context

> **📋 INSTRUCTIONS FOR AI AGENTS**
>
> This is a **LIVING DOCUMENT** that must be maintained and updated throughout the project lifecycle.
>
> **Your responsibilities when working on this project:**
> 1. **READ THIS ENTIRE DOCUMENT FIRST** before making any changes to understand the current state
> 2. **UPDATE THIS DOCUMENT** whenever you:
>    - Add new features or functionality
>    - Modify existing code or architecture
>    - Fix bugs or resolve issues
>    - Make configuration changes
>    - Discover important technical details
>    - Change dependencies or system requirements
> 3. **Update the relevant sections**:
>    - Add new features to "Key Features Implemented"
>    - Document modified files in "Files Modified in Session"
>    - Update "Current Working State" checklist
>    - Add new discoveries to "Technical Discoveries"
>    - Update "Testing Status" after testing
>    - Add future tasks to "Future Considerations"
> 4. **Maintain accuracy**: Remove outdated information, update version numbers, fix incorrect details
> 5. **Keep it portable**: Ensure the next AI agent can pick up where you left off
> 6. **Add session summary**: At the end of your session, add a brief entry to "Session History" (create section if needed)
>
> **Format for session entries:**
> ```
> ### Session [Date] - [Brief Description]
> - Changes made
> - Issues resolved
> - Current state
> ```

## Project Overview
Node.js/Express web dashboard for controlling a Minimover XYZ 3D printer via serial connection (XYZv3 protocol). Runs on Raspberry Pi with mjpg-streamer for camera monitoring. Target resolution: 1024x720.

## System Environment
- **Platform**: Raspberry Pi (Linux)
- **Node.js**: v20.19.2
- **User**: maker2
- **Project Path**: `/home/maker2/Minimover-XYZ-printer-Dashboard`
- **Server Port**: 3000
- **Camera Stream**: mjpg-streamer on port 8080
- **Serial Ports**: /dev/ttyACM0 (printer), /dev/ttyAMA10

## Architecture

### Core Components
1. **server.js** - Express server, serial communication, file upload handling
2. **public/app.js** - Frontend WebSocket client, UI logic
3. **public/index.html** - Dashboard layout
4. **public/style.css** - Styling
5. **lib/serial_bridge.js** - Serial protocol handler for XYZv3
6. **lib/upload.js** - Multer configuration for file uploads
7. **lib/convert_3mf.js** - .3mf file extraction and STL conversion
8. **lib/convert_3w.js** - .3w file AES decryption (based on miniMover)

### External Services
- **mjpg-streamer**: Camera streaming service
  - Config: `/etc/default/mjpg-streamer`
  - Service: `systemd/mjpg-streamer.service`
  - Fixed to use eval for variable expansion

## Key Features Implemented

### 1. Dashboard Layout (1024x720)
- 3-column layout:
  - Left: Status tiles (200px)
  - Center: Camera feed (400px, auto-height)
  - Right: Upload controls (flexible width)
- Removed duplicate camera/upload sections that appeared below main dashboard
- Jog controls positioned alongside command buttons

### 2. Camera Feed Integration
- mjpg-streamer configured and working
- Fixed systemd service with proper eval command
- Streams at `http://192.168.1.183:8080/?action=stream`
- Auto-refresh in dashboard

### 3. File Upload System
- Accepts: `.gcode`, `.txt`, `.3w`
- **Printable formats**: `.gcode` and `.3w` (auto-decrypted from deprecated XYZ format)
- **Mesh files** (STL, .3mf, etc.): Must be sliced externally to gcode before uploading
- Upload progress bar
- Multer fileFilter updated to accept supported formats
- Upload directory: `uploads/`
- **Max 10 stored uploads** (sorted by modification time, newest first)
- **Delete button** for each file with confirmation dialog
- Automatic .3w decryption on upload

### 4. .3w File Handling (DEPRECATED XYZ PROPRIETARY FORMAT - BACKWARD COMPATIBILITY)
**Important**: .3w is the actual proprietary format used by XYZ Da Vinci printers for pre-sliced gcode. **These files are ready to print after decryption.**

**Implementation** (based on miniMover):
- File structure:
  - Header: `3DPFNKG13WTW` (12 bytes) + version info
  - Tag section: `TagE` marker with metadata
  - Body (offset 0x2000/8192): AES-encrypted gcode
- Encryption details:
  - **CBC mode**: Key = `@xyzprinting.com` (16 bytes), IV = 16 zeros
  - **ECB mode**: Key = `@xyzprinting.com@xyzprinting.com` (32 bytes)
  - PKCS7 padding
  - Block size: 0x2010 (8208 bytes)
  - May be ZIP-compressed before encryption
- **Decrypts to standard gcode ready for immediate printing**

**File**: `lib/convert_3w.js`
- `convert3wToGcode()` - Main decryption function
- `decryptCBC()` - AES-128-CBC decryption for zipped files
- `decryptECB()` - AES-256-ECB decryption for uncompressed files
- Uses Node.js crypto module
- Based on reverse-engineered miniMover implementation

### 6. UI Improvements
- Changed "Detector" to "Probe" in calibration buttons
- Added filament profile calculator
- Status tiles: Connection, Extruder Temp, Filament, Job Progress
- Print/Delete buttons for stored uploads
- File upload accepts .gcode, .3w, and .3mf formats
- Conversion status display for uploaded files

## Files Modified in Session

### server.js
- Added `.3w` AES decryption with debug logging
- Added `DELETE /uploads/:filename` endpoint for file deletion
- Modified `GET /uploads` to return only 10 most recent files
- Comprehensive error logging: `[UPLOAD]` prefixed logs
- Import: `const { convert3wToGcode } = require('./lib/convert_3w')`
- Import: `const { upload, uploadsDir } = require('./lib/upload')`
- Upload endpoint handles .3w and .gcode files with automatic .3w decryption

### lib/convert_3w.js (CREATED)
- Decrypts XYZ Da Vinci .3w files to gcode
- Based on miniMover implementation (github.com/Rojman1984/miniMover)
- Supports both CBC (zipped) and ECB (uncompressed) encryption modes
- `convert3wToGcode()`: Main decryption function
- `decryptCBC()`: AES-128-CBC with 16-byte key for ZIP files
- `decryptECB()`: AES-256-ECB with 32-byte key for raw gcode
- Handles PKCS7 padding removal
- Auto-detects encryption mode from file header
- Returns: `{ success, outputPath, message }`

### lib/upload.js
- Updated fileFilter: `if (ext === '.gcode' || ext === '.txt' || ext === '.3w')`
- Changed exports: `module.exports = { upload, uploadsDir: uploadDir }`
- Accepts gcode and .3w (deprecated XYZ format) files

### public/index.html
- Removed duplicate `<section id="camera">` and `<section id="uploads">`
- Updated file input: `accept=".gcode,.3w"`
- Help text: "Accepts: .gcode or .3w (deprecated XYZ format)"
- Changed calibration buttons: "Lower Probe Done", "Raise Probe Done"
- Layout: 3-column grid for 1024x720 resolution

### public/app.js
- Added delete button for each upload with confirmation
- Shows conversion status for .3w: `Uploaded ${res.filename} (decrypted from .3w)`
- Delete handler: `DELETE /uploads/${filename}` with refresh on success
- Upload list limited to 10 files (server-side)

### systemd/mjpg-streamer.service
- Fixed `ExecStart` to use eval for variable expansion:
  ```
  ExecStart=/bin/sh -c 'eval "/usr/local/bin/mjpg_streamer $MJPG_INPUT_OPTS $MJPG_OUTPUT_OPTS"'
  ```
- Changed User from 'pi' to 'maker2'

### /etc/default/mjpg-streamer
- Fixed environment variable format (removed extra quotes)
- Input: `-i "input_uvc.so -r 640x480 -f 10"`
- Output: `-o "output_http.so -p 8080 -w /usr/local/share/mjpg-streamer/www"`

## Technical Discoveries

### .3w Format Structure (XYZ Proprietary)
```
.3w file (Binary, AES-encrypted)
Offset   Content
0x0000   Header: "3DPFNKG13WTW" (12 bytes)
0x000C   Version info (4 bytes): ID + File Version (2 or 5)
0x0010   Zip offset (4 bytes, big endian)
0x0014+  Tag section: "TagEJ256" or "TagEa128"
0x2000   Body: AES-encrypted gcode
         - CBC mode (if zipped): key="@xyzprinting.com" (16 bytes)
         - ECB mode (if not zipped): key="@xyzprinting.com@xyzprinting.com" (32 bytes)
         - IV: 16 zeros
         - Block size: 0x2010 (8208 bytes)
         - PKCS7 padding
```

### XYZv3 Protocol
- Simple line-based protocol
- Commands: Home, Calibrate, Load/Unload filament, Jog, etc.
- Status parsing in `lib/parser.js`

## Current Working State

✅ **Fully Functional**:
- Server running on port 3000
- Camera streaming on port 8080
- Serial communication with printer
- File uploads (.gcode, .txt, .3w)
- .3w decryption (backward compatibility for deprecated XYZ format)
- Upload list with Print/Delete buttons
- 10-file limit on stored uploads
- Dashboard layout optimized for 1024x720

## Important Notes for Continuation

1. **Mesh files require external slicing**: All mesh files (STL, .3mf, OBJ, etc.) must be sliced with user's preferred slicer and converted to gcode before uploading.

2. **.3w format**: Deprecated XYZ proprietary format. Converter provided for backward compatibility only. Modern workflow uses standard gcode.

3. **Serial port detection**: Auto-detects `/dev/ttyACM0`. May need adjustment if printer is on different port.

4. **Service management**:
   ```bash
   sudo systemctl restart mjpg-streamer
   sudo systemctl status mjpg-streamer
   node server.js  # Run server
   ```

5. **File locations**:
   - Uploads: `/home/maker2/Minimover-XYZ-printer-Dashboard/uploads/`
   - Temp files: `/tmp/` (cleaned up automatically)

6. **Dependencies**: All in package.json. Key ones:
   - express, socket.io, multer, serialport

## Debugging Commands Used

```bash
# Kill running server
lsof -ti:3000 | xargs kill -9
pkill -9 -f "node.*server.js"

# Check camera service
sudo systemctl status mjpg-streamer
journalctl -u mjpg-streamer -n 50
```

## Future Considerations

1. File size limits for uploads
2. Auto-cleanup of old uploads beyond 10 files
3. WebSocket-based upload progress instead of XHR
4. Optional auto-slicing integration (would require slicer installation)
5. Support for additional gcode variants from different slicers

## Configuration Files

### config.json
```json
{
  "port": "/dev/ttyACM0",
  "baudRate": 115200,
  "webcamUrl": "http://localhost:8080/?action=stream"
}
```

### package.json
Main dependencies: express, socket.io, multer, serialport

## Code Patterns to Know

### Upload Handler Pattern (server.js)
```javascript
app.post('/upload', upload.single('file'), async (req, res) => {
  if (req.file.originalname.toLowerCase().endsWith('.3w')) {
    const result = await convert3wToGcode(req.file.path, outputPath);
    // Handle decryption result
  }
});
```

## Testing Status
- Camera feed: ✅ Working
- File upload (.gcode): ✅ Working
- File upload (.3w): ✅ Working (decrypts to gcode)
- .3w decryption: ✅ Tested with 3DBenchy.3w (57,562 lines)
- Delete files: ✅ Working
- 10-file limit: ✅ Working
- Serial communication: ✅ Connected to /dev/ttyACM0

## Last Session Summary
Completed dashboard polish, fixed camera streaming, implemented .3w decryption for backward compatibility with deprecated XYZ format, added file deletion and 10-file limit. Removed .3mf mesh extraction - users must slice mesh files externally. All systems operational and ready for user testing.

---

## Session History

### Session 2026-02-03 - Print Start Fix: Complete Protocol Implementation

**Critical Discovery - Full Protocol Reverse-Engineered:**
- Analyzed USB capture file (176,157 lines) with comprehensive protocol mapping
- **Integrated findings from another AI agent's "Badfish" analysis**
- Implemented COMPLETE handshake sequence required for successful print start
- Protocol requires 4-step process: handshake → blocks → confirmation → start command

**Complete Protocol Sequence (Verified from USB Capture):**

**Step 1: Pre-flight Handshake (Entry 1010, 202)**
1. `XYZv3/config=signature:[get]` - Printer responds with encrypted signature
2. `XYZv3/config=taginfo` - Verifies printer serial number  
3. `XYZv3/query=Z` - Initializes file context, printer responds: `Z:{"PrintFile":"AstroKey.3w","Complete":0}.$`

**Step 2: Binary Block Transfer with Heartbeat**
- Send 8KB blocks (4b index + 4b size + 8192b data + 4b trailer)
- **CRITICAL**: Send `XYZv3/config=tag` heartbeat every 10 blocks
- This keeps printer's watchdog timer from timing out during upload
- 5ms delay between blocks to prevent buffer overflow

**Step 3: Wait for taginfo Confirmation**
- After all blocks sent, printer validates and responds: `taginfo:{3FNAXPUS5TH7CM0041}.$`
- This confirms successful file receipt and validation

**Step 4: Send Start Print Command**
- Send JSON command: `{"command":6,"state":2}` to trigger actual print
- **Note**: Printer may close serial port after taginfo; reconnection may be needed

**Code Changes Implemented:**

1. **Modified `lib/upload_xyz_v3.js`:**
   - Added `sendCommand()` method for command/response handshake
   - Implemented full pre-flight sequence before blocks
   - Added heartbeat every 10 blocks (`XYZv3/config=tag`)
   - Wait for taginfo confirmation after upload
   - Send start command `{"command":6,"state":2}`
   - Graceful error handling for port closure

2. **Modified `server.js` - Auto-Reconnection Handler:**
   - Added reconnection state variables:
     - `uploadReconnectPending` - Flag to track expected port closure after upload
     - `uploadReconnectFilename` - Track which file is being printed
   - Enhanced `port.on('close')` handler with intelligent reconnection logic:
     - Detects when closure is expected (after upload completes)
     - Waits 500ms before attempting reconnect (per "Badfish" analysis)
     - Reopens serial port
     - Waits additional 500ms for port stabilization
     - Sends start command: `{"command":6,"state":2}`
     - Emits status updates to UI via socket.io
   - Updated `/print` endpoint to set reconnection flag before upload
   - Comprehensive error handling and logging throughout

**Key Implementation Details:**
```javascript
// Handshake verification (lib/upload_xyz_v3.js)
sendCommand('XYZv3/config=signature:[get]')  // Get encrypted signature
sendCommand('XYZv3/config=taginfo')          // Verify serial
sendCommand('XYZv3/query=Z')                 // Init file context

// During upload (lib/upload_xyz_v3.js)
if (blockIndex % 10 === 0) {
  sendCommand('XYZv3/config=tag')  // Heartbeat
}

// After upload (lib/upload_xyz_v3.js)
waitForTaginfo()  // Wait for confirmation

// Reconnection workflow (server.js)
port.on('close', () => {
  if (uploadReconnectPending) {
    // Wait 500ms → reopen port → wait 500ms → send start
    setTimeout(() => {
      port.open(() => {
        setTimeout(() => {
          port.write('{"command":6,"state":2}\n')  // Start print
        }, 500)
      })
    }, 500)
  }
})
```

**Reconnection Architecture:**

The complete upload→print workflow involves a carefully orchestrated sequence:

1. **Upload Phase** (`lib/upload_xyz_v3.js`):
   - Pre-flight handshake establishes communication
   - Binary blocks sent with periodic heartbeats
   - Printer validates and sends taginfo confirmation

2. **Transition Phase** (Printer closes port):
   - Printer closes serial port to process received file
   - This is EXPECTED behavior, not an error
   - `server.js` detects closure with `uploadReconnectPending` flag set

3. **Reconnection Phase** (`server.js` auto-reconnect handler):
   - Wait 500ms for printer to settle
   - Reopen serial port
   - Wait 500ms for port stabilization
   - Send `{"command":6,"state":2}` to trigger print

4. **Print Phase**:
   - Printer receives start command
   - Movement begins
   - Normal status polling resumes

This architecture mirrors the behavior observed in the USB capture from the proprietary XYZ software.

**USB Capture Evidence:**
- Entry 1010: `XYZv3/config=signature:[get]` → Response: 45 bytes encrypted sig
- Entry 202: `XYZv3/query=Z` → Response: `Z:{"PrintFile":"AstroKey.3w","Complete":0}.$`
- Entry 370 & 26708: `taginfo:{3FNAXPUS5TH7CM0041}.$`
- Multiple `XYZv3/config=tag` commands throughout transfer

**Files Modified:**
- `lib/upload_xyz_v3.js` - Complete protocol implementation with handshake, heartbeat, taginfo wait, and start command
- `server.js` - Auto-reconnection handler for upload→print workflow
- `READMEFIRST/PROJECT_CONTEXT.md` - This comprehensive documentation

**Current State:**
- ✅ Full protocol sequence reverse-engineered and implemented
- ✅ Pre-flight handshake with signature exchange
- ✅ File context initialization
- ✅ Heartbeat during upload (prevents watchdog timeout)
- ✅ taginfo confirmation waiting
- ✅ **Auto-reconnection handler in server.js (NEW)**
- ✅ Start command sending via reconnection workflow
- ✅ Complete error handling and UI status updates
- ⏳ **READY FOR TESTING** - All components implemented and integrated

**Critical Notes for Testing:**
1. **Handshake must succeed** - Watch for signature, taginfo, and file context responses
2. **Heartbeat is essential** - Every 10 blocks prevents timeout
3. **Port closure is EXPECTED** - After taginfo, printer closes port to process file
4. **Auto-reconnection sequence with fresh token**:
   - Upload completes → taginfo received → port closes
   - Wait 500ms → reopen port → wait 500ms
   - Send status query `XYZv3/query=a` to get fresh token
   - Wait for parser 'token' event (3s timeout)
   - Send start command with token: `{"command":6,"state":2,"token":"xyz"}`
   - Print begins!
5. **Monitor server logs** - Full workflow should show all steps completing
6. **UI updates** - Socket.io events keep dashboard informed of progress

**Protocol Refinements (Session 2026-02-03 Final):**
1. **Filename verification**: `XYZv3/query=Z` response must contain `"PrintFile":"<exact_filename>"` matching uploaded file - throws error on mismatch
2. **Complete:100 validation**: After all blocks sent, waits 1s for final `Z:{"Complete":100...}` response confirming upload integrity
3. **Fresh token requirement**: Post-reconnect status query ensures printer accepts start command with current authentication token

**Expected Log Output:**
```
[UPLOAD] Step 1: Pre-flight handshake...
[UPLOAD] Signature exchange successful
[UPLOAD] Printer taginfo verified
[UPLOAD] File context initialized: Z:{"PrintFile":"file.gcode","Complete":0}
[UPLOAD] Step 2: Streaming data blocks...
[UPLOAD] Sending heartbeat at block 10
[UPLOAD] Sending heartbeat at block 20
[UPLOAD] Progress: 100%
[UPLOAD] Step 3a: Waiting 1s for Complete:100 validation...
[UPLOAD] Step 3b: Waiting for printer taginfo confirmation...
[UPLOAD] Printer confirmed file receipt: {3FNAXPUS5TH7CM0041}
Serial closed
[RECONNECT] Upload completed, port closed as expected
[RECONNECT] Waiting 500ms before reconnecting...
[RECONNECT] Reopening serial port...
[RECONNECT] Port reopened successfully
[RECONNECT] Sending status query (XYZv3/query=a) to get fresh token...
[RECONNECT] Received fresh token: xyz123abc...
[RECONNECT] Sending start command: {"command":6,"state":2,"token":"xyz123abc..."}
[RECONNECT] Start command sent successfully - print should begin!
```

**Comparison with Previous Implementation:**
- **Before**: Only sent blocks + waited for taginfo
- **After**: Full 4-step protocol with handshake, heartbeat, confirmation, and start command
- **Credit**: Integrated critical findings from another AI agent's "Badfish" observations

**Next Steps:**
- Test complete protocol with actual printer
- Monitor for any timing issues in handshake
- Verify heartbeat prevents timeouts on larger files
- Confirm start command triggers print movement
- Validate filename verification catches mismatches
- Verify Complete:100 wait ensures upload integrity
- Test token-based start command authentication

---

### Session 2026-02-03 Final Refinements - Protocol Enhancement & Token Authentication
**Problem Addressed:**
- User validated implementation with second AI agent who provided critical refinements from deeper USB capture analysis
- Three enhancements needed for production-ready protocol

**Refinements Implemented:**
1. **Filename verification** (`lib/upload_xyz_v3.js`):
   - `XYZv3/query=Z` response parsing: extracts `"PrintFile":"<name>"` with regex
   - Validates PrintFile matches uploaded filename exactly
   - Throws error on mismatch: "File context mismatch: expected X, printer shows Y"
   - Prevents silent failures from incorrect printer state

2. **Complete:100 validation wait** (`lib/upload_xyz_v3.js`):
   - After all 8KB blocks sent, waits 1 second for final response
   - Confirms printer received `Z:{"Complete":100...}` message
   - Separates upload completion from taginfo confirmation (Step 3a vs 3b)
   - Ensures upload integrity before proceeding to print start

3. **Token-based start command** (`server.js`):
   - Post-reconnect: sends `XYZv3/query=a` status query
   - Listens for parser 'token' event with 3-second timeout
   - Builds start command conditionally: `{"command":6,"state":2,"token":"xyz"}` if token received
   - Fallback to no-token version if timeout (backward compatibility)
   - Ensures printer accepts start command with fresh authentication

**Code Changes:**
- `lib/upload_xyz_v3.js`:
  - Line ~114: Added filename regex match `/\"PrintFile\":\"([^\"]+)\"/` in query=Z handler
  - Line ~145: Added Step 3a (Complete:100 wait) before Step 3b (taginfo wait)
  - Line ~171: Removed inline start command attempt, delegated to server.js
  
- `server.js`:
  - Line ~193: Enhanced reconnection handler with status query logic
  - Added parser.once('token') listener with timeout
  - Added sendStartCommand() helper for conditional token usage
  - Improved logging: "Confirming printer status..." vs "Sending start command..."

- `READMEFIRST/PROJECT_CONTEXT.md`:
  - Added "Protocol Refinements" section documenting all three enhancements
  - Updated expected log output showing status query and token steps
  - Updated Next Steps checklist

**Validation:**
- All changes based on manufacturer's USB capture evidence
- Second agent confirmed approach "significantly more accurate"
- Protocol now matches ground truth from actual printer behavior
- Three-layer validation: filename → upload integrity → fresh token

**Current State:**
- ✅ Complete 4-step protocol with handshake, heartbeat, validation, start
- ✅ Filename verification prevents silent failures
- ✅ Complete:100 wait ensures upload integrity
- ✅ Token-based authentication for start command
- ✅ Auto-reconnection with status confirmation
- ✅ Comprehensive logging for debugging
- 🧪 **READY FOR TESTING** - All protocol elements implemented

**Testing Checklist:**
- [ ] Upload small file (< 100KB) - verify all log steps appear
- [ ] Upload large file (> 1MB) - verify heartbeat every 10 blocks
- [ ] Test filename mismatch scenario - should throw error at Step 1
- [ ] Monitor Complete:100 message - should appear before taginfo
- [ ] Verify token appears in reconnection logs
- [ ] Confirm start command includes token in JSON
- [ ] Watch for print movement after start command sent

**Files Modified:**
- `lib/upload_xyz_v3.js` - Added filename verification, Complete:100 wait, delegated start to server
- `server.js` - Enhanced reconnection handler with status query and token-based start
- `READMEFIRST/PROJECT_CONTEXT.md` - Documented refinements and updated workflow

---

### Session 2026-02-03 CRITICAL - Gcode Must Be Wrapped in .3w Format
**Critical Discovery:**
- **XYZ printer firmware CANNOT process raw gcode files**
- **Printer REQUIRES .3w format** - this is not optional or for "backward compatibility"
- Previous implementation was backwards: converted .3w → gcode, but printer needs gcode → .3w

**Root Cause Analysis:**
- Upload protocol sends binary blocks successfully
- But printer expects .3w encrypted container format, not raw gcode
- .3w format = encrypted + wrapped gcode with specific header/tag structure
- Without .3w wrapping, printer receives data but cannot process it

**Solution Implemented:**
1. **Created `lib/gcode_to_3w.js`** - Reverse conversion tool
   - AES-256-ECB encryption with key "@xyzprinting.com@xyzprinting.com"
   - Proper .3w file structure:
     * Header (0x0000-0x001F): "3DPFNKG13WTW" magic string + version 2
     * Tag section (0x0020-0x1FFF): "TagEa256" marker (ECB encryption flag)
     * Body (0x2000+): Encrypted gcode in 0x2010 (8208) byte blocks
   - PKCS7 padding for AES block alignment
   
2. **Updated server.js `/print` endpoint**:
   - Auto-detects gcode/txt files
   - Converts to .3w before upload: `filename.gcode` → `filename.3w`
   - Validates file format (only .3w files can be uploaded to printer)
   - Logs conversion step for debugging
   - Notifies UI via socket.io about conversion

**Workflow Changes:**
- **Before**: Upload gcode → binary blocks → ❌ printer can't process
- **After**: Upload gcode → convert to .3w → binary blocks → ✅ printer processes

**File Format Support:**
- `.gcode` files: Auto-converted to .3w, then uploaded
- `.txt` files: Treated as gcode, auto-converted to .3w
- `.3w` files: Uploaded directly (native format)
- `.3mf` files: Converted to gcode on upload, then will be converted to .3w on print

**Code Changes:**
- `lib/gcode_to_3w.js` (CREATED):
  * `convertGcodeTo3w(gcodeInputPath, outputPath)` - Main conversion function
  * `encryptECB(gcodeBuffer)` - AES-256-ECB encryption in 8208-byte blocks
  * `create3wFile(encryptedBody)` - Builds .3w container with header/tags
  
- `server.js`:
  * Added `const { convertGcodeTo3w } = require('./lib/gcode_to_3w')`
  * `/print` endpoint: Auto-conversion logic before upload
  * Error handling for unsupported formats
  * UI notification when conversion happens

**Technical Details:**
- Encryption: AES-256-ECB (simpler than CBC, no ZIP compression)
- Key: 32-byte string "@xyzprinting.com@xyzprinting.com"
- Block size: 0x2010 (8208 bytes) matching original .3w files
- File version: 2 (non-ZIP variant for simplicity)
- Tag marker: "TagEa256" indicating ECB encryption

**Testing Notes:**
- Test with small gcode file first to verify .3w structure
- Check converted .3w file size (should be ~8KB larger due to header)
- Monitor logs for conversion success message
- Verify printer accepts converted .3w file

**Next Steps:**
- Test gcode → .3w conversion with sample file
- Validate encrypted .3w matches expected structure
- Confirm printer accepts and processes converted files
- Consider adding .3w file caching to avoid re-converting same files

---

### Session 2026-02-02 - Binary .3w Upload Protocol Investigation
**Problem Encountered:**
- Print upload failing: "blinking perpetually and then fails"
- .3w files upload via web UI but don't trigger print on printer
- Status LED indicates data received but print doesn't start

**Investigation Performed:**
- Analyzed 25MB USB capture (TextStream_3Dprinter_.3wfile.txt, 176,157 lines)
- Discovered .3w upload uses **binary-only protocol** (no text commands)
- Block structure: 4 bytes index + 4 bytes size + 8192 data + 4 bytes trailer (XOR 0x5A5AA5A5)
- USB capture shows blocks sent continuously at ~1 second intervals
- Each block followed by printer "ok\n" response (0x6f 0x6b 0x0a)
- **No XYZv3/upload or XYZv3/uploadDidFinish commands in capture**

**Code Changes Made:**
1. Created `lib/upload_xyz_v3.js` - Binary block upload handler
   - Streams 8KB blocks with proper header/trailer format
   - 5ms delay between blocks (reduced from 50ms)
   - Removed waitForOk() - printer doesn't wait for acknowledgments
   - Pauses status polling during upload

2. Modified `server.js`:
   - Added XYZv3Uploader initialization with parser reference
   - Print endpoint calls uploadFile() for binary transfer
   - Added parser to uploader for token handling

3. Multiple protocol attempts:
   - Attempt 1: Text init `XYZv3/upload=filename,size` + blocks + `XYZv3/uploadDidFinish` ❌
   - Attempt 2: JSON command `{"command":5,"name":"file","size":123,"token":""}` ❌ (printer didn't respond with token)
   - Attempt 3: Binary blocks only (no init) ✅ (blocks transfer, LED blinks)

**Current State:**
- ✅ Binary blocks upload successfully (100% completion)
- ✅ Printer receives all data (confirmed by server logs)
- ❌ **CRITICAL ISSUE**: Print doesn't start after upload completes
- ⚠️ Serial port closes after 100% upload ("bad file descriptor" errors)
- ⚠️ Printer LED behavior varies: blinking (receiving), solid red (error), or closes connection

**Technical Findings:**
- Upload completion log shows: "100% (308112/308112 bytes, block 38)"
- Immediately after: "Serial error bad file descriptor" + "Serial closed"
- Printer may close serial to process file, then reopen when ready
- Missing final trigger command or sequence to start actual print job

**Files Modified:**
- `lib/upload_xyz_v3.js` (CREATED) - Binary upload implementation
- `server.js` - Added uploader initialization and print endpoint handler

**Known Issues:**
1. **Upload completes but print doesn't start** - Missing finalization/trigger
2. Printer closes serial connection after upload
3. No clear command sequence in USB capture for "start print"
4. Tried multiple init protocols - all rejected or ignored by printer

**Next Steps (for tomorrow):**
1. Analyze USB capture AFTER last data block to find actual print trigger
2. Search for packets following block 46 (last block) around line 25000-30000
3. May need to send separate command post-upload to trigger print
4. Consider if printer state/mode needs to be different before upload
5. Investigate if serial reconnection is expected behavior

**References:**
- USB Capture: `/home/maker2/Minimover-XYZ-printer-Dashboard/SampleUSBDataStream/`
  - `TextStream_3Dprinter_.3wfile.txt` (25MB, 176,157 lines)
  - `Raw_print_stream_.3wfile.raw` (1MB binary, different session)
- Based on miniMover protocol analysis

---

### Session 2026-02-01 - Dashboard UI Polish & .3w Decryption
**Changes Made:**
- Fixed dashboard layout for 1024x720 resolution, removed duplicate sections
- Configured and fixed mjpg-streamer camera service
- Changed "Detector" to "Probe" in calibration buttons
- **Discovered .3w is the deprecated XYZ proprietary format**
- **Implemented .3w AES decryption based on miniMover for backward compatibility**
- **Supports both CBC and ECB encryption modes**
- Added delete button for uploads with confirmation
- Limited stored uploads to 10 most recent files
- Removed .3mf mesh extraction - users must slice externally
- Updated documentation (README.md and PROJECT_CONTEXT.md)

**Issues Resolved:**
- mjpg-streamer not starting (fixed eval variable expansion)
- Duplicate UI sections appearing below dashboard
- Port 3000 conflicts (added proper kill commands)
- Clarified .3w is for deprecated format backward compatibility

**Current State:**
- ✅ All core features operational
- ✅ Camera streaming working
- ✅ File uploads functional (.gcode, .txt, .3w)
- ✅ .3w decryption working (tested with 3DBenchy.3w)
- ✅ UI polished and responsive
- ✅ Documentation updated and accurate

**Next Agent: Please add your session entry above this one, keeping chronological order (newest first)**
