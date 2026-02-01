// lib/serial_bridge.js
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const EventEmitter = require('events');

class SerialBridge extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.port = null;
        this.reconnectTimeout = 1000;
    }

    connect() {
        this.port = new SerialPort({
            path: this.config.serialPath,
            baudRate: this.config.baudRate || 115200,
            autoOpen: false
        });

        const parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));
        parser.on('data', (line) => this.emit('line', line.trim()));

        this.port.on('open', () => {
            console.log(`[Serial] Connected to ${this.config.serialPath}`);
            this.reconnectTimeout = 1000;
            this.emit('status', { connected: true });
        });

        this.port.on('close', () => {
            this.emit('status', { connected: false });
            this.attemptReconnect();
        });

        this.port.on('error', (err) => {
            this.emit('log', `Serial Error: ${err.message}`);
            if (!this.port.isOpen) this.attemptReconnect();
        });

        this.port.open((err) => { if (err) this.attemptReconnect(); });
    }

    attemptReconnect() {
        setTimeout(() => {
            console.log(`[Serial] Reconnecting to ${this.config.serialPath}...`);
            this.connect();
            this.reconnectTimeout = Math.min(this.reconnectTimeout * 2, 30000);
        }, this.reconnectTimeout);
    }

    sendRaw(msg) {
        if (this.port?.isOpen) {
            const s = msg.endsWith('\n') ? msg : msg + '\r\n';
            this.port.write(s);
            return true;
        }
        return false;
    }

    writeBuffer(buf, callback) {
        if (this.port?.isOpen) return this.port.write(buf, callback);
        return false;
    }
}

module.exports = SerialBridge;