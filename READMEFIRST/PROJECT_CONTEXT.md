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
