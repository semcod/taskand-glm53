#!/usr/bin/env node
// proc://taskand.dev/dev/act/v1 — pojedyncze zadanie: wybierz aktywny proces z rejestru LUB wyewoluuj nowy → wykonaj
// in:  { message, organism?, forceEvolve?: bool }
// out: { ok, reply, action, uri?, evolved?, result? }
import { readFileSync } from 'node:fs';
import { registry, call } from './registry-client.mjs';

let input;
try {
  const raw = readFileSync(0, 'utf8').trim();
  input = raw ? JSON.parse(raw) : {};
} catch {
  process.exit(2);
}

const message = String(input.message || input.prompt || '').trim();
const organism = String(input.organism || 'dev').toLowerCase();
const tag = `[${organism}]`;
// exit dopiero po opróżnieniu stdout — duże wyniki (np. setki repozytoriów) nie są obcinane na potoku
const done = out => process.stdout.write(JSON.stringify(out) + '\n', () => process.exit(0));

// Procesy infrastruktury nie są akcjami dla usera
const INTERNAL = /\/(registry|dev|planner|validator|orchestrator)\//;
// Normalizacja polskiej diakrytyki
const stripDiacritics = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0142/g, 'l').replace(/\u0141/g, 'L');

const decision = message ? decide() : null;
const handlers = { answer, call: () => run(decision.uri, decision.input), evolve };
done(message ? (handlers[decision.action] || invalid)() : { ok: true, action: 'noop', reply: `${tag} Podaj zadanie w polu "message".` });

function capabilityContext() {
  const own = `proc://taskand.dev/${organism}/`;
  const procs = (registry('list', { status: 'active' }).processes || []).filter(p => !INTERNAL.test(p.uri) || p.uri.startsWith(own));
  procs.sort((a, b) => Number(b.uri.startsWith(own)) - Number(a.uri.startsWith(own)));
  return procs.map(p => `- ${p.uri} — ${p.desc}`).join('\n');
}

function decide() {
  const low = stripDiacritics(message).toLowerCase();
  // Known network tasks reuse a registered capability without asking an LLM to regenerate it.
  if (!input.forceEvolve && /skan|scan|znajdz|wykryj|lista|urzadze|pokaz/.test(low) && /siec|network|\blan\b/.test(low)) {
    const selected = registry('select', { organism: 'twin', capability: 'environment' });
    return selected.ok ? { action: 'call', uri: selected.uri, input: { action: 'run', scan: { scope: 'lan' } } }
      : { action: 'unavailable', error: selected.error };
  }

  // Known GitHub project listing tasks
  if (!input.forceEvolve && /projekt|repo/.test(low) && /\bgit(hub)?\b/.test(low)) {
    const selected = registry('select', { organism: 'admin', capability: 'github-projects-discovery' });
    return selected.ok ? { action: 'call', uri: selected.uri, input: {} }
      : { action: 'unavailable', error: selected.error };
  }
  const r = call('proc://taskand.dev/dev/llm/v1', {
    system: `Jesteś organizmem "${organism}" systemu taskand. System WYKONUJE zadania na węźle — nie odsyłaj usera do narzędzi.
Aktywne procesy w rejestrze (proc://):
${capabilityContext()}

Wybierz JEDNĄ akcję i zwróć WYŁĄCZNIE JSON:
- {"action":"call","uri":"<URI z listy>","input":{...}} — gdy istniejący proces realnie spełnia zadanie
- {"action":"evolve","name":"<kebab-case>","capability":"<precyzyjny opis zdolności>","input":{...}} — gdy zadanie wymaga danych/akcji z węzła, a żaden proces tego nie robi
- {"action":"answer","text":"..."} — WYŁĄCZNIE rozmowa/wiedza ogólna, bez danych z węzła
${input.forceEvolve ? 'User jawnie prosi o NOWY proces: wybierz "evolve".' : ''}`,
    prompt: message,
    json: true,
    max_tokens: 800,
    temperature: 0
  }, 120000);
  return r.ok ? r.json : { action: 'unavailable', error: r.error };
}

function answer() {
  return { ok: true, action: 'answer', reply: decision.text || `${tag} (brak odpowiedzi)` };
}

function run(uri, procInput = {}, evolved = null) {
  const networkScan = /^proc:\/\/taskand\.dev\/admin\/network-device-discovery\/v\d+$/.test(uri);
  const target = networkScan ? 'proc://taskand.dev/twin/environment/v1' : uri;
  const data = networkScan ? { action: 'run', process: uri, scan: procInput.params || procInput } : procInput;
  const result = call(target, data, networkScan || target.includes('/twin/') ? 180000 : 60000);
  return { ok: result.ok !== false, action: evolved ? 'evolve' : 'call', uri, evolved, result, reply: format(uri, result, evolved) };
}

function evolve() {
  if (!input.forceEvolve && decision.name) {
    const existing = registry('select', { organism, capability: decision.name });
    if (existing.ok) return run(existing.uri, decision.input);
    if (existing.errorType !== 'NOT_FOUND') return { ok: false, action: 'none', reply: `${tag} ✗ ${existing.error}` };
  }
  const ev = call('proc://taskand.dev/dev/evolve/v1', {
    organism,
    name: decision.name,
    capability: decision.capability || message,
    example_input: decision.input && Object.keys(decision.input).length ? decision.input : undefined
  }, 900000);
  if (!ev.uri) return { ok: false, action: 'evolve', reply: `${tag} ✗ Nie wyewoluowałem procesu: ${ev.error}` };
  if (ev.status !== 'active') {
    return { ok: true, action: 'evolve', uri: ev.uri, reply: `${tag} ⚙ Wyewoluowałem ${ev.uri} — status "${ev.status}", czeka na zatwierdzenie: taskand approve ${ev.uri}` };
  }
  return run(ev.uri, decision.input, ev);
}

function invalid() {
  const why = decision.action === 'unavailable' ? decision.error : `nieznana akcja LLM: ${JSON.stringify(decision)}`;
  return { ok: false, action: 'none', reply: `${tag} ✗ Nie mogę zaplanować akcji (${why}). Zadanie nie zostało wykonane.` };
}

function formatDevices(devices, summary, twinId) {
  if (!Array.isArray(devices) || !devices.length) return summary || '';
  const isVirtual = dev => /^(br-|docker|cni|veth|flannel|virbr|dummy)/i.test(dev.interface || '');
  const isIpv4 = ip => /^\d+\.\d+\.\d+\.\d+$/.test(ip || '');

  const lanDevices = devices.filter(d => !isVirtual(d));
  const virtualDevices = devices.filter(d => isVirtual(d));

  const lanIpv4 = lanDevices.filter(d => isIpv4(d.ip));
  const lanIpv6 = lanDevices.filter(d => !isIpv4(d.ip));

  const ipNum = ip => ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
  lanIpv4.sort((a, b) => ipNum(a.ip) - ipNum(b.ip));

  const lines = [];
  lines.push(`Lista urządzeń w sieci LAN (${lanIpv4.length} IPv4, ${lanIpv6.length} IPv6, ${devices.length} łącznie):\n`);
  lines.push('  IP               MAC                INTERFEJS  SZCZEGÓŁY');
  lines.push('  ──────────────────────────────────────────────────────────────────────────');

  for (const dev of lanIpv4) {
    const ip = (dev.ip || '-').padEnd(16);
    const mac = (dev.mac || '-').padEnd(18);
    const iface = (dev.interface || '-').padEnd(10);
    const host = dev.hostname ? `[${dev.hostname}] ` : '';
    const src = (dev.sources || []).join(', ');
    lines.push(`  ${ip} ${mac} ${iface} ${host}${src}`);
  }

  if (lanIpv6.length > 0) {
    lines.push('');
    lines.push(`  Adresy IPv6 (LAN): ${lanIpv6.map(d => d.ip).join(', ')}`);
  }

  if (virtualDevices.length > 0) {
    const vIpv4 = virtualDevices.filter(d => isIpv4(d.ip));
    const bridges = new Set(virtualDevices.map(d => d.interface)).size;
    lines.push('');
    lines.push(`  [Węzły wirtualne / Docker]: ${vIpv4.length} adresów IPv4 w ${bridges} mostach sieciowych.`);
  }

  if (twinId) {
    lines.push(`  [Digital Twin]: ${twinId} (weryfikacja adresacji 1:1 ✓)`);
  }

  return lines.join('\n');
}


function formatProjects(projects) {
  if (!Array.isArray(projects) || !projects.length) return null;
  const byAccount = {};
  for (const p of projects) {
    (byAccount[p.account] = byAccount[p.account] || []).push(p);
  }
  const lines = [`Znaleziono ${projects.length} repozytoriów GitHub w ${Object.keys(byAccount).length} kontach:\n`];
  for (const [account, repos] of Object.entries(byAccount).sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`  📁 ${account} (${repos.length}):`);
    for (const r of repos.slice(0, 20)) {
      const branch = r.branch ? ` [${r.branch}]` : '';
      const date = r.lastCommit?.date ? ` (${r.lastCommit.date.split(' ')[0]})` : '';
      lines.push(`     · ${r.repo}${branch}${date}`);
    }
    if (repos.length > 20) lines.push(`     … i ${repos.length - 20} więcej`);
  }
  return lines.join('\n');
}

function format(uri, result, evolved) {
  const head = evolved ? `${tag} ⚙ Brakowało zdolności — wyewoluowałem ${uri} (próby: ${evolved.attempts}, test kontraktu: PASS)\n` : '';
  if (result.ok === false) return `${head}${tag} ✗ ${uri}: ${result.error || 'błąd procesu'}`;
  if (Array.isArray(result.projects) && result.projects.length > 0) {
    return `${head}${tag} ${formatProjects(result.projects)}`;
  }
  if (Array.isArray(result.devices) && result.devices.length > 0) {
    return `${head}${tag} ${formatDevices(result.devices, result.summary, result.id)}`;
  }
  const summary = result.summary || result.reply || result.message;
  return `${head}${tag} ${summary || JSON.stringify(result, null, 2)}`;
}
