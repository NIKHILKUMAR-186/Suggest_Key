const fs = require('fs');
const path = require('path');

function findFiles(dir) {
  const files = [];
  fs.readdirSync(dir).forEach(f => {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory() && !f.startsWith('.') && f !== 'node_modules' && f !== 'dist') {
      files.push(...findFiles(full));
    } else if (full.endsWith('.ts') || full.endsWith('.tsx') || full.endsWith('.js') || full.endsWith('.json')) {
      files.push(full);
    }
  });
  return files;
}

const allFiles = findFiles('S:\\suggest-key\\Suggest_key\\src');
allFiles.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  if (content.toLowerCase().includes('adult')) {
    console.log('FILE: ' + f);
    const lines = content.split('\n');
    lines.forEach((l, i) => {
      if (l.toLowerCase().includes('adult')) {
        console.log('  ' + (i+1) + ': ' + l.trim());
      }
    });
  }
});