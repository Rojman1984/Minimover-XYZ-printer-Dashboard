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
   * Send upload init command
   */
  async sendInitCommand(command) {
    console.log(`[UPLOAD] >> ${command}`);
    return new Promise((resolve, reject) => {
      this.port.write(command + '\n', (err) => {
        if (err) reject(err);
        else {
          // Small delay after init to let printer prepare
          setTimeout(resolve, 200);
        }
      });
    });
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
      
      // Step 1: Just start streaming - no init command needed
      console.log('[UPLOAD] Streaming data blocks...');
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
          
          // Send frame and continue immediately
          this.port.write(frame);
          
          // Minimal delay to avoid buffer overflow
          await new Promise(resolve => setTimeout(resolve, 5));
          
          bytesSent += bytesRead;
          blockIndex++;
          
          // Report progress
          const progress = Math.floor((bytesSent / fileSize) * 100);
          console.log(`[UPLOAD] Progress: ${progress}% (${bytesSent}/${fileSize} bytes, block ${blockIndex})`);
          this.io.emit('upload_progress', { percent: progress });
          
          if (progress % 10 === 0) {
            this.io.emit('log', { msg: `Upload progress: ${progress}%` });
          }
        }
        
        console.log(`[UPLOAD] Sent ${blockIndex} blocks`);
        
      } finally {
        fs.closeSync(fileHandle);
      }
      
      // Step 3: Upload complete
      console.log('[UPLOAD] Step 3: Upload complete, printer should start...');
      this.io.emit('log', { msg: 'Upload complete! Waiting for print to start...' });
      
      // Give printer time to process and start
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log('[UPLOAD] Upload complete!');
      console.log('[UPLOAD DEBUG] ========== UPLOAD SUCCESSFUL ==========');
      this.io.emit('log', { msg: 'Upload complete! File ready to print.' });
      this.io.emit('upload_finished', { filename });
      
      return { success: true };
      
    } catch (error) {
      console.error('[UPLOAD] Upload failed:', error.message);
      console.error('[UPLOAD DEBUG] Error stack:', error.stack);
      this.io.emit('log', { msg: `Upload failed: ${error.message}` });
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
