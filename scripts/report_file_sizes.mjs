import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const limits = [
  { directory: 'src', extensions: ['.js', '.jsx'], warning: 1200 },
  { directory: 'terminal_app', extensions: ['.py'], warning: 1500 },
];

function walk(directory, extensions) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(target, extensions);
    return extensions.some((extension) => entry.name.endsWith(extension)) ? [target] : [];
  });
}

let warnings = 0;
for (const group of limits) {
  for (const file of walk(group.directory, group.extensions)) {
    const lines = readFileSync(file, 'utf8').split('\n').length;
    if (lines > group.warning) {
      warnings += 1;
      console.warn(`::warning file=${file}::${lines} lines exceeds the ${group.warning}-line advisory limit`);
    }
  }
}

const trackedBytes = limits.flatMap((group) => walk(group.directory, group.extensions))
  .reduce((sum, file) => sum + statSync(file).size, 0);
console.log(`Architecture size report: ${warnings} warning(s), ${(trackedBytes / 1024).toFixed(1)} KiB tracked source.`);
