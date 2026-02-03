/**
 * XYZ V3 Protocol File Upload
 * Uses existing serial port connection to upload files
 */

const fs = require('fs');
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
      // CRITICAL: Verify PrintFile name matches exactly before proceeding
      const fileContext = await this.sendCommand('XYZv3/query=Z');
      if (fileContext && fileContext.includes('PrintFile')) {
        console.log('[UPLOAD] File context initialized:', fileContext);
        
        // Extract and verify PrintFile name matches our filename
        const printFileMatch = fileContext.match(/"PrintFile":"([^"]+)"/);
        if (printFileMatch && printFileMatch[1] === filename) {
          console.log('[UPLOAD] ✓ PrintFile name verified:', printFileMatch[1]);
          this.io.emit('log', { msg: 'Printer ready to receive file' });
        } else {
          const actualFile = printFileMatch ? printFileMatch[1] : 'unknown';
          console.error(`[UPLOAD] ✗ PrintFile mismatch! Expected: ${filename}, Got: ${actualFile}`);
          throw new Error(`Printer expects different file: ${actualFile}`);
        }
      } else {
        console.warn('[UPLOAD] Warning: File context not confirmed');
        throw new Error('Failed to initialize file context on printer');
      }
      
      // Small delay after handshake
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Step 2: Stream binary blocks with heartbeat
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
          
          // Build frame: [Index(4b)][Size(4b)][Data][Trailer(4b)]
          const trailer = blockIndex ^ 0x5A5AA5A5;
          
          const frame = Buffer.alloc(4 + 4 + bytesRead + 4);
          frame.writeUInt32LE(blockIndex, 0);
          frame.writeUInt32LE(bytesRead, 4);
          data.copy(frame, 8);
          frame.writeUInt32LE(trailer, 8 + bytesRead);
          
          // Send frame
          this.port.write(frame);
          
          // Heartbeat every 10 blocks to keep printer's watchdog alive
          if (blockIndex > 0 && blockIndex % 10 === 0) {
            console.log(`[UPLOAD] Sending heartbeat at block ${blockIndex}`);
            await this.sendCommand('XYZv3/config=tag');
          }
          
          // Minimal delay to avoid buffer overflow
          await new Promise(resolve => setTimeout(resolve, 5));
          
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
      
    // Step 3a: Wait for printer to validate file (Complete:100 or similar)
    console.log('[UPLOAD] Step 3a: Waiting for printer file validation...');
    this.io.emit('log', { msg: 'File sent! Waiting for printer validation...' });
    
    // Give printer time to perform IOCTL operations and validate checksum
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Step 3b: Wait for printer to acknowledge with taginfo
    console.log('[UPLOAD] Step 3b: Waiting for printer taginfo confirmation...');
    this.io.emit('log', { msg: 'Waiting for printer confirmation...' });
      this.io.emit('log', { msg: 'Printer confirmed! Starting print...' });
    } else {
      console.log('[UPLOAD] Warning: No taginfo response, print may not start');
      this.io.emit('log', { msg: 'Upload sent (no confirmation from printer)' });
      
      // Return with warning but don't fail
      return { success: true, warning: 'No taginfo confirmation' };
    }
    
    // Step 4: Upload complete - Printer will close port to switch modes
    // Port closure triggers reconnection handler in server.js which will:
    // 1. Reopen port
    // 2. Wait for XYZv3/query=a response (OS re-bound confirmation)
    // 3. Extract token from status
    // 4. Send {"command":6,"state":2,"token":"..."} with fresh token
    console.log('[UPLOAD] Step 4: Upload complete, expecting port closure...');
    this.io.emit('log', { msg: 'Upload complete! Port will close for mode switch...' });
    
    // Printer performs hardware reset to switch from Transfer Mode to Execution Mode
    // The reconnection handler in server.js will take over from here
    console.log('[UPLOAD] Waiting for printer to close port and switch to execution mode...');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Give printer a moment to start
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('[UPLOAD] Upload complete!');
    console.log('[UPLOAD DEBUG] ========== UPLOAD SUCCESSFUL ==========');
    this.io.emit('log', { msg: 'Upload complete! Print should now be starting...' });
    this.io.emit('upload_finished', { filename });
    
    return { success: true, taginfo };
      throw error;
    } finally {
      this.uploading = false;
      console.log('[UPLOAD DEBUG] Upload flag cleared');
      this.resumePolling(); // Resume status polling
    }
  }
}

module.exports = XYZv3Uploader;
