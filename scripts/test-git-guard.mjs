import './test-data.mjs';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const root = mkdtempSync(resolve('.test-data/git-guard-'));
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
mkdirSync(join(root, 'scripts'));
mkdirSync(join(root, '.githooks'));
for (const p of ['scripts/git-guard.mjs', 'scripts/git-policy.json', '.githooks/pre-commit', '.githooks/pre-push']) copyFileSync(p, join(root, p));
git('init');
git('config', 'user.name', 'Isolated guard test');
git('config', 'user.email', 'guard@example.invalid');
git('config', 'core.hooksPath', '.githooks');
const env = { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: root.replaceAll('\\', '/') };
const guard = (mode, input) => spawnSync(process.execPath, ['scripts/git-guard.mjs', mode], { cwd: root, env, encoding: 'utf8', input });
const put = (p, data) => { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), data); git('add', '--', p); };
put('source.ts', 'export const safe = true;\n');
git('add', 'scripts', '.githooks');
git('commit', '-m', 'safe baseline');
const baseline = git('rev-parse', 'HEAD').trim();
put('docs/verification/test.png', 'artifact');
assert.notEqual(guard('staged').status, 0);
// Real hook rejects even when the working copy has been changed to harmless text.
writeFileSync(join(root, 'docs/verification/test.png'), 'harmless working copy');
assert.throws(() => git('commit', '-m', 'must be blocked'));
writeFileSync(join(root, 'docs/verification/test.png'), 'artifact');
git('rm', '--cached', '--', 'docs/verification/test.png');
for (const [path, value] of [['large.ts', Buffer.alloc(1048577)], ['fonts/unused.ttf', 'font'], ['.env', 'private'], ['credentials.json', '{}'], ['tests/fixtures/unreviewed.json', '{}'], ['key.ts', 'const value = "ghp_' + 'a'.repeat(36) + '";']]) {
  put(path, value);
  assert.notEqual(guard('staged').status, 0, path);
  git('rm', '--cached', '--', path);
}
put('tests/fixtures/v9/initial.json', '{}');
assert.equal(guard('staged').status, 0);
git('commit', '-m', 'allowlisted fixture');
const good = git('rev-parse', 'HEAD').trim();
assert.equal(guard('push', `refs/heads/main ${good} refs/heads/main ${baseline}\n`).status, 0);
// Bypass a local commit hook, then confirm pre-push detects an intermediate bad commit.
put('docs/verification/leak.json', '{}');
git('-c', 'core.hooksPath=', 'commit', '-m', 'bad intermediate');
git('rm', '--cached', '--', 'docs/verification/leak.json');
git('-c', 'core.hooksPath=', 'commit', '-m', 'remove artifact');
const bad = git('rev-parse', 'HEAD').trim();
assert.notEqual(guard('push', `refs/heads/main ${bad} refs/heads/main ${good}\n`).status, 0);
assert.equal(guard('push', `refs/heads/main ${'0'.repeat(40)} refs/heads/main ${good}\n`).status, 0);
assert.equal(guard('push', `refs/heads/new ${good} refs/heads/new ${'0'.repeat(40)}\n`).status, 0);
console.log('PASS: real pre-commit hook, staged blobs, size, font, secret, fixture, new branch, deleted ref and intermediate push checks.');
