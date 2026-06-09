const fs = require('fs');
const path = require('path');

const baseDir = 'c:\\Users\\tcontrol_sis\\OneDrive - TCONTROL S.A\\Asistencia';

function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '.git' && entry.name !== 'node_modules') {
        scanDir(fullPath);
      }
    } else {
      const ext = path.extname(entry.name);
      if (['.js', '.html', '.gs'].includes(ext)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');
        lines.forEach((line, idx) => {
          if (line.includes('435') || line.includes('915') || line.includes('07:15') || line.includes('15:15')) {
            console.log(`${path.relative(baseDir, fullPath)}:${idx + 1}: ${line.trim()}`);
          }
        });
      }
    }
  }
}

console.log('Scanning all files in:', baseDir);
scanDir(baseDir);
