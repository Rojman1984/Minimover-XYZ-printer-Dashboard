/**
 * Convert Da Vinci .3w files to .gcode
 * Based on miniMover decryption implementation
 * 
 * .3w File structure:
 * - Header: "3DPFNKG13WTW" (12 bytes) + version info
 * - Tag section: "TagE" marker with metadata  
 * - Body (starts at offset 0x2000/8192): AES-encrypted gcode
 *   - Key: "@xyzprinting.com" (CBC) or "@xyzprinting.com@xyzprinting.com" (ECB)
 *   - IV: 16 zeros
 *   - PKCS7 padding
 *   - May be zipped before encryption
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * Extract and decrypt gcode from .3w file
 * @param {string} inputPath - Path to .3w file
 * @param {string} outputPath - Path for output .gcode file
 * @returns {Promise<{success: boolean, outputPath?: string, error?: string}>}
 */
async function convert3wToGcode(inputPath, outputPath) {
  try {
    // Read the .3w file
    const data = fs.readFileSync(inputPath);
    
    // Verify header: "3DPFNKG13WTW"
    const header = data.slice(0, 12).toString('ascii');
    if (!header.startsWith('3DPFNKG1')) {
      return {
        success: false,
        error: 'Invalid .3w file header - not a Da Vinci .3w file'
      };
    }
    
    // Read file format version
    const fv = data[13]; // File version (2 or 5)
    const fileIsV5 = (fv === 5);
    
    // Read offset to zip marker (big endian)
    const zipOffset = data.readUInt32BE(16);
    
    // Read zip format marker at zipOffset + 20
    const tagPos = 20 + zipOffset;
    const zipMarker = data.slice(tagPos, tagPos + 8).toString('ascii');
    
    // Determine if file uses ZIP compression
    const fileIsZip = zipMarker.startsWith('TagEa128');
    
    // Body always starts at offset 0x2000 (8192)
    const bodyOffset = 0x2000;
    const bodyData = data.slice(bodyOffset);
    
    // Check if body is encrypted (first char should be ';' if unencrypted)
    if (bodyData[0] === 0x3b) { // ASCII ';'
      // File is not encrypted (v5 files sometimes aren't)
      const gcode = bodyData.toString('utf8').replace(/\0/g, '');
      fs.writeFileSync(outputPath, gcode, 'utf8');
      return {
        success: true,
        outputPath,
        message: 'Converted .3w to gcode (unencrypted file)'
      };
    }
    
    // Decrypt the body
    let decrypted;
    if (fileIsZip) {
      // ZIP + CBC encryption
      decrypted = await decryptCBC(bodyData);
      
      // Unzip the decrypted data
      const tempZip = outputPath + '.zip';
      fs.writeFileSync(tempZip, decrypted);
      
      try {
        // Extract using unzip
        const tempDir = path.dirname(tempZip);
        await execAsync(`unzip -q -o "${tempZip}" -d "${tempDir}"`);
        
        // Find the extracted gcode file
        const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.gcode'));
        if (files.length > 0) {
          const gcodeFile = path.join(tempDir, files[0]);
          fs.copyFileSync(gcodeFile, outputPath);
          fs.unlinkSync(gcodeFile);
        }
        fs.unlinkSync(tempZip);
      } catch (err) {
        return {
          success: false,
          error: `Failed to unzip: ${err.message}`
        };
      }
    } else {
      // ECB encryption (no ZIP)
      decrypted = decryptECB(bodyData);
      
      // Remove null padding and write
      const gcode = decrypted.toString('utf8').replace(/\0+$/, '');
      fs.writeFileSync(outputPath, gcode, 'utf8');
    }
    
    return {
      success: true,
      outputPath,
      message: `Converted .3w to gcode (${fileIsZip ? 'ZIP+' : ''}${fileIsZip ? 'CBC' : 'ECB'} decrypted)`
    };
    
  } catch (error) {
    return {
      success: false,
      error: `Conversion failed: ${error.message}`
    };
  }
}

/**
 * Decrypt using AES-CBC mode
 */
async function decryptCBC(encryptedData) {
  const key = Buffer.from('@xyzprinting.com', 'utf8'); // 16 bytes
  const iv = Buffer.alloc(16, 0); // 16 zeros
  const blockSize = 0x2010; // 8208 bytes
  
  let decrypted = Buffer.alloc(0);
  
  for (let offset = 0; offset < encryptedData.length; offset += blockSize) {
    const blockLen = Math.min(blockSize, encryptedData.length - offset);
    const block = encryptedData.slice(offset, offset + blockLen);
    
    // Decrypt this block with fresh IV each time
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(false); // Handle PKCS7 manually
    
    let decryptedBlock = Buffer.concat([
      decipher.update(block),
      decipher.final()
    ]);
    
    // Remove PKCS7 padding from last byte
    const paddingLen = decryptedBlock[decryptedBlock.length - 1];
    if (paddingLen > 0 && paddingLen <= 16) {
      decryptedBlock = decryptedBlock.slice(0, -paddingLen);
    }
    
    decrypted = Buffer.concat([decrypted, decryptedBlock]);
  }
  
  return decrypted;
}

/**
 * Decrypt using AES-ECB mode
 */
function decryptECB(encryptedData) {
  const key = Buffer.from('@xyzprinting.com@xyzprinting.com', 'utf8'); // 32 bytes
  const blockSize = 0x2010; // 8208 bytes
  
  let decrypted = Buffer.alloc(0);
  
  for (let offset = 0; offset < encryptedData.length; offset += blockSize) {
    const blockLen = Math.min(blockSize, encryptedData.length - offset);
    const block = encryptedData.slice(offset, offset + blockLen);
    
    // ECB mode decryption
    const decipher = crypto.createDecipheriv('aes-256-ecb', key, null);
    decipher.setAutoPadding(false);
    
    let decryptedBlock = Buffer.concat([
      decipher.update(block),
      decipher.final()
    ]);
    
    // Remove PKCS7 padding
    const paddingLen = decryptedBlock[decryptedBlock.length - 1];
    if (paddingLen > 0 && paddingLen <= 16) {
      decryptedBlock = decryptedBlock.slice(0, -paddingLen);
    }
    
    decrypted = Buffer.concat([decrypted, decryptedBlock]);
  }
  
  return decrypted;
}

module.exports = { convert3wToGcode };
