const fs = require('fs');
const path = require('path');

const baseDir = 'c:\\Users\\tcontrol_sis\\OneDrive - TCONTROL S.A\\Asistencia';
const files = [
  path.join(baseDir, 'JS', 'supervisor_core.js'),
  path.join(baseDir, 'JS', 'index_core.js'),
  path.join(baseDir, 'JS', 'firebase_backend.js'),
  path.join(baseDir, 'api_completa.gs')
];

files.forEach(file => {
  if (!fs.existsSync(file)) {
    console.log(`File not found: ${file}`);
    return;
  }
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  console.log(`\n--- Searching in ${path.basename(file)} ---`);
  lines.forEach((line, idx) => {
    // Search for 435 or 915 or similar references
    if (line.includes('435') || line.includes('915') || line.includes('07:15') || line.includes('15:15')) {
      console.log(`${idx + 1}: ${line.trim()}`);
    }
  });
});
