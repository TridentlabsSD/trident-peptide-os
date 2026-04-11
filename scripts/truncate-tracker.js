import { readFileSync, writeFileSync } from 'fs';

// Try multiple possible paths for the execution environment
import { existsSync } from 'fs';
const candidates = [
  '/app/public/tracker.html',
  '/vercel/share/v0-project/public/tracker.html',
  process.cwd() + '/public/tracker.html',
];
const filePath = candidates.find(p => existsSync(p));
if (!filePath) throw new Error('tracker.html not found. Tried: ' + candidates.join(', '));
const content = readFileSync(filePath, 'utf8');
const lines = content.split('\n');

// Find the first </html> line (end of the original document)
const firstHtmlClose = lines.findIndex(line => line.trim() === '</html>');
console.log(`[v0] First </html> found at line ${firstHtmlClose + 1}`);
console.log(`[v0] Total lines: ${lines.length}`);

// Keep everything up to and including </html>
const truncated = lines.slice(0, firstHtmlClose + 1).join('\n') + '\n';
writeFileSync(filePath, truncated, 'utf8');

const newLines = truncated.split('\n').length;
console.log(`[v0] File truncated to ${newLines} lines`);
