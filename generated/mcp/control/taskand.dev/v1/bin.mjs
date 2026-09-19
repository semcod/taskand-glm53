#!/usr/bin/env node
// Process identity stays in Taskand; the SDK and receipt store live in one runtime.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const python = process.env.TASKAND_MCP_PYTHON;
let result;
if (!python?.startsWith('/')) {
  result = {ok: false, errorType: 'CONTROL_NOT_CONFIGURED'};
} else {
  const entry = fileURLToPath(new URL('../../../../../packages/taskand-mcp-control/control.py', import.meta.url));
  const expected = '4b2a8ed17ca41836a67c46128df4d8751266f324d270695c20f15c91077e0a28';
  if (createHash('sha256').update(readFileSync(entry)).digest('hex') !== expected) {
    process.stdout.write(JSON.stringify({ok:false,errorType:'CONTROL_INTEGRITY_MISMATCH'}) + '\n');
    process.exit(0);
  }
  const child = spawnSync(python, [entry], {input: readFileSync(0), encoding: 'utf8',
    timeout: 35000, maxBuffer: 524288, env: process.env});
  try { result = JSON.parse(child.stdout); }
  catch { result = {ok: false, errorType: 'CONTROL_RESULT_UNKNOWN', outcomeKnown: false}; }
}
process.stdout.write(JSON.stringify(result) + '\n');
