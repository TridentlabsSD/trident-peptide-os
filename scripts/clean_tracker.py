#!/usr/bin/env python3
"""Remove the orphaned RECON_DB data block from tracker.html."""
import os, sys

# Find the file
candidates = [
    os.path.join(os.path.dirname(__file__), '..', 'public', 'tracker.html'),
]
filepath = None
for c in candidates:
    p = os.path.realpath(c)
    if os.path.exists(p):
        filepath = p
        break

if not filepath:
    print("ERROR: tracker.html not found")
    sys.exit(1)

print(f"Found: {filepath}")

with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

print(f"Total lines: {len(lines)}")

# Find start: line containing '// ── RECON_REMOVED ──'
# Find end: line containing '// ── INIT ──'
start_idx = None
end_idx = None

for i, line in enumerate(lines):
    stripped = line.strip()
    if stripped == '// ── RECON_REMOVED ──':
        start_idx = i
    if stripped == '// ── INIT ──' and start_idx is not None and end_idx is None:
        end_idx = i

if start_idx is None or end_idx is None:
    print(f"ERROR: Could not find markers. start={start_idx}, end={end_idx}")
    # Debug: show lines with RECON or INIT
    for i, line in enumerate(lines):
        if 'RECON_REMOVED' in line or 'INIT ──' in line:
            print(f"  Line {i+1}: {line.rstrip()}")
    sys.exit(1)

print(f"Removing lines {start_idx+1} to {end_idx} (keeping line {end_idx+1}: {lines[end_idx].rstrip()})")
new_lines = lines[:start_idx] + lines[end_idx:]

with open(filepath, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print(f"Done. New total lines: {len(new_lines)}")
