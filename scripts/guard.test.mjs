import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'guard.mjs');

function run(argv) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
}

const MIXED = [
  'config/profile.yaml',            // personal
  'config/resume.example.yaml',     // template — allowed
  'config/tailor/stripe-swe.yaml',  // personal
  'config/tailor.example.yaml',     // template — allowed
  'config/assets/resume.pdf',       // personal
  'data/pipeline.yaml',             // personal
  'data/pipeline.example.yaml',     // template — allowed
  'data/.gitkeep',                  // placeholder — allowed
  'core/RULES.md',                  // source — allowed
  'scripts/guard.mjs',              // source — allowed
].join(',');

test('staged: flags exactly the personal-data paths and exits 1', () => {
  const r = run(['staged', '--files', MIXED, '--json']);
  assert.equal(r.code, 1, r.stderr);
  const { offenders } = JSON.parse(r.stdout);
  assert.deepEqual(offenders.sort(), [
    'config/assets/resume.pdf',
    'config/profile.yaml',
    'config/tailor/stripe-swe.yaml',
    'data/pipeline.yaml',
  ].sort());
});

test('staged: example/template and source files are allowed (exit 0)', () => {
  const clean = 'config/resume.example.yaml,config/tailor.example.yaml,data/pipeline.example.yaml,data/.gitkeep,core/RULES.md,README.md';
  const r = run(['staged', '--files', clean, '--json']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).offenders, []);
});

test('staged: an empty file list is clean (exit 0)', () => {
  const r = run(['staged', '--files', '', '--json']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).offenders, []);
});

test('staged: a new unrecognized config/*.yaml is treated as personal', () => {
  const r = run(['staged', '--files', 'config/cover-letter.yaml', '--json']);
  assert.equal(r.code, 1);
  assert.deepEqual(JSON.parse(r.stdout).offenders, ['config/cover-letter.yaml']);
});

test('no subcommand exits 2 (usage)', () => {
  const r = run([]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Usage:/);
});
