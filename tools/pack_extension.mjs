// Developer CLI only. Never included in a .mlsource or evaluated by the app.
import {createHash} from 'node:crypto';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {signedManifest,packageZip,verifyPackage} from './package_format.mjs';
const args = process.argv.slice(2), option = name => { const at = args.indexOf(name); return at < 0 ? null : args[at+1]; };
const project = option('--project'), key = option('--key'), keyId = option('--key-id'), output = option('--output');
if (!project || !key || !keyId || !output) throw Error('Usage: node tools/pack_extension.mjs --project DIR --key PRIVATE.pem --key-id ID --output FILE.mlsource');
const root = path.resolve(project), manifest = JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
if (!Array.isArray(manifest.sources) || !manifest.sources.length || manifest.sources.length > 64 || new Set(manifest.sources.map(source => source.id)).size !== manifest.sources.length) throw Error('Manifest needs 1..64 distinct source IDs.');
manifest.publisherKeyId = keyId;
const payloads = new Map();
async function collect(relative) {
  for (const entry of await readdir(path.join(root,relative),{withFileTypes:true})) {
    const name = `${relative}/${entry.name}`, file = path.join(root,name);
    if (entry.isSymbolicLink()) throw Error('Payload symlinks are forbidden.');
    if (entry.isDirectory()) await collect(name);
    else {
      if (!/\.(?:mjs|js|json|png|jpg|jpeg|webp|svg|txt)$/u.test(name)) throw Error('Only declared source/data/image assets are supported.');
      const bytes = await readFile(file);
      if (/\.(?:mjs|js)$/u.test(name) && /\b(?:from|import)\s*\(?\s*['"](?:node:|https?:|file:)/u.test(bytes.toString('utf8'))) throw Error('Source code must not import Node, URL or filesystem modules.');
      payloads.set(name,bytes);
    }
  }
}
await collect('src');
try { await collect('assets'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
payloads.set('LICENSE',await readFile(path.join(root,'LICENSE')));
if (!payloads.has(manifest.entrypoint)) throw Error('Entrypoint is not packaged.');
const signed = signedManifest(manifest,payloads,await readFile(key));
const archive = packageZip(new Map([['manifest.json',signed.bytes],['signature.ed25519',signed.signature],...payloads]));
const verified = verifyPackage(archive,signed.publicKey);
await mkdir(path.dirname(path.resolve(output)),{recursive:true});
await writeFile(output,archive);
await writeFile(`${output}.public.json`,JSON.stringify({keyId,publicKey:signed.publicKey.toString('base64'),extensionIds:[verified.extensionId]},null,2)+'\n');
await writeFile(`${output}.sha256`,`${createHash('sha256').update(archive).digest('hex')}  ${path.basename(output)}\n`);
console.log(`Signed ${verified.sources.length} source(s). The application still validates schema, trust, hashes and sandbox health.`);
