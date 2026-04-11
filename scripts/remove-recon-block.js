import { readFileSync, writeFileSync } from 'fs';

const filePath = '/vercel/share/v0-project/public/tracker.html';
const lines = readFileSync(filePath, 'utf8').split('\n');

// Find the start line: '// ── RECONSTITUTION CALCULATOR ──'
let startIdx = -1;
let endIdx = -1;

for (let i = 0; i < lines.length; i++) {
  if (startIdx === -1 && lines[i].trim() === '// ── RECONSTITUTION CALCULATOR ──') {
    startIdx = i;
  }
  // Find 'function buildSideCompoundSelect' end — look for closing brace after it
  if (startIdx !== -1 && endIdx === -1) {
    if (lines[i].trim() === 'function buildSideCompoundSelect(){') {
      // Find the closing brace of this function
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
  console.log('ERROR: Could not find block boundaries. startIdx=' + startIdx + ' endIdx=' + endIdx);
  process.exit(1);
}

console.log('Removing lines ' + (startIdx + 1) + ' through ' + (endIdx + 1));
const newLines = [...lines.slice(0, startIdx), ...lines.slice(endIdx + 1)];
writeFileSync(filePath, newLines.join('\n'), 'utf8');
console.log('Done. Removed ' + (endIdx - startIdx + 1) + ' lines.');
