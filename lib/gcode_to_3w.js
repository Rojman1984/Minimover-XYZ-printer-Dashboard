/**
 * Convert gcode files to Da Vinci .3w format
 * Required for XYZ printers that only accept .3w files
 * 
 * .3w File structure:
 * - Header (0x0000-0x001F): "3DPFNKG13WTW" + version info + offsets
 * - Tag section (0x0020-0x1FFF): "TagE" marker with metadata
 * - Body (0x2000+): AES-encrypted gcode
 *   - ECB mode: AES-256-ECB with key "@xyzprinting.com@xyzprinting.com"
 *   - PKCS7 padding
 *   - Block size: 0x2010 (8208 bytes)
 */

const fs = require('fs');
const crypto = require('crypto');

/**
 * Encrypt gcode and wrap in .3w container
 * @param {string} gcodeInputPath - Path to gcode file
 * @param {string} outputPath - Path for output .3w file
 * @returns {Promise<{success: boolean, outputPath?: string, error?: string}>}
 */
async function convertGcodeTo3w(gcodeInputPath, outputPath) {
  try {
    // Read the gcode file
    const gcodeContent = fs.readFileSync(gcodeInputPath, 'utf8');
    const gcodeBuffer = Buffer.from(gcodeContent, 'utf8');
    
    // Encrypt the gcode using ECB mode (simpler, no ZIP compression)
    const encryptedBody = encryptECB(gcodeBuffer);
    
    // Create .3w file structure
    const fileBuffer = create3wFile(encryptedBody);
    
    // Write the .3w file
    fs.writeFileSync(outputPath, fileBuffer);
    
    return {
      success: true,
      outputPath,
      message: `Converted gcode to .3w (ECB encrypted, ${fileBuffer.length} bytes)`
    };
    
  } catch (error) {
    return {
      success: false,
      error: `Conversion failed: ${error.message}`
    };
  }
}

/**
 * Encrypt gcode using AES-256-ECB mode
 * @param {Buffer} gcodeBuffer - Raw gcode content
 * @returns {Buffer} Encrypted data
 */
function encryptECB(gcodeBuffer) {
  const key = Buffer.from('@xyzprinting.com@xyzprinting.com', 'utf8'); // 32 bytes for AES-256
  const blockSize = 0x2010; // 8208 bytes
  
  // Add PKCS7 padding to align to 16-byte AES blocks
  const paddingNeeded = 16 - (gcodeBuffer.length % 16);
  const paddedBuffer = Buffer.concat([
    gcodeBuffer,
    Buffer.alloc(paddingNeeded, paddingNeeded)
  ]);
  
  let encrypted = Buffer.alloc(0);
  
  // Encrypt in blocks of 0x2010 bytes
  for (let offset = 0; offset < paddedBuffer.length; offset += blockSize) {
    const blockLen = Math.min(blockSize, paddedBuffer.length - offset);
    const block = paddedBuffer.slice(offset, offset + blockLen);
    
    // Pad block to blockSize if needed (last block)
    let fullBlock = block;
    if (blockLen < blockSize) {
      const fillSize = blockSize - blockLen;
      fullBlock = Buffer.concat([block, Buffer.alloc(fillSize, 0)]);
    }
    
    // ECB mode encryption
    const cipher = crypto.createCipheriv('aes-256-ecb', key, null);
    cipher.setAutoPadding(false);
    
    const encryptedBlock = Buffer.concat([
      cipher.update(fullBlock),
      cipher.final()
    ]);
    
    encrypted = Buffer.concat([encrypted, encryptedBlock]);
  }
  
  return encrypted;
}

/**
 * Create .3w file structure with header and tags
 * @param {Buffer} encryptedBody - Encrypted gcode data
 * @returns {Buffer} Complete .3w file
 */
function create3wFile(encryptedBody) {
  // Total file size: header (0x2000 = 8192) + encrypted body
  const headerSize = 0x2000;
  const totalSize = headerSize + encryptedBody.length;
  const fileBuffer = Buffer.alloc(totalSize, 0);
  
  // === HEADER SECTION (0x0000 - 0x001F) ===
  
  // Magic header: "3DPFNKG13WTW"
  fileBuffer.write('3DPFNKG13WTW', 0, 'ascii');
  
  // File version: 2 (non-ZIP version)
  fileBuffer.writeUInt8(2, 13);
  
  // Zip offset (big endian) - for non-ZIP files, point to tag section
  // Tag is at offset 0x20, so write 0x00000000
  fileBuffer.writeUInt32BE(0, 16);
  
  // === TAG SECTION (0x0020 - 0x1FFF) ===
  
  // Tag marker: "TagEa256" (ECB encryption marker)
  fileBuffer.write('TagEa256', 0x20, 'ascii');
  
  // Additional metadata can be added here if needed
  // For basic functionality, rest can remain zeros
  
  // Optional: Add file info at known offsets
  // Total file size at 0x28 (4 bytes, little endian)
  fileBuffer.writeUInt32LE(totalSize, 0x28);
  
  // Body size at 0x2C (4 bytes, little endian)
  fileBuffer.writeUInt32LE(encryptedBody.length, 0x2C);
  
  // === BODY SECTION (0x2000+) ===
  
  // Copy encrypted body starting at offset 0x2000
  encryptedBody.copy(fileBuffer, headerSize);
  
  return fileBuffer;
}

module.exports = { convertGcodeTo3w };
