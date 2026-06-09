const fs = require('fs');
const path = require('path');

const baseDir = 'c:\\Users\\tcontrol_sis\\OneDrive - TCONTROL S.A\\Asistencia';
const file = path.join(baseDir, 'JS', 'index_core.js');

if (fs.existsSync(file)) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  console.log(`Searching index_core.js...`);
  lines.forEach((line, idx) => {
    if (line.includes('HORA') || line.includes('ENTRADA') || line.includes('SALIDA') || line.includes('festivo') || line.includes('feriado') || line.includes('domingo') || line.includes('sabado') || line.includes('420') || line.includes('900')) {
      if (line.includes('const') || line.includes('let') || line.includes('var') || line.includes('if') || line.includes('else') || line.includes('?')) {
        console.log(`${idx + 1}: ${line.trim()}`);
      }
    }
  });
} else {
  console.log('File not found');
}
