import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const policy = JSON.parse(readFileSync(new URL('./git-policy.json', import.meta.url), 'utf8'));
export function violation(path, bytes) {
  const p = path.toLowerCase();
  if (bytes > (policy.allow[path] ?? policy.maxBytes)) return 'file exceeds size limit';
  if (/(^|\/)(\.env(?:\..*)?|\.npmrc|\.netrc|credentials(?:\..*)?|id_rsa|id_ed25519|agent-api.*\.json)$/.test(p) || /\.(pem|key|p12|pfx|keystore)$/.test(p) || /(^|\/)(\.aws|\.ssh|\.codex|\.agents)\//.test(p)) return 'private configuration or credential file';
  if (policy.allow[path] !== undefined || policy.fixtures.includes(path)) return undefined;
  if (/^tests\/fixtures\//.test(p) && !p.endsWith('.md')) return 'fixture needs an explicit policy entry';
  if (/^(docs\/(screenshots|verification)\/)/.test(p) && !p.endsWith('.md')) return 'generated verification output';
  if (/^(\.test-data|test-results|playwright-report|coverage|node_modules|dist|dist-electron|release|backups|projects|user-data|frontiers-v\d+)\//.test(p) || /^demo\/.*\.json$/.test(p) || /^docs\/.*(?:last-run|checks-summary|evidence-index)/.test(p) || /(^|\/)(?:local\.config\.[^/]+|\.env[^/]*|[^/]+\.local\.[^/]+)$/.test(p)) return 'generated or local data';
  if (/\.(ttf|otf|woff2?|eot|zip|7z|rar|log|tmp|bak|db|sqlite3?|png|jpe?g|webp|gif|mp3|mp4|pptx|pdf)$/.test(p)) return 'binary resource needs an explicit runtime allowlist entry';
}
const git = (...args) => execFileSync('git', args, { maxBuffer: 128 * 1024 * 1024 });
const split = b => b.toString('utf8').split('\0').filter(Boolean);
function check(ref, paths) {
  const errors = [];
  for (const path of paths) {
    const blob = ref === ':' ? ':' + path : ref + ':' + path;
    const size = Number(git('cat-file', '-s', blob).toString());
    const reason = violation(path, size);
    if (reason) { errors.push(`${path}: ${reason} (${size} bytes)`); continue; }
    if (size < policy.maxBytes && /\.(?:[cm]?[jt]sx?|json|ya?ml|md|txt|sh|cmd|toml|ini|cfg|properties)$/.test(path)) {
      const content = git('cat-file', 'blob', blob).toString('utf8');
      if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9]{32,})\b/.test(content)) errors.push(`${path}: credential-like content`);
    }
  }
  if (errors.length) throw Error(errors.join('\n'));
}
function run(mode) {
  if (mode === 'staged') check(':', split(git('diff', '--cached', '--name-only', '--diff-filter=ACMRT', '-z')));
  else if (mode === 'tracked') check(':', split(git('ls-files', '-z')));
  else if (mode === 'push') {
    const input = readFileSync(0, 'utf8').trim();
    const seen = new Set();
    for (const line of input.split('\n').filter(Boolean)) {
      const [, local, , remote] = line.trim().split(/\s+/);
      if (/^0+$/.test(local)) continue;
      // Existing historical blobs are deliberately grandfathered: no history rewrite.
      const args = /^0+$/.test(remote) ? [local, '--not', '--remotes'] : [`${remote}..${local}`];
      const commits = git('rev-list', ...args).toString().trim().split('\n').filter(Boolean);
      for (const commit of commits) {
        if (seen.has(commit)) continue;
        seen.add(commit);
        const paths = split(git('diff-tree', '--root', '-m', '--no-commit-id', '--name-only', '--diff-filter=ACMRT', '-r', '-z', commit));
        check(commit, [...new Set(paths)]);
      }
      // Also examine the final tree: a new remote/branch must not regain removed artifacts.
      check(local, split(git('ls-tree', '-r', '--name-only', '-z', local)));
    }
  } else throw Error('Expected staged, tracked or push');
  console.log(`Git guard passed (${mode}).`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { run(process.argv[2]); } catch (error) { console.error(`Git guard blocked:\n${error.message}`); process.exitCode = 1; }
}
