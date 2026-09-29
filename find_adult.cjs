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

const sqlFiles = findFiles('S:\\suggest-key\\Suggest_key\\supabase\\migrations', '.sql');
sqlFiles.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  lines.forEach((l, i) => {
    const idx = l.toLowerCase().indexOf('adult');
    if (idx >= 0) {
      const beforeAdult = l.substring(0, idx);
      const sq = (beforeAdult.match(/'/g) || []).length;
      const dq = (beforeAdult.match(/"/g) || []).length;
      if (sq % 2 === 0 && dq % 2 === 0) {
        console.log(f + ':' + (i+1) + ': ' + l.trim());
      }
    }
  });
});