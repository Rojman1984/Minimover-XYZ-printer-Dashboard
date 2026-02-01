const Parser = require('../lib/parser');
const assert = require('assert');

const parser = new Parser();

console.log('Running Parser Status Mapping Tests...');

const sampleJson = {
    data: {
        t: [210.5, 210.0],
        b: 60,
        B: 65,
        d: "45,10,35",
        j: 4,
        l: 1500,
        i: "XYZ123456",
        v: "1.2.3",
        w: ["SN-FIL-001", "PLA"]
    }
};

parser.on('status', (status) => {
    try {
        assert.strictEqual(status.extruderActual_C, 210.5, 'Extruder Actual mismatch');
        assert.strictEqual(status.extruderTarget_C, 210.0, 'Extruder Target mismatch');
        assert.strictEqual(status.bedActual_C, 60, 'Bed Actual mismatch');
        assert.strictEqual(status.bedTarget_C, 65, 'Bed Target mismatch');
        assert.strictEqual(status.printPercent, 45, 'Print Percent mismatch');
        assert.strictEqual(status.elapsedMin, 10, 'Elapsed Min mismatch');
        assert.strictEqual(status.timeLeftMin, 35, 'Time Left mismatch');
        assert.strictEqual(status.filamentRemaining_mm, 1500, 'Filament Remaining mismatch');
        assert.strictEqual(status.serialNumber, "XYZ123456", 'Serial Number mismatch');
        assert.strictEqual(status.filamentSerial, "SN-FIL-001", 'Filament Serial mismatch');
        assert.strictEqual(status.printerState, 4, 'Printer State mismatch');

        console.log('✅ All status mapping tests passed!');
    } catch (e) {
        console.error('❌ Test failed:', e.message);
        process.exit(1);
    }
});

parser.feed(JSON.stringify(sampleJson));