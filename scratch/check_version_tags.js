const fs = require('fs');
const path = require('path');

const baseDir = 'c:\\Users\\tcontrol_sis\\OneDrive - TCONTROL S.A\\Asistencia';
const file = path.join(baseDir, 'supervisor.html');

if (fs.existsSync(file)) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  console.log('Checking supervisor.html script tags:');
  lines.forEach((line, idx) => {
    if (line.includes('.js') || line.includes('.css')) {
      console.log(`${idx + 1}: ${line.trim()}`);
    }
  });
} else {
  console.log('File not found');
}
