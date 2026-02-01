// lib/upload_v3.js
const fs = require('fs');
const EventEmitter = require('events');

class UploadV3 extends EventEmitter {
    constructor(serialBridge) {
        super();
        this.serial = serialBridge;
    }

    async start(filePath, fileName) {
        const stats = fs.statSync(filePath);
        const totalSize = stats.size;
        const blockSize = 8192; // Standard V3 block size

        // 1. Send V3 Init
        this.serial.sendRaw(`XYZv3/upload=${fileName},${totalSize}`);

        // 2. Process File in Chunks
        const buffer = fs.readFileSync(filePath);
        const totalBlocks = Math.ceil(totalSize / blockSize);

        for (let i = 0; i < totalBlocks; i++) {
            const start = i * blockSize;
            const end = Math.min(start + blockSize, totalSize);
            const dataChunk = buffer.slice(start, end);
            const currentBlockSize = end - start;

            // Frame: [Index (4b)] [Size (4b)] [Data] [Trailer (4b)]
            const frame = Buffer.alloc(8 + currentBlockSize + 4);
            frame.writeInt32BE(i, 0);
            frame.writeInt32BE(currentBlockSize, 4);
            dataChunk.copy(frame, 8);
            frame.writeInt32BE(0, 8 + currentBlockSize);

            await this.sendFrameAndWait(frame);
            this.emit('progress', { percent: Math.round(((i + 1) / totalBlocks) * 100) });
        }

        // 3. Finalize
        this.serial.sendRaw("XYZv3/uploadDidFinish");
        this.emit('complete');
    }

    sendFrameAndWait(frame) {
        return new Promise((resolve) => {
            this.serial.writeBuffer(frame, () => {
                // V3 protocol typically waits for "ok" between blocks
                setTimeout(resolve, 100);
            });
        });
    }
}

module.exports = UploadV3;