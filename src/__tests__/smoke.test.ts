import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('CLI boots and shows help', () => {
  const bin = path.resolve(__dirname, '../../dist/index.js');
  const out = execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
  expect(out).toMatch(/dep-audit/i);
});
