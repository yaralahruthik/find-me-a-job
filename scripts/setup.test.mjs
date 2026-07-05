import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SETUP = join(HERE, 'setup.mjs');

function run(args) {
  try {
    const stdout = execFileSync('node', [SETUP, ...args], { encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

// The default (acting) mode is deliberately NOT exercised here — it would spawn
// npm ci / git config against the developer's checkout. --check is read-only.

test('setup --check --json: reports the full readiness shape', () => {
  const r = run(['--check', '--json']);
  const s = JSON.parse(r.stdout);
  assert.equal(typeof s.node.ok, 'boolean');
  assert.match(s.node.version, /^\d+\./);
  assert.equal(typeof s.deps, 'boolean');
  assert.equal(typeof s.hooks, 'boolean');
  assert.ok([true, false, 'unknown'].includes(s.chromium));
  assert.equal(typeof s.config.profile, 'boolean');
  assert.equal(typeof s.config.pipeline, 'boolean');
  assert.equal(typeof s.ready, 'boolean');
});

test('setup --check: exit code mirrors ready, and deps are true in this checkout', () => {
  const r = run(['--check', '--json']);
  const s = JSON.parse(r.stdout);
  assert.equal(s.deps, true, 'tests run after npm ci, deps must be present');
  assert.equal(s.ready, true);
  assert.equal(r.code, 0, 'ready → exit 0');
});

test('setup --check (human): prints one line per probe and the /fh init pointer', () => {
  const r = run(['--check']);
  for (const label of ['node', 'deps', 'guard', 'pdf', 'config']) assert.match(r.stdout, new RegExp(`^  ${label}`, 'm'));
  assert.match(r.stdout, /\/fh init/);
});

test('setup: an unknown subcommand is a usage error (exit 2), never a silent act', () => {
  const r = run(['bogus']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Usage: setup\.mjs/);
});
