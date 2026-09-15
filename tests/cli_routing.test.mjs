import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseIntent } from '../generated/dev/chat/taskand.dev/v1/intent.mjs';

const discovery = 'generated/admin/github-projects-discovery/taskand.dev/v2/bin.mjs';
const runDiscovery = input => JSON.parse(spawnSync('node', [discovery], { input: JSON.stringify(input), encoding: 'utf8', timeout: 20000 }).stdout);
// Gateway celowo nieosiągalny: CLI wykonuje kod z tej kopii repozytorium
const cli = (...args) => spawnSync('node', ['bin/taskand', ...args], {
  encoding: 'utf8', timeout: 20000, env: { ...process.env, TASKAND_GATEWAY: 'http://127.0.0.1:9' }
});

test('intents match with and without Polish diacritics', () => {
  for (const [plain, accented, name] of [
    ['lista urzadzen w sieci', 'lista urządzeń w sieci', 'query'],
    ['sprawdz czy dziala', 'sprawdź czy działa', 'diagnose'],
    ['jaka jest temperatura procesora', 'jaka jest temperatura procesora', 'telemetry'],
    ['wdroz monitoring', 'wdroż monitoring', 'composite'],
    ['zrob skrypt do backupu', 'zrób skrypt do backupu', 'evolve-create']
  ]) {
    assert.equal(parseIntent(plain).name, name, plain);
    assert.equal(parseIntent(accented).name, name, accented);
  }
  assert.equal(parseIntent('co zrobic', 'doc').name, 'prescribe');
  assert.equal(parseIntent('co zrobić', 'doctor').name, 'prescribe');
});

test('spawn-organism capture keeps the original diacritics of the description', () => {
  const intent = parseIntent('stwórz organizm pamiec, który śledzi zużycie pamięci');
  assert.equal(intent.name, 'spawn-organism');
  assert.equal(intent.match[1], 'pamiec');
  assert.equal(intent.match[2], 'śledzi zużycie pamięci');
  assert.equal(parseIntent('stworz organizm backup zeby robil kopie').match[2], 'robil kopie');
});

test('short keywords match whole words only', () => {
  assert.equal(parseIntent('pokaż plan wdrożenia').name, 'composite');
  assert.equal(parseIntent('zbuduj projekt digitalizacji z dashboardem').name, 'composite');
  assert.equal(parseIntent('skanuj LAN').name, 'query');
  assert.equal(parseIntent('lista projektów na GitHub').name, 'query');
  assert.equal(parseIntent('pokaz repozytoria git').name, 'query');
});

test('github discovery reads origins, worktrees and depth without leaking credentials', () => {
  const root = mkdtempSync(join(tmpdir(), 'taskand-gh-'));
  const gitRepo = (dir, config, head = 'ref: refs/heads/main\n') => {
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(join(dir, '.git', 'config'), config);
    writeFileSync(join(dir, '.git', 'HEAD'), head);
  };
  try {
    gitRepo(join(root, 'acme', 'app'), '[core]\n\tbare = false\n[remote "origin"]\n\turl = https://bot:s3cret@github.com/acme/app.git\n');
    gitRepo(join(root, 'acme', 'tool'), '[remote "origin"]\n\turl = git@github.com:acme/tool.git\n', 'ab12cd34\n');
    gitRepo(join(root, 'other'), '[remote "origin"]\n\turl = https://gitlab.com/acme/other.git\n');
    gitRepo(join(root, 'a', 'b', 'c', 'deep'), '[remote "origin"]\n\turl = https://github.com/acme/deep\n');
    gitRepo(join(root, '.hidden', 'repo'), '[remote "origin"]\n\turl = https://github.com/acme/hidden\n');
    // Linked worktree: .git is a file, config lives in the common directory
    const linked = join(root, 'acme', 'app', '.git', 'worktrees', 'feature');
    mkdirSync(linked, { recursive: true });
    writeFileSync(join(linked, 'commondir'), '../..\n');
    writeFileSync(join(linked, 'HEAD'), 'ref: refs/heads/ticket/001-feature\n');
    mkdirSync(join(root, 'feature'));
    writeFileSync(join(root, 'feature', '.git'), `gitdir: ${linked}\n`);

    const out = runDiscovery({ searchRoots: [root, join(root, 'missing')], maxDepth: 3 });
    assert.equal(out.ok, true);
    assert.deepEqual(out.missingRoots, [join(root, 'missing')]);
    assert.deepEqual(out.projects.map(p => [p.url, p.branch]), [
      ['https://github.com/acme/app', 'main'],
      ['https://github.com/acme/app', 'ticket/001-feature'],
      ['https://github.com/acme/tool', 'detached']
    ]);
    assert.doesNotMatch(JSON.stringify(out), /s3cret/);
    assert.equal(runDiscovery({ searchRoots: [root], maxDepth: 4 }).projects.some(p => p.repo === 'deep'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('github discovery fails closed on invalid parameters', () => {
  for (const input of [{ searchRoots: '/etc' }, { searchRoots: [] }, { searchRoots: ['relative'] }, { maxDepth: 7 }, { maxDepth: 1.5 }]) {
    const out = runDiscovery(input);
    assert.equal(out.ok, false, JSON.stringify(input));
    assert.equal(out.errorType, 'GITHUB_DISCOVERY_FAILED');
  }
});

test('cli renders registry output as csv and yaml and rejects unknown formats', () => {
  const csv = cli('procs', 'twin', '--format', 'csv');
  assert.equal(csv.status, 0, csv.stderr);
  assert.match(csv.stdout.split('\n')[0], /(^|,)uri(,|$)/);
  assert.match(csv.stdout, /proc:\/\/taskand\.dev\/twin\/environment\/v1/);
  const yaml = cli('procs', 'twin', '--format=yaml');
  assert.equal(yaml.status, 0, yaml.stderr);
  assert.match(yaml.stdout, /^ok: true$/m);
  assert.match(yaml.stdout, /uri: proc:\/\/taskand\.dev\/twin\/environment\/v1/);
  const bad = cli('procs', '--format', 'xml');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Nieobsługiwany format: xml/);
});

test('universal cli query lists GitHub repositories and keeps large structured results intact', () => {
  const home = mkdtempSync(join(tmpdir(), 'taskand-home-'));
  const total = 700; // wynik dev/act > 128 KiB: wcześniej obcinany przez process.exit() przed opróżnieniem potoku
  try {
    for (let i = 0; i < total; i++) {
      const dir = join(home, 'github', 'acme', `repository-with-a-deliberately-long-name-${String(i).padStart(4, '0')}`, '.git');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'config'), `[remote "origin"]\n\turl = git@github.com:acme/repo-${i}.git\n`);
      writeFileSync(join(dir, 'HEAD'), 'ref: refs/heads/main\n');
    }
    const run = (...args) => spawnSync('node', ['bin/taskand', ...args], {
      encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, HOME: home, TASKAND_GATEWAY: 'http://127.0.0.1:9' }
    });
    const json = run('lista', 'projektow', 'github', '--format', 'json');
    assert.equal(json.status, 0, json.stderr);
    const out = JSON.parse(json.stdout);
    assert.equal(out.intent, 'query');
    assert.equal(out.uri, 'proc://taskand.dev/admin/github-projects-discovery/v2');
    assert.equal(out.result.total, total);
    assert.match(out.reply, new RegExp(`Znaleziono ${total} repozytoriów GitHub w 1 kontach`));
    const csv = run('pokaż repozytoria git', '--format', 'csv').stdout.trim().split('\n');
    assert.equal(csv[0], 'path,url,account,repo,branch,lastCommit');
    assert.equal(csv.length, total + 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
