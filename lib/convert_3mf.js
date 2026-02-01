// lib/convert_3mf.js
// Converter for XYZ .3mf files to gcode
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);

/**
 * Convert XYZ .3mf file to gcode or extract as STL
 * .3mf files can contain either pre-sliced gcode or 3D mesh data
 */
async function convert3mfToGcode(inputPath, outputPath) {
  try {
    // Check if unzip is available
    const tempDir = path.join(path.dirname(inputPath), `temp_${Date.now()}`);
    
    // Extract .3mf (it's a ZIP archive)
    await execPromise(`unzip -q "${inputPath}" -d "${tempDir}"`);
    
    // XYZ .3mf files may contain gcode in Metadata or as separate files
    // Try common locations
    const possibleGcodePaths = [
      path.join(tempDir, 'Metadata', 'gcode.xml'),
      path.join(tempDir, 'Metadata', 'gcode.gcode'),
      path.join(tempDir, 'Metadata', 'print.gcode'),
      path.join(tempDir, 'gcode.gcode'),
      path.join(tempDir, 'print.gcode')
    ];
    
    let gcodeContent = null;
    
    // Try to find gcode file
    for (const gcodePath of possibleGcodePaths) {
      if (fs.existsSync(gcodePath)) {
        gcodeContent = fs.readFileSync(gcodePath, 'utf8');
        break;
      }
    }
    
    // If not found in common locations, search all files for gcode
    if (!gcodeContent) {
      const files = getAllFiles(tempDir);
      for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        // Check if it looks like gcode (contains G-code commands)
        if (content.includes('G0 ') || content.includes('G1 ') || content.includes('M104')) {
          gcodeContent = content;
          break;
        }
      }
    }
    
    // If no gcode found, try to extract mesh and convert to STL
    if (!gcodeContent) {
      const modelPath = path.join(tempDir, '3D', '3dmodel.model');
      if (fs.existsSync(modelPath)) {
        // Extract STL instead of trying to convert to gcode
        const stlPath = outputPath.replace(/\.gcode$/i, '.stl');
        await extractMeshToSTL(modelPath, stlPath);
        
        // Clean up temp directory
        await execPromise(`rm -rf "${tempDir}"`);
        
        return {
          success: true,
          outputPath: stlPath,
          format: 'stl',
          message: 'Converted to STL. Please slice this file with XYZware or another slicer to generate gcode.'
        };
      }
      
      // Clean up temp directory
      await execPromise(`rm -rf "${tempDir}"`);
      
      throw new Error('This .3mf file contains neither gcode nor a valid 3D model. Please use XYZware to slice the model and export as .gcode.');
    }
    
    // Extract gcode from XML if needed
    if (gcodeContent.includes('<?xml')) {
      // Extract content from CDATA or text nodes
      const cdataMatch = gcodeContent.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
      if (cdataMatch) {
        gcodeContent = cdataMatch[1];
      } else {
        // Try to extract from text content between tags
        gcodeContent = gcodeContent.replace(/<[^>]*>/g, '').trim();
      }
    }
    
    // Write gcode to output file
    fs.writeFileSync(outputPath, gcodeContent, 'utf8');
    
    return {
      success: true,
      outputPath,
      size: gcodeContent.length
    };
    
  } catch (error) {
    throw new Error(`Failed to convert .3mf: ${error.message}`);
  }
}

/**
 * Get all files recursively from directory
 */
function getAllFiles(dir) {
  const files = [];
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      files.push(...getAllFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  
  return files;
}

/**
 * Extract 3D mesh from .3mf model file and convert to STL format
 */
async function extractMeshToSTL(modelPath, stlPath) {
  const xml = fs.readFileSync(modelPath, 'utf8');
  
  // Parse vertices
  const vertexRegex = /<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g;
  const vertices = [];
  let match;
  while ((match = vertexRegex.exec(xml)) !== null) {
    vertices.push({
      x: parseFloat(match[1]),
      y: parseFloat(match[2]),
      z: parseFloat(match[3])
    });
  }
  
  // Parse triangles
  const triangleRegex = /<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g;
  const triangles = [];
  while ((match = triangleRegex.exec(xml)) !== null) {
    triangles.push({
      v1: parseInt(match[1]),
      v2: parseInt(match[2]),
      v3: parseInt(match[3])
    });
  }
  
  // Generate STL file (ASCII format)
  let stlContent = 'solid model\n';
  
  for (const tri of triangles) {
    const v1 = vertices[tri.v1];
    const v2 = vertices[tri.v2];
    const v3 = vertices[tri.v3];
    
    // Calculate normal vector (simplified - just use cross product)
    const ux = v2.x - v1.x, uy = v2.y - v1.y, uz = v2.z - v1.z;
    const vx = v3.x - v1.x, vy = v3.y - v1.y, vz = v3.z - v1.z;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    
    stlContent += `  facet normal ${nx} ${ny} ${nz}\n`;
    stlContent += `    outer loop\n`;
    stlContent += `      vertex ${v1.x} ${v1.y} ${v1.z}\n`;
    stlContent += `      vertex ${v2.x} ${v2.y} ${v2.z}\n`;
    stlContent += `      vertex ${v3.x} ${v3.y} ${v3.z}\n`;
    stlContent += `    endloop\n`;
    stlContent += `  endfacet\n`;
  }
  
  stlContent += 'endsolid model\n';
  
  fs.writeFileSync(stlPath, stlContent, 'utf8');
}

module.exports = { convert3mfToGcode };
