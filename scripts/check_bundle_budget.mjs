import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const budgetBytes = 200 * 1024;
const manifest = JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8'));
const entry = Object.values(manifest).find((item) => item.isEntry);

if (!entry?.file) {
  throw new Error('Vite manifest does not contain an application entry. Run npm run build first.');
}

const compressedBytes = gzipSync(readFileSync(`dist/${entry.file}`)).byteLength;
const compressedKb = compressedBytes / 1024;
console.log(`Initial application chunk: ${compressedKb.toFixed(1)} KiB gzip (${entry.file})`);

if (compressedBytes > budgetBytes) {
  throw new Error(`Initial chunk exceeds the ${budgetBytes / 1024} KiB gzip budget.`);
}
