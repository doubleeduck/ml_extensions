import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, verify} from 'node:crypto';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {canonicalJson, verifyPackage} from '../tools/package_format.mjs';
import {registrations,manifestDefinition} from '../src/definitions.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const hasShell = spawnSync(shell, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], {timeout: 15000}).status === 0;

test('build-package.ps1 produces all five public release assets, independently verified and reproducible', {skip: !hasShell, timeout: 60000}, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mlsource-release-cli-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const {privateKey, publicKey} = generateKeyPairSync('ed25519');
  const key = path.join(directory, 'test-only.pem');
  await writeFile(key, privateKey.export({type: 'pkcs8', format: 'pem'}), {mode: 0o600});
  const output = path.join(directory, 'release with spaces', 'official.mangalaunch.sources.mlsource');
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'build-package.ps1'),
    '-KeyPath', key, '-KeyId', 'isolated-test-key', '-Version', '1.2.3-dev.1', '-OutputPath', output,
    '-Repository', 'Example/Official-Sources', '-IndexSerial', '42'];
  const run = () => spawnSync(shell, args, {cwd: root, encoding: 'utf8', timeout: 45000, windowsHide: true});
  let result = run();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(!result.stdout.includes('PRIVATE KEY'));
  assert.deepEqual((await readdir(path.dirname(output))).sort(), [
    'extensions-index.ed25519', 'extensions-index.json', path.basename(output),
    `${path.basename(output)}.public.json`, `${path.basename(output)}.sha256`,
  ].sort());
  const archive = await readFile(output), publicRecord = JSON.parse(await readFile(`${output}.public.json`, 'utf8'));
  const manifest = verifyPackage(archive, Buffer.from(publicRecord.publicKey, 'base64'));
  assert.equal(manifest.version, '1.2.3-dev.1');
  assert.equal(manifest.publisherKeyId, 'isolated-test-key');
  assert.equal(new Set(manifest.sources.map(s => s.id)).size, 20);
  assert.equal(manifest.extensionId, manifestDefinition({version:'1.0.0',publisherKeyId:'fixture'}).extensionId);
  assert.deepEqual(manifest.sources.map(s=>s.id),registrations.map(s=>s.id));
  assert.ok(manifest.sources.every(s=>s.isNsfw===false));
  assert.deepEqual(publicRecord.sourceIds, manifest.sources.map(s => s.id));
  assert.deepEqual(publicRecord.extensionIds, [manifest.extensionId]);
  const digest = createHash('sha256').update(archive).digest('hex');
  assert.equal(await readFile(`${output}.sha256`, 'utf8'), `${digest}  ${path.basename(output)}\n`);
  const bytes = await readFile(path.join(path.dirname(output), 'extensions-index.json'));
  const index = JSON.parse(bytes.toString('utf8'));
  assert.equal(bytes.toString(), canonicalJson(index));
  assert.equal(index.repositoryId, 'example/official-sources');
  assert.equal(index.serial, 42);
  assert.equal(index.channel, 'prerelease');
  assert.equal(new Date(index.expiresAt) - new Date(index.generatedAt), 30 * 86400000);
  assert.equal(index.packages[0].sha256, digest);
  assert.equal(index.packages[0].size, archive.length);
  assert.equal(index.packages[0].releaseTag, 'v1.2.3-dev.1');
  const signature = await readFile(path.join(path.dirname(output), 'extensions-index.ed25519'));
  assert.equal(signature.length, 64);
  const message = Buffer.concat([Buffer.from('MangaLaunch source repository v1\n'), bytes]);
  assert.equal(verify(null, message, publicKey, signature), true);
  const corrupt = Buffer.from(message); corrupt[corrupt.length - 2] ^= 1;
  assert.equal(verify(null, corrupt, publicKey, signature), false);
  result = run();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(await readFile(output), archive);
});

test('build-package.ps1 rejects a missing index serial before producing a release', {skip: !hasShell}, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mlsource-release-invalid-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const key = path.join(directory, 'not-a-key.pem');
  await writeFile(key, 'not a private key');
  const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'build-package.ps1'),
    '-KeyPath', key, '-KeyId', 'test', '-Version', '1.0.0', '-Repository', 'o/r', '-OutputPath', path.join(directory, 'output.mlsource')],
  {encoding: 'utf8', timeout: 15000, windowsHide: true});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /positive IndexSerial/u);
  assert.deepEqual(await readdir(directory), ['not-a-key.pem']);
});
