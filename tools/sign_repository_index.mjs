// Offline publisher tool, never included in a source package or the host SDK.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import path from 'node:path';
import {canonicalJson,verifyPackage} from './package_format.mjs';
const args = process.argv.slice(2), option = name => { const at = args.indexOf(name); return at < 0 ? null : args[at+1]; };
const repository = option('--repo')?.toLowerCase(), serial = Number(option('--serial')),
  tag = option('--tag'), file = option('--package'), keyFile = option('--key'), output = option('--output') ?? 'dist';
if (!repository || !/^[a-z0-9-]+\/[a-z0-9_.-]+$/u.test(repository) || repository.length > 140 ||
    !Number.isSafeInteger(serial) || serial < 1 || !tag || tag.length > 256 || /[\x00-\x1f\x7f]/u.test(tag) || !file || !keyFile)
  throw Error('Usage: node tools/sign_repository_index.mjs --repo owner/repo --serial POSITIVE_INCREASING_INTEGER --tag TAG --package FILE.mlsource --key PRIVATE.pem [--output DIR] [--generated-at UTC]');
const key = createPrivateKey(await readFile(keyFile));
if (key.asymmetricKeyType !== 'ed25519') throw Error('Index key must be Ed25519.');
const publicKey = createPublicKey(key), archive = await readFile(file),
  manifest = verifyPackage(archive,publicKey.export({type:'spki',format:'der'}).subarray(-32));
const generated = option('--generated-at') ? new Date(option('--generated-at')) : new Date();
if (!Number.isFinite(generated.getTime())) throw Error('Invalid generated-at timestamp.');
generated.setUTCMilliseconds(0);
const timestamp = date => date.toISOString().replace('.000Z','Z'),
  channel = manifest.version.split('+')[0].includes('-') ? 'prerelease' : 'stable';
const body = {
  schemaVersion:1, repositoryId:repository, serial,
  generatedAt:timestamp(generated), expiresAt:timestamp(new Date(generated.getTime()+30*86400000)),
  publisherKeyId:manifest.publisherKeyId, channel,
  packages:[{
    extensionId:manifest.extensionId, version:manifest.version, releaseTag:tag,
    assetName:path.basename(file), size:archive.length, sha256:createHash('sha256').update(archive).digest('hex'),
    sourceApiVersion:manifest.sourceApiVersion, minRuntimeAbi:manifest.minRuntimeAbi,
    minAppVersion:manifest.minAppVersion, sourceIds:manifest.sources.map(source => source.id), channel,
  }],
};
const bytes = Buffer.from(canonicalJson(body)), message = Buffer.concat([Buffer.from('MangaLaunch source repository v1\n'),bytes]),
  signature = sign(null,message,key);
if (bytes.length > 131072 || !verify(null,message,publicKey,signature)) throw Error('Index verification failed.');
await mkdir(output,{recursive:true});
await writeFile(path.join(output,'extensions-index.json'),bytes);
await writeFile(path.join(output,'extensions-index.ed25519'),signature);
console.log(`Signed repository index serial ${serial}; ${body.packages.length} package(s). Private key bytes are not printed.`);
