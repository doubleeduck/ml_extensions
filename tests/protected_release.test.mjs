import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

test('release needs only its workflow commit and tag, not a manually approved SHA', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mlsource-release-guard-'));
  const script = fileURLToPath(new URL('../tools/protected_release.mjs', import.meta.url));
  // Isolate Git config/hooks and do not expose a real signing key to the child.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(?:GIT_|GITHUB_|MLSOURCE_|RELEASE_VERSION$)/u.test(key)));
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = path.join(root, 'no-global-config');
  function git(...args) {
    const result = spawnSync('git', ['-c', 'core.hooksPath=disabled-hooks',
      '-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', ...args],
    {cwd: root, env, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  function release(commit) {
    return spawnSync(process.execPath, [script], {cwd: root, encoding: 'utf8',
      env: {...env, RELEASE_VERSION: '1.2.3', GITHUB_SHA: commit}});
  }
  try {
    git('init', '--quiet');
    git('-c', 'user.name=Release fixture', '-c', 'user.email=fixture@example.invalid',
      'commit', '--allow-empty', '--quiet', '-m', 'Release fixture');
    const commit = git('rev-parse', 'HEAD');
    git('tag', 'v1.2.3');
    const valid = release(commit);
    assert.notEqual(valid.status, 0); // Deliberately no signing credentials.
    assert.match(valid.stderr, /Configure the protected publisher signing secret\/key ID/u);
    const mismatch = release('0'.repeat(40));
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /release tag must point at the workflow commit/u);
    const invalid = release('not-a-commit');
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /valid workflow commit SHA is required/u);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
