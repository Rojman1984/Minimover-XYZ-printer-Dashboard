/**
 * XYZ V3 Protocol File Upload
 * Uses existing serial port connection to upload files
 */

const fs = require('fs');
const zlib = require('zlib');
const BLOCK_SIZE = 8192; // 8KB blocks

class XYZv3Uploader {
  constructor(port, io, pollControl, parser) {
    this.port = port;
    this.io = io;
    this.pollControl = pollControl || {};
    this.parser = parser;
    this.uploading = false;
    this.rawDataBuffer = '';
  }

  /**
   * Pause polling during upload
   */
  pausePolling() {
    console.log('[UPLOAD DEBUG] Pausing polling');
    if (this.pollControl.pausePoll) {
      this.pollControl.pausePoll();
    }
  }

  /**
   * Resume polling after upload
   */
  resumePolling() {
    console.log('[UPLOAD DEBUG] Resuming polling');
    if (this.pollControl.resumePoll) {
      this.pollControl.resumePoll();
    }
  }

  /**
   * Wait for token response from printer
   */
  async waitForToken(timeoutMs) {
    if (!this.parser) {
      console.warn('[UPLOAD] No parser available, cannot wait for token');
      return null;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.parser.removeListener('token', onToken);
        console.log('[UPLOAD] Token wait timeout');
        resolve(null);
      }, timeoutMs);

      const onToken = (token) => {
        clearTimeout(timeout);
        this.parser.removeListener('token', onToken);
        resolve(token);
      };

      this.parser.once('token', onToken);
    });
  }

  /**
   * Wait for taginfo response from printer (indicates file received successfully)
   * Expected format: "taginfo:{SERIAL}.$\n"
   */
  async waitForTaginfo(timeoutMs = 10000) {
    console.log('[UPLOAD] Waiting for taginfo response...');
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        dataHandler && this.port.removeListener('data', dataHandler);
        console.log('[UPLOAD] Taginfo wait timeout');
        resolve(null);
      }, timeoutMs);

      let buffer = '';
      const dataHandler = (data) => {
        buffer += data.toString();
        console.log('[UPLOAD DEBUG] Received data:', buffer);
        
        // Check if we got taginfo response
        if (buffer.includes('taginfo:')) {
          clearTimeout(timeout);
          this.port.removeListener('data', dataHandler);
          
          // Extract taginfo line
          const match = buffer.match(/taginfo:(\{[^}]+\})\.\$/);
          if (match) {
            const taginfo = match[1];
            console.log('[UPLOAD] Got taginfo:', taginfo);
            resolve(taginfo);
          } else {
            resolve('received');
          }
        }
      };

      this.port.on('data', dataHandler);
    });
  }

  /**
   * Send heartbeat to keep printer buffer watchdog alive during upload
   */
  async sendHeartbeat() {
    try {
      console.log('[UPLOAD] Sending heartbeat...');
      this.port.write('XYZv3/config=tag\n');
      // Don't wait for response - just keep the watchdog happy
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.warn('[UPLOAD] Heartbeat failed:', error.message);
    }
  }

  /**
   * Wait for "ok" response from printer (like miniMover's waitForConfigOK)
   * Waits up to 5 seconds for "ok" response
   */
  async waitForOK(timeoutMs = 5000) {
    return new Promise((resolve) => {
      let buffer = '';
      const timeout = setTimeout(() => {
        if (dataHandler) {
          this.port.removeListener('data', dataHandler);
        }
        console.log('[UPLOAD] OK wait timeout, buffer was:', buffer);
        resolve(false);
      }, timeoutMs);

      const dataHandler = (data) => {
        buffer += data.toString();
        
        // Success when we see "ok" (with or without newline)
        if (buffer.toLowerCase().includes('ok')) {
          clearTimeout(timeout);
          this.port.removeListener('data', dataHandler);
          console.log('[UPLOAD DEBUG] Got OK response');
          resolve(true);
        }
        // Also accept $ as end marker
        else if (buffer.includes('$')) {
          clearTimeout(timeout);
          this.port.removeListener('data', dataHandler);
          console.log('[UPLOAD DEBUG] Got $ end marker');
          resolve(true);
        }
        // Break on error strings
        else if (buffer.toLowerCase().includes('error') || buffer.toLowerCase().includes('wait')) {
          clearTimeout(timeout);
          this.port.removeListener('data', dataHandler);
          console.log('[UPLOAD DEBUG] Got error response:', buffer);
          resolve(false);
        }
      };

      this.port.on('data', dataHandler);
    });
  }

  /**
   * Send command and wait for response
   */
  async sendCommand(command, timeoutMs = 5000) {
    console.log(`[UPLOAD] >> ${command}`);
    
    return new Promise((resolve, reject) => {
      let buffer = '';
      const timeout = setTimeout(() => {
        dataHandler && this.port.removeListener('data', dataHandler);
        console.log(`[UPLOAD] Command timeout: ${command}`);
        resolve(null);
      }, timeoutMs);

      const dataHandler = (data) => {
        buffer += data.toString();
        console.log(`[UPLOAD DEBUG] << ${buffer.trim()}`);
        
        // Check if we got complete response (ends with $.)
        if (buffer.includes('$\n') || buffer.includes('.$')) {
          clearTimeout(timeout);
          this.port.removeListener('data', dataHandler);
          resolve(buffer.trim());
        }
      };

      this.port.on('data', dataHandler);
      
      this.port.write(command + '\n', (err) => {
        if (err) {
          clearTimeout(timeout);
          this.port.removeListener('data', dataHandler);
          reject(err);
        }
      });
    });
  }

  /**
   * Send upload init command (legacy - kept for compatibility)
   */
  async sendInitCommand(command) {
    return this.sendCommand(command, 200);
  }

  /**
   * Upload file using XYZ V3 protocol
   */
  async uploadFile(filePath, filename) {
    if (this.uploading) {
      throw new Error('Upload already in progress');
    }

    console.log('[UPLOAD DEBUG] ========== STARTING UPLOAD ==========');
    this.uploading = true;
    this.pausePolling(); // Stop polling during upload
    
    try {
      // Get file size
      const stats = fs.statSync(filePath);
      const fileSize = stats.size;
      
      console.log(`[UPLOAD] Starting upload: ${filename} (${fileSize} bytes)`);
      console.log(`[UPLOAD DEBUG] File path: ${filePath}`);
      this.io.emit('log', { msg: `Uploading ${filename} (${fileSize} bytes)` });
      
      // Step 1: Pre-flight handshake sequence (critical for printer acceptance)
      console.log('[UPLOAD] Step 1: Pre-flight handshake...');
      this.io.emit('log', { msg: 'Initializing printer handshake...' });
      
      // 1a. Request signature from printer
      const signature = await this.sendCommand('XYZv3/config=signature:[get]');
      if (signature && signature.includes('signature:')) {
        console.log('[UPLOAD] Signature exchange successful');
      } else {
        console.warn('[UPLOAD] Warning: No signature response (may fail)');
      }
      
      // 1b. Verify printer tag/serial (taginfo)
      const tagResponse = await this.sendCommand('XYZv3/config=taginfo');
      if (tagResponse && tagResponse.includes('taginfo:')) {
        console.log('[UPLOAD] Printer taginfo verified:', tagResponse);
      } else {
        console.warn('[UPLOAD] Warning: No taginfo verification');
      }
      
      // 1c. Initialize file context - Tell printer which file we're sending
      // Query current print file context (for logging only - official software doesn't validate this)
      const fileContext = await this.sendCommand('XYZv3/query=Z');
      if (fileContext && fileContext.includes('PrintFile')) {
        console.log('[UPLOAD] File context query response:', fileContext);
        
        // Log the current PrintFile (might be from previous print)
        const printFileMatch = fileContext.match(/"PrintFile":"([^"]+)"/);
        if (printFileMatch) {
          console.log('[UPLOAD] Printer shows PrintFile:', printFileMatch[1], '(will be replaced)');
        }
        this.io.emit('log', { msg: 'Printer ready to receive file' });
      } else {
        console.log('[UPLOAD] No file context response - proceeding anyway');
      }
      
      // Small delay after handshake
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 1d. CRITICAL: Send upload init command to put printer in RECEIVING MODE
      // This makes the LED blink green and prepares printer for binary blocks
      console.log('[UPLOAD] Step 1d: Sending upload init command...');
      this.port.write(`XYZv3/upload=${filename},${fileSize}\n`);
      
      // Wait for "ok" response (critical - like miniMover's waitForConfigOK)
      const uploadOK = await this.waitForOK(5000);
      if (!uploadOK) {
        throw new Error('Printer did not respond OK to upload init');
      }
      console.log('[UPLOAD] Upload init confirmed');
      this.io.emit('log', { msg: 'Printer ready - starting transfer...' });
      
      // Give printer time to enter receiving mode (LED should start blinking green)
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Step 2: Stream binary blocks
      // Based on miniMover xyzv3.cpp implementation
      // Each block: [Index(4b BE)][Size(4b BE)][Data(8KB)][Trailer(4b)]
      console.log('[UPLOAD] Step 2: Streaming data blocks...');
      console.log(`[UPLOAD DEBUG] Will send ${Math.ceil(fileSize / BLOCK_SIZE)} blocks`);
      this.io.emit('log', { msg: 'Transferring file data...' });
      
      const fileHandle = fs.openSync(filePath, 'r');
      let blockIndex = 0;
      let bytesSent = 0;
      
      try {
        while (bytesSent < fileSize) {
          const buffer = Buffer.alloc(BLOCK_SIZE);
          const bytesRead = fs.readSync(fileHandle, buffer, 0, BLOCK_SIZE, bytesSent);
          
          if (bytesRead === 0) break;
          
          const data = buffer.slice(0, bytesRead);
          
          // Calculate CRC32 checksum of the data block
          const crc32 = zlib.crc32(data) >>> 0;  // Ensure unsigned 32-bit
          
          // Build frame: [Index(4b BE)][Size(4b BE)][Data][CRC32(4b BE)]
          const frame = Buffer.alloc(4 + 4 + bytesRead + 4);
          frame.writeUInt32BE(blockIndex, 0);      // Block index (BIG ENDIAN)
          frame.writeUInt32BE(bytesRead, 4);       // Block size (BIG ENDIAN)
          data.copy(frame, 8);                     // Block data
          frame.writeUInt32BE(crc32, 8 + bytesRead);  // CRC32 checksum (BIG ENDIAN)
          
          // Send frame
          this.port.write(frame);
          
          // CRITICAL: Wait for "ok" after each block (like miniMover does)
          const blockOK = await this.waitForOK(5000);
          if (!blockOK) {
            throw new Error(`Block ${blockIndex} failed - no OK response from printer`);
          }
          
          bytesSent += bytesRead;
          blockIndex++;
          
          // Report progress
          const progress = Math.floor((bytesSent / fileSize) * 100);
          if (bytesSent === fileSize || progress % 10 === 0) {
            console.log(`[UPLOAD] Progress: ${progress}% (${bytesSent}/${fileSize} bytes, block ${blockIndex})`);
            this.io.emit('upload_progress', { percent: progress });
            
            if (progress % 10 === 0) {
              this.io.emit('log', { msg: `Upload progress: ${progress}%` });
            }
          }
        }
        
        console.log(`[UPLOAD] Sent ${blockIndex} blocks`);
        
      } finally {
        fs.closeSync(fileHandle);
      }
      
      // Send uploadDidFinish command (required for V3 protocol per miniMover source)
      console.log('[UPLOAD] Sending uploadDidFinish command...');
      this.port.write('XYZv3/uploadDidFinish\n');
      
      const finishOK = await this.waitForOK(5000);
      if (!finishOK) {
        console.log('[UPLOAD] Warning: No OK response to uploadDidFinish (printer may still work)');
      } else {
        console.log('[UPLOAD] uploadDidFinish confirmed');
      }
      
      console.log('[UPLOAD] Upload complete - printer will validate and auto-start');
      this.io.emit('log', { msg: 'File uploaded! Printer validating... will auto-start in ~1 minute' });
      
      // Give printer a moment to begin validation
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log('[UPLOAD] Upload complete!');
      console.log('[UPLOAD DEBUG] ========== UPLOAD SUCCESSFUL ==========');
      this.io.emit('upload_finished', { filename });
      
      return { success: true };
    
    } catch (error) {
      console.error('[UPLOAD] Upload failed:', error);
      this.io.emit('upload_error', { error: error.message });
      throw error;
    } finally {
      this.uploading = false;
      console.log('[UPLOAD DEBUG] Upload flag cleared');
      this.resumePolling(); // Resume status polling
    }
  }
}

module.exports = XYZv3Uploader;
