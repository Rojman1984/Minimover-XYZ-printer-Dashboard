const SerialPort = require('serialport');
const Readline = require('@serialport/parser-readline');
const EventEmitter = require('events');

class SerialBridge extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.port = null;
        this.parser = null;
        this.connect();
    }

    connect() {
        const { serialPath, baudRate } = this.config;
        this.port = new SerialPort({ path: serialPath, baudRate, autoOpen: false });
        this.parser = this.port.pipe(new Readline({ delimiter: '\n' }));

        this.port.on('open', () => {
            console.log('Serial opened', serialPath);
            this.emit('open');
        });

        this.port.on('error', (e) => {
            console.error('Serial error', e.message);
            this.emit('error', e);
        });

        this.port.on('close', () => {
            console.warn('Serial closed');
            this.emit('close');
            // Attempt to reconnect after a delay
            setTimeout(() => this.connect(), 5000);
        });

        this.parser.on('data', (line) => {
            this.emit('data', line);
        });

        this.port.open((err) => {
            if (err) {
                console.error('Failed to open serial port', err.message);
                // Attempt to reconnect after a delay
                setTimeout(() => this.connect(), 5000);
            }
        });
    }

    write(data, callback) {
        if (this.port && this.port.isOpen) {
            const s = data.endsWith('\r\n') || data.endsWith('\n') ? data : data + '\r\n';
            this.port.write(s, (err) => {
                if (err) {
                    console.error('Write failed', err.message);
                    if (callback) callback(err);
                    return;
                }
                if (callback) callback();
            });
            return true;
        } else {
            console.warn('Serial not open: cannot send', data);
            return false;
        }
    }

    isOpen() {
        return this.port && this.port.isOpen;
    }
}

module.exports = SerialBridge;