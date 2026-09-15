#!/usr/bin/env node
// proc://taskand.dev/admin/chat/v1 — organizm admin: każde zadanie → dev/act (wybór procesu z rejestru lub ewolucja)
import { readFileSync } from 'node:fs';
import { call } from './registry-client.mjs';

let input;
try {
  const raw = readFileSync(0, 'utf8').trim();
  input = raw ? JSON.parse(raw) : {};
} catch {
  process.exit(2);
}
const message = input.message || input.prompt || '';
const r = message
  ? call('proc://taskand.dev/dev/act/v1', { organism: 'admin', message }, 900000)
  : { ok: true, reply: '[admin] Gotowy. Podaj zadanie.' };
const response = {
  ok: r.ok !== false,
  organism: 'admin',
  reply: r.reply || r.error,
  action: r.action,
  uri: r.uri
};
if (r.result && typeof r.result === 'object') {
  if (Array.isArray(r.result.devices)) response.devices = r.result.devices;
  if (r.result.summary) response.summary = r.result.summary;
  if (r.result.id) response.twinId = r.result.id;
  response.result = r.result;
} else if (Array.isArray(r.devices)) {
  response.devices = r.devices;
}
// exit dopiero po opróżnieniu stdout — duże wyniki nie są obcinane na potoku
process.stdout.write(JSON.stringify(response) + '\n', () => process.exit(0));
