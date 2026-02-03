/**
 * Quick test script to validate gcode → .3w conversion
 * Usage: node test_gcode_to_3w.js
 */

const { convertGcodeTo3w } = require('./lib/gcode_to_3w');
const { convert3wToGcode } = require('./lib/convert_3w');
const fs = require('fs');
const path = require('path');

async function test() {
  const testGcode = path.join(__dirname, 'test_conversion.gcode');
  const output3w = path.join(__dirname, 'test_conversion.3w');
  const outputRoundtrip = path.join(__dirname, 'test_conversion_roundtrip.gcode');
  
  console.log('=== Testing Gcode → .3w Conversion ===\n');
  
  // Test 1: Convert gcode to .3w
  console.log('Step 1: Converting gcode to .3w...');
  const result1 = await convertGcodeTo3w(testGcode, output3w);
  
  if (!result1.success) {
    console.error('❌ Conversion failed:', result1.error);
    process.exit(1);
  }
  
  console.log('✅', result1.message);
  
  // Check file size
  const gcodeSize = fs.statSync(testGcode).size;
  const w3Size = fs.statSync(output3w).size;
  console.log(`   Input gcode: ${gcodeSize} bytes`);
  console.log(`   Output .3w: ${w3Size} bytes (overhead: ${w3Size - gcodeSize} bytes)`);
  
  // Validate .3w structure
  console.log('\nStep 2: Validating .3w structure...');
  const w3Buffer = fs.readFileSync(output3w);
  
  const header = w3Buffer.slice(0, 12).toString('ascii');
  console.log(`   Header: "${header}" ${header.startsWith('3DPFNKG1') ? '✅' : '❌'}`);
  
  const version = w3Buffer[13];
  console.log(`   Version: ${version} ${version === 2 ? '✅' : '❌'}`);
  
  const tagMarker = w3Buffer.slice(0x20, 0x28).toString('ascii');
  console.log(`   Tag marker: "${tagMarker}" ${tagMarker.startsWith('TagEa256') ? '✅' : '❌'}`);
  
  const bodyOffset = 0x2000;
  const bodyStart = w3Buffer.slice(bodyOffset, bodyOffset + 16);
  console.log(`   Body encrypted: ${bodyStart[0] !== 0x3b ? '✅ (not plaintext)' : '❌ (plaintext detected!)'}`);
  
  // Test 2: Roundtrip conversion (decrypt back to gcode)
  console.log('\nStep 3: Testing roundtrip (decrypt .3w back to gcode)...');
  const result2 = await convert3wToGcode(output3w, outputRoundtrip);
  
  if (!result2.success) {
    console.error('❌ Decryption failed:', result2.error);
    process.exit(1);
  }
  
  console.log('✅', result2.message);
  
  // Compare original and roundtrip gcode
  const originalGcode = fs.readFileSync(testGcode, 'utf8').trim();
  const roundtripGcode = fs.readFileSync(outputRoundtrip, 'utf8').trim();
  
  if (originalGcode === roundtripGcode) {
    console.log('✅ Roundtrip successful - gcode matches exactly!\n');
  } else {
    console.log('⚠️  Roundtrip gcode differs (may have padding)');
    console.log(`   Original length: ${originalGcode.length}`);
    console.log(`   Roundtrip length: ${roundtripGcode.length}`);
    
    // Check if roundtrip contains original (with possible padding)
    if (roundtripGcode.startsWith(originalGcode)) {
      console.log('✅ Original gcode preserved (extra padding is OK)\n');
    } else {
      console.log('❌ Content mismatch!\n');
      process.exit(1);
    }
  }
  
  console.log('=== All Tests Passed ✅ ===');
  console.log('\nGenerated files:');
  console.log(`  - ${output3w}`);
  console.log(`  - ${outputRoundtrip}`);
  console.log('\nYou can now test uploading test_conversion.3w to the printer!');
  
  // Cleanup option
  console.log('\nTo clean up test files, run:');
  console.log('  rm test_conversion.3w test_conversion_roundtrip.gcode');
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
