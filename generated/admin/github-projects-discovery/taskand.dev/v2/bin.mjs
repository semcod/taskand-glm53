#!/usr/bin/env node
// proc://taskand.dev/admin/github-projects-discovery/v2
// Skanuje searchRoots w poszukiwaniu repozytoriów Git z origin na GitHub.
// input: { searchRoots?: string[] (ścieżki bezwzględne), maxDepth?: 0..6 }
// output: { ok, total, searchRoots, missingRoots, projects: [{ path, url, account, repo, branch, lastCommit }], summary }
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { isAbsolute, join, resolve } from 'node:path';

const HOME = process.env.HOME || '/root';
const DEFAULT_ROOTS = ['github', 'projects', 'repos', 'src'].map(d => join(HOME, d));
const DEFAULT_DEPTH = 3;
const MAX_DEPTH = 6;
const SKIP = new Set(['node_modules', 'vendor', 'dist', 'venv', '__pycache__']);

const readText = file => { try { return readFileSync(file, 'utf8'); } catch { return null; } };

function parseParams(params) {
  const roots = params.searchRoots ?? DEFAULT_ROOTS;
  if (!Array.isArray(roots) || !roots.length || roots.some(r => typeof r !== 'string' || !isAbsolute(r))) {
    throw new Error('searchRoots musi być niepustą tablicą ścieżek bezwzględnych');
  }
  const maxDepth = params.maxDepth ?? DEFAULT_DEPTH;
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > MAX_DEPTH) {
    throw new Error(`maxDepth musi być liczbą całkowitą 0..${MAX_DEPTH}`);
  }
  return { roots: roots.map(r => resolve(r)), maxDepth };
}

// Worktree ma plik .git wskazujący gitdir; config leży we wspólnym katalogu (commondir)
function gitDirs(dir) {
  const dotGit = join(dir, '.git');
  let gitDir = dotGit;
  if (statSync(dotGit).isFile()) {
    const ref = readText(dotGit)?.match(/gitdir:\s*(.+)/);
    if (!ref) return null;
    gitDir = resolve(dir, ref[1].trim());
  }
  const common = readText(join(gitDir, 'commondir'));
  return { gitDir, commonDir: common ? resolve(gitDir, common.trim()) : gitDir };
}

function parseGitHubUrl(url) {
  const m = url.match(/github\.com(?::\d+)?[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? { account: m[1], repo: m[2] } : null;
}

function originUrl(commonDir) {
  const config = readText(join(commonDir, 'config'));
  return config?.match(/\[remote "origin"\][^[]*?url\s*=\s*(.+)/)?.[1].trim() || null;
}

function branchOf(gitDir) {
  const head = readText(join(gitDir, 'HEAD'))?.trim();
  if (!head) return null;
  return head.startsWith('ref: refs/heads/') ? head.slice('ref: refs/heads/'.length) : 'detached';
}

function lastCommit(dir) {
  try {
    const log = execFileSync('git', ['-C', dir, 'log', '-1', '--format=%H|%ai|%s'], {
      encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    const [hash, date, ...msg] = log.split('|');
    return hash ? { hash: hash.slice(0, 12), date, message: msg.join('|').slice(0, 120) } : null;
  } catch { return null; }
}

function inspect(dir) {
  const dirs = gitDirs(dir);
  const url = dirs && originUrl(dirs.commonDir);
  const gh = url && parseGitHubUrl(url);
  if (!gh) return null;
  // URL budowany od nowa: poświadczenia wpisane w origin nie trafiają na wyjście
  return { path: dir, url: `https://github.com/${gh.account}/${gh.repo}`, account: gh.account, repo: gh.repo,
    branch: branchOf(dirs.gitDir), lastCommit: lastCommit(dir) };
}

function scan(dir, depth, maxDepth, found) {
  if (existsSync(join(dir, '.git'))) {
    const project = inspect(dir);
    if (project) found.set(dir, project);
  }
  if (depth >= maxDepth) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    // Ukryte katalogi (w tym .git i .worktrees) oraz dowiązania pomijane — brak pętli i duplikatów
    if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
    scan(join(dir, entry.name), depth + 1, maxDepth, found);
  }
}

function discover(params) {
  const { roots, maxDepth } = parseParams(params);
  const searchRoots = roots.filter(r => existsSync(r) && statSync(r).isDirectory());
  const found = new Map();
  for (const root of searchRoots) scan(root, 0, maxDepth, found);
  const projects = [...found.values()].sort((a, b) =>
    `${a.account}/${a.repo}`.localeCompare(`${b.account}/${b.repo}`) || a.path.localeCompare(b.path));
  return { ok: true, total: projects.length, searchRoots, missingRoots: roots.filter(r => !searchRoots.includes(r)), maxDepth, projects,
    summary: `Znaleziono ${projects.length} repozytoriów GitHub w ${searchRoots.length} katalogach źródłowych (głębokość ${maxDepth}).` };
}

let out;
try {
  const input = JSON.parse(readFileSync(0, 'utf8').trim() || '{}');
  out = discover(input.params || input);
} catch (err) { out = { ok: false, errorType: 'GITHUB_DISCOVERY_FAILED', error: err.message }; }
process.stdout.write(JSON.stringify(out) + '\n');
