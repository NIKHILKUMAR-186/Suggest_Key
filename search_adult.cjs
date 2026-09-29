const fs = require('fs');
const path = require('path');

function findFiles(dir, ext) {
  const files = [];
  fs.readdirSync(dir).forEach(f => {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory() && !f.startsWith('.') && f !== 'node_modules') {
      files.push(...findFiles(full, ext));
    } else if (full.endsWith(ext)) {
      files.push(full);
    }
  });
  return files;
}

const sqlFiles = findFiles('S:\\suggest-key\\Suggest_key\\supabase', '.sql');
sqlFiles.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  lines.forEach((l, i) => {
    // Look for 'adult' not in a string literal
    const idx = l.toLowerCase().indexOf('adult');
    if (idx >= 0) {
      // Check if it's in a string literal
      const before = l.substring(0, idx);
      const singleQuotes = (before.match(/'/g) || []).length;
      const doubleQuotes = (before.match(/"/g) || []).length;
      // If we're in an even number of both quote types, we're outside strings
      if (singleQuotes % 2 === 0 && doubleQuotes % 2 === 0) {
        console.log(f + ':' + (i+1) + ': ' + l.trim());
      }
    }
  });
});