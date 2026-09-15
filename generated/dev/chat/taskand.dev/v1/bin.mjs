#!/usr/bin/env node
// proc://taskand.dev/dev/chat/v1 — jedyne wejście konwersacyjne: {message, organism?} → intencja → proces przez rejestr
import { readFileSync } from 'node:fs';
import { parseIntent } from './intent.mjs';
import { dispatch } from './dispatch.mjs';

let input;
try {
  const raw = readFileSync(0, 'utf8').trim();
  input = raw ? JSON.parse(raw) : {};
} catch {
  process.exit(2);
}

const intent = parseIntent(input.message || input.prompt || 'status', input.organism || '');
let out;
try {
  const dispatched = dispatch(intent);
  if (dispatched && typeof dispatched === 'object') {
    // Pola strukturalne (devices, result, …) przechodzą dalej; ok/organism/intent/reply są kanoniczne
    out = {
      ...dispatched,
      ok: dispatched.ok !== false,
      organism: intent.organism,
      intent: intent.name,
      reply: dispatched.reply || dispatched.summary || (dispatched.ok === false ? `✗ ${dispatched.error}` : JSON.stringify(dispatched))
    };
  } else {
    out = { ok: true, organism: intent.organism, intent: intent.name, reply: dispatched };
  }
} catch (err) {
  out = { ok: false, organism: intent.organism, intent: intent.name, reply: `[${intent.organism}] ✗ ${err.message}` };
}
// exit dopiero po opróżnieniu stdout — duże wyniki nie są obcinane na potoku
process.stdout.write(JSON.stringify(out) + '\n', () => process.exit(0));
