// Dispatch dev/chat: organizm/intencja → proces przez rejestr (URI + JSON), bez logiki domenowej
import { call } from './registry-client.mjs';

const P = name => `proc://taskand.dev/${name}/v1`;
const LONG = 900000;
const replyOf = r => r.reply || r.summary || (r.ok === false ? `✗ ${r.error}` : JSON.stringify(r));

export const HANDLERS = {
  twin: ({ text }) => {
    const url = text.match(/https?:\/\/[^\s<>"']+/)?.[0];
    if (url) return replyOf(call(P('twin/web'), { action: 'capture', urls: [url] }, LONG));
    if (/stron|internet|\bapi\b|\bweb\b/i.test(text)) return 'Bliźniak strony/API wymaga URL. Scenariusz z kryteriami wyniku: taskand twin web <plik.json>.';
    return replyOf(call(P('twin/environment'), { action: 'run', scan: { scope: 'lan' } }, LONG));
  },
  'spawn-organism': ({ match }) => replyOf(call(P('dev/spawn'), { organism: match[1].toLowerCase(), capability: match[2] }, LONG)),
  composite: ({ text }) => replyOf(call(P('dev/composite'), { task: text }, LONG)),
  telemetry: () => telemetry(),
  'file-ops': ({ text }) => replyOf(call(P('dev/file-router'), { message: text })),
  'spawn-web': () => webStatus(),
  diagnose: () => diagnose(),
  prescribe: () => prescribe(),
  heal: ({ text }) => replyOf(call(P('doctor/heal'), { run: !/plan|bez wykon|dry/i.test(text) }, LONG)),
  vault: () => replyOf(call(P('vault/secrets'), { action: 'status' })),
  'file-list': ({ text }) => fileList(text),
  browser: ({ text }) => replyOf(call(P('browser/session'), { action: 'open', url: text.match(/https?:\/\/\S+/)?.[0] })),
  // dev/act zwraca obiekt: reply dla człowieka + result dla --format json|yaml|csv
  'evolve-create': ({ text, organism }) => call(P('dev/act'), { message: text, organism, forceEvolve: true }, LONG),
  query: ({ text, organism }) => call(P('dev/act'), { message: text, organism }, LONG),
  organism: ({ text, organism }) => organismChat(text, organism)
};

// Organizm z własnym interfejsem <org>/chat; bez niego dev/act działa w kontekście tego organizmu
function organismChat(text, organism) {
  const r = call(P(`${organism}/chat`), { message: text }, LONG);
  return r.errorType === 'NOT_FOUND' ? call(P('dev/act'), { message: text, organism }, LONG) : r;
}

export function dispatch(intent) {
  return HANDLERS[intent.name](intent);
}

function telemetry() {
  const hw = call(P('hw/monitor'));
  if (hw.ok === false) return `[hw] ✗ ${hw.error}`;
  const sensors = (hw.sensors || []).slice(0, 4).map(s => `${s.sensor}: ${s.temp_c}°C`).join(', ');
  return [
    `[hw] Odczyt czujników (węzeł: ${hw.device}):`,
    `  • Temperatura CPU: ${hw.cpu_temp ?? 'brak odczytu'}°C (${hw.cpu_temp_source || 'n/d'})`,
    `  • Obciążenie CPU: ${hw.cpu_usage_pct ?? 'n/d'}%`,
    `  • Wolne miejsce na dysku: ${hw.disk_free_gb ?? 'n/d'} GB`,
    ...(sensors ? [`  • Czujniki: ${sensors}`] : []),
    `  • Status: ${hw.summary}`
  ].join('\n');
}

function diagnose() {
  const d = call(P('doctor/diagnose'));
  if (!d.details) return `[doctor] ✗ ${d.error}`;
  return [`[doctor] Stan zdrowia: healthy=${d.healthy ? '✓' : '✗'} (${d.passed}/${d.checks})`, ...d.details.map(x => `  · ${x}`)].join('\n');
}

function prescribe() {
  const r = call(P('doctor/prescribe'), {}, 120000);
  if (!r.ok) return `[doctor] ✗ ${r.error}`;
  return [`[doctor] ${r.summary}`, ...r.prescriptions.map(p => `  · [${p.executor}] ${p.finding.code} ${p.finding.subject}: ${p.action || p.why}`)].join('\n');
}

function webStatus() {
  const d = call(P('web/serve'), { action: 'health' });
  return `[web] ${d.summary || d.error}`;
}

function fileList(text) {
  const path = text.match(/(\/[\w.-]+)+/)?.[0];
  const r = call(P('file/ops'), { op: 'list', path });
  if (r.ok === false) return `[file] ✗ ${r.error}`;
  return `[file] ${r.path} (${r.entries.length} pozycji):\n${r.entries.slice(0, 40).map(e => `  ${e.type === 'dir' ? '📁' : '·'} ${e.name}`).join('\n')}`;
}
