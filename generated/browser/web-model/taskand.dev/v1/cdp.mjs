import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

// Chromium is the only process in this sandbox: no host home, project, sockets or network.
// CDP uses inherited pipes; all web responses must be supplied by the parent transport.
export function launchBrowser() {
  const executable = '/opt/google/chrome/chrome';
  if (!existsSync(executable)) throw new Error('Wymagany Google Chrome w /opt/google/chrome/chrome');
  const args = ['--unshare-all', '--die-with-parent', '--new-session', '--clearenv',
    '--ro-bind', '/usr', '/usr', '--ro-bind', '/lib', '/lib', '--ro-bind', '/lib64', '/lib64',
    '--ro-bind', '/opt/google/chrome', '/opt/google/chrome', '--ro-bind', '/etc/fonts', '/etc/fonts',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--dir', '/home/twin',
    '--setenv', 'HOME', '/home/twin', '--setenv', 'PATH', '/usr/bin:/bin', '--setenv', 'LANG', 'C.UTF-8',
    '--cap-drop', 'ALL', executable, '--headless=new', '--no-sandbox', '--disable-gpu',
    '--disable-background-networking', '--disable-component-update', '--disable-extensions',
    '--disable-sync', '--disable-breakpad', '--disable-crash-reporter', '--no-first-run',
    '--no-default-browser-check', '--user-data-dir=/tmp/chrome', '--remote-debugging-pipe', 'about:blank'];
  const child = spawn('bwrap', args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH } });
  let seq = 0, buffer = '', errors = '', closed = false;
  const pending = new Map(), listeners = new Map();
  child.stderr.on('data', b => { errors = (errors + b).slice(-2500); });
  const fail = error => { closed = true; for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); };
  child.once('error', fail);
  child.once('exit', code => fail(new Error(`Chromium/bwrap zakończony (${code}): ${errors}`)));
  child.stdio[3].on('error', fail);
  child.stdio[4].on('data', data => {
    buffer += data.toString();
    let at;
    while ((at = buffer.indexOf('\0')) >= 0) {
      const part = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      if (!part) continue;
      let message; try { message = JSON.parse(part); } catch { continue; }
      if (message.id) {
        const p = pending.get(message.id);
        if (!p) continue;
        clearTimeout(p.timer); pending.delete(message.id);
        if (message.error) p.reject(new Error(message.error.message)); else p.resolve(message.result);
      } else for (const listener of listeners.get(message.method) || []) listener(message.params, message.sessionId);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (closed) return reject(new Error(`Chromium niedostępny: ${errors}`));
    const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
  const on = (method, listener) => listeners.set(method, [...(listeners.get(method) || []), listener]);
  const close = async () => {
    if (!closed) { try { await send('Browser.close'); } catch {} child.kill('SIGKILL'); }
  };
  return { send, on, close };
}
