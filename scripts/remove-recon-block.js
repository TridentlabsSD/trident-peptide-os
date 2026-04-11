import { readFileSync, writeFileSync, existsSync } from 'fs';

// Try multiple possible paths
const candidates = [
  '/vercel/share/v0-project/public/tracker.html',
  process.cwd() + '/public/tracker.html',
  '/home/user/public/tracker.html',
];

let filePath = null;
for (const c of candidates) {
  if (existsSync(c)) { filePath = c; break; }
}

if (!filePath) {
  console.log('ERROR: tracker.html not found. Tried:', candidates);
  process.exit(1);
}

console.log('Using file:', filePath);
const lines = readFileSync(filePath, 'utf8').split('\n');

// Find the start line: '// ── RECONSTITUTION CALCULATOR ──'
let startIdx = -1;
let endIdx = -1;

for (let i = 0; i < lines.length; i++) {
  if (startIdx === -1 && lines[i].trim() === '// ── RECONSTITUTION CALCULATOR ──') {
    startIdx = i;
  }
  if (startIdx !== -1 && endIdx === -1) {
    if (lines[i].trim() === 'function buildSideCompoundSelect(){') {
      let depth = 0;
      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{') depth++;
          if (ch === '}') depth--;
        }
        if (depth === 0) {
          endIdx = j;
          break;
        }
      }
      break;
    }
  }
}

if (startIdx === -1 || endIdx === -1) {
  console.log('ERROR: Could not find block. startIdx=' + startIdx + ' endIdx=' + endIdx);
  // Print surrounding lines for debug
  lines.forEach((l, i) => {
    if (l.includes('RECONSTITUTION') || l.includes('buildSideCompound')) {
      console.log('  Line ' + (i+1) + ': ' + l);
    }
  });
  process.exit(1);
}

console.log('Removing lines ' + (startIdx + 1) + ' through ' + (endIdx + 1));
const newLines = [...lines.slice(0, startIdx), ...lines.slice(endIdx + 1)];
writeFileSync(filePath, newLines.join('\n'), 'utf8');
console.log('Done. Removed ' + (endIdx - startIdx + 1) + ' lines.');
