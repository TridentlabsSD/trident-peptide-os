import { readFileSync, writeFileSync } from 'fs';

const filePath = '/vercel/share/v0-project/public/tracker.html';
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
