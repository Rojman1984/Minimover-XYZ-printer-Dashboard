const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const origName = file.originalname;
    const ext = path.extname(origName);
    const base = path.basename(origName, ext);
    let finalName = origName;
    let i = 1;
    while (fs.existsSync(path.join(uploadDir, finalName))) {
      finalName = `${base}-${i}${ext}`;
      i++;
    }
    cb(null, finalName);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Only accept .gcode or .txt files for printing
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.gcode' || ext === '.txt') {
      cb(null, true);
    } else {
      cb(new Error('Only .gcode or .txt files are allowed'));
    }
  }
});

module.exports = upload;
