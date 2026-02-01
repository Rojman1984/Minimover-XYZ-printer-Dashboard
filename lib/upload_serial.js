const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

/**
 * Handles the logic of streaming a GCODE file over serial in small chunks,
 * waiting for 'ok' or status tokens as needed by the XYZ protocol.
 * The XYZ protocol (V3) uses JSON commands for file printing:
 * {"command":5,"name":"filename.gcode","size":1234,"token":""}
 * followed by the binary/text data.
 */

function startUpload(filePath, port, parser) {
  const ee = new EventEmitter();
  const fileName = path.basename(filePath);
  const stats = fs.statSync(filePath);
  const totalSize = stats.size;

  // 1. Send print command to printer
  // The printer should respond with a token for the new print job
  const initCmd = JSON.stringify({
    command: 5,
    name: fileName,
    size: totalSize,
    token: ""
  });

  let currentToken = "";
  let bytesSent = 0;
  let fileHandle = null;

  const onToken = (token) => {
    currentToken = token;
    // Once we have a token, we can start streaming data
    // In reality, XYZ printers might need data sent in specific block sizes (e.g. 512 or 1024)
    // and wait for an ACK or next token for more.
    if (!fileHandle) {
      startStreaming();
    }
  };

  parser.on('token', onToken);

  function startStreaming() {
    fileHandle = fs.createReadStream(filePath, { highWaterMark: 1024 });
    ee.emit('started', { fileName, total: totalSize });

    fileHandle.on('data', (chunk) => {
      // Pause reading until we've written this chunk to the serial port
      fileHandle.pause();

      port.write(chunk, (err) => {
        if (err) {
          ee.emit('error', err);
          fileHandle.destroy();
          return;
        }
        bytesSent += chunk.length;
        ee.emit('progress', {
          sent: bytesSent,
          total: totalSize,
          percent: Math.round((bytesSent / totalSize) * 100)
        });

        // Resume reading the next chunk
        // Note: some protocols need to wait for 'ok' here. 
        // VERIFY: Does XYZ printer need an 'ok' or new token between chunks?
        // If XYZ needs 'ok', we'd wait for a parser event before resuming.
        // For now, we assume serial flow control or buffering is enough,
        // or that the printer consumes it as it comes.
        fileHandle.resume();
      });
    });

    fileHandle.on('end', () => {
      ee.emit('finished', { token: currentToken });
      parser.removeListener('token', onToken);
    });

    fileHandle.on('error', (err) => {
      ee.emit('error', err);
      parser.removeListener('token', onToken);
    });
  }

  // Kick off by sending the initial command
  port.write(initCmd + '\r\n');

  return ee;
}

module.exports = { startUpload };
