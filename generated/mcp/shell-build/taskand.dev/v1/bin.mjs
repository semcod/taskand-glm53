#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, isAbsolute } from 'node:path';
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const prepare = true;
let out;
try {
  const raw = readFileSync(0);
  if (raw.length > 262144) throw new Error('SHELL_REQUEST_TOO_LARGE');
  const input = JSON.parse(raw.toString('utf8'));
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('SHELL_OBJECT_REQUIRED');
  const operation = prepare ? (input.operation || 'plan') : 'run';
  if (!['plan', 'compile', 'export', 'verify'].includes(operation) || (!prepare && 'operation' in input)) throw new Error('SHELL_OPERATION_DENIED');
  const payload = { ...input };
  if (prepare) delete payload.operation;
  const entry = join(root, 'app/shell_workflow.py');
  if (createHash('sha256').update(readFileSync(entry)).digest('hex') !== '53dd535c624adcb6326e6e440105bef5b54c162de37355507ce3e45d4739cff1') throw new Error('SHELL_ADAPTER_INTEGRITY_MISMATCH');
  const python = process.env.TASKAND_SHELL_PYTHON || join(root, '.subactor/cache/shell-venv/bin/python');
  if (!isAbsolute(python)) throw new Error('SHELL_PYTHON_ABSOLUTE_PATH_REQUIRED');
  const result = spawnSync(python, [entry, 'process', operation], {
    input: JSON.stringify(payload), encoding: 'utf8', cwd: root, env: process.env,
    timeout: 125000, maxBuffer: 1024 * 1024
  });
  if (result.error || result.signal) {
    out = { ok: false, errorType: result.error?.code === 'ENOENT' ? 'SHELL_NOT_INSTALLED' : 'OUTCOME_UNKNOWN',
      error: result.error?.code || result.signal, outcomeKnown: result.error?.code === 'ENOENT' };
  } else {
    out = JSON.parse(result.stdout);
    if (result.status !== 0 && out.ok !== false) out = { ok: false, error: 'SHELL_PROCESS_FAILED' };
  }
} catch (error) {
  out = { ok: false, errorType: 'SHELL_REQUEST_FAILED', error: error.message };
}
process.stdout.write(JSON.stringify(out) + '\n');
