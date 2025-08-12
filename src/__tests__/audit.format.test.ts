import { jest } from '@jest/globals';
import util from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Stable output for CI
process.env.FORCE_COLOR = '0';
process.env.NODE_DISABLE_COLORS = '1';
process.env.CI = 'true';

// --- ESM-safe mock for child_process with promisify support ---
await jest.unstable_mockModule('child_process', () => {
  const stdout = JSON.stringify({
    vulnerabilities: {
      'bad-pkg': {
        name: 'bad-pkg',
        severity: 'high',
        via: [{ title: 'Prototype Pollution', url: 'https://advisory.example/bad' }],
        range: '<1.2.3',
        fixAvailable: { name: 'bad-pkg', version: '1.2.3' },
      },
      'meh-pkg': {
        name: 'meh-pkg',
        severity: 'moderate',
        via: ['Some advisory'],
        range: '<0.5.0',
        fixAvailable: false,
      },
    },
    metadata: { vulnerabilities: { low: 0, moderate: 1, high: 1, critical: 0 } },
  });

  function exec(_cmd: string, _opts?: any, cb?: any) {
    const res = { stdout, stderr: '' };
    if (typeof cb === 'function') return cb(null, res);
    // some environments also call exec directly
    return res as any;
  }
  // <- critical: make util.promisify(exec) return a promise that resolves to our JSON
  (exec as any)[util.promisify.custom] = async () => ({ stdout, stderr: '' });

  return { exec };
});

// --- ESM-safe mock for npm-check-updates default export ---
await jest.unstable_mockModule('npm-check-updates', () => ({
  default: { run: jest.fn(async () => ({ leftpad: '1.3.0', chalk: '5.3.0' })) },
}));

// Resolve ESM dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import after mocks
const { auditDependencies } = await import('../audit.ts');

test('prints table with vulns and outdated deps, sets exit code on high/critical', async () => {
  const projectPath = path.resolve('.');
  const logs: string[] = [];
  const errs: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: any[]) => { logs.push(a.join(' ')); };
  console.error = (...a: any[]) => { errs.push(a.join(' ')); };

  try {
    const code = await auditDependencies(projectPath, {
      severity: 'low',
      exclude: [],
      githubAnnotations: true,
    });

    // should fail due to "high"
    expect(code).toBe(1);

    const output = logs.join('\n') + '\n' + errs.join('\n');
    expect(output).toMatch(/Vulnerabilities:/i);
    expect(output).toMatch(/bad-pkg/i);
    expect(output).toMatch(/HIGH/i);
    expect(output).toMatch(/meh-pkg/i);
    expect(output).toMatch(/MODERATE/i);
    expect(output).toMatch(/Outdated Packages:/i);
    expect(output).toMatch(/leftpad/);
    expect(output).toMatch(/chalk/);
    expect(output).toMatch(/badge\/dependencies/);
    expect(output).toMatch(/badge\/vulnerabilities/);
    expect(output).toMatch(/::error ::Vulnerability in bad-pkg: severity=high/);
    expect(output).toMatch(/::warning ::Vulnerability in meh-pkg: severity=moderate/);
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
});
