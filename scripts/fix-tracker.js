import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Resolve path relative to this script's location
const __dirname = dirname(fileURLToPath(import.meta.url));

// Try common mount paths used by the script execution environment
const paths = [
  join(__dirname, '..', 'public', 'tracker.html'),
  '/app/public/tracker.html',
  '/vercel/share/v0-project/public/tracker.html',
];

let filePath = null;
for (const p of paths) {
  try {
    readFileSync(p);
    filePath = p;
    break;
  } catch (_) {}
}

if (!filePath) {
  console.error('Could not find tracker.html. Tried:', paths.join(', '));
  process.exit(1);
}

const content = readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log(`Total lines: ${lines.length}`);

// Find the FIRST </html> line and truncate there
const closeIdx = lines.findIndex(l => l.trim() === '</html>');
if (closeIdx === -1) {
  console.error('</html> not found');
  process.exit(1);
}

console.log(`Found </html> at line ${closeIdx + 1}`);
console.log(`Lines after </html>: ${lines.length - closeIdx - 1}`);

const truncated = lines.slice(0, closeIdx + 1).join('\n');
writeFileSync(filePath, truncated, 'utf8');

console.log(`Done. File now has ${truncated.split('\n').length} lines.`);
