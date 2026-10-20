import {generateKeyPairSync,createHash} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {manifestDefinition,registrations} from '../src/definitions.mjs';
import {signedManifest,packageZip,verifyPackage} from './package_format.mjs';
const root = fileURLToPath(new URL('../',import.meta.url));
const args = process.argv.slice(2), value = name => { const index = args.indexOf(name); return index === -1 ? null : args[index+1]; };
if (args.includes('--generate-key')) {
  const destination = value('--generate-key'); if (!destination) throw Error('Specify a private output path (never commit it).');
  const {privateKey,publicKey} = generateKeyPairSync('ed25519'); await mkdir(path.dirname(path.resolve(destination)),{recursive:true});
  await writeFile(destination,privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});
  await writeFile(`${destination}.public.json`,JSON.stringify({keyId:value('--key-id') ?? 'mangalaunch-official-2026',publicKey:publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64')},null,2)+'\n',{flag:'wx'});
  console.log('Generated Ed25519 signing key. Private bytes are not printed.');
} else {
  const keyFile = value('--key'), keyId = value('--key-id'), output = value('--output') ?? path.join(root,'dist','official.mangalaunch.sources.mlsource'), version = value('--version') ?? '1.0.0';
  if (!keyFile || !keyId || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) throw Error('Usage: node tools/pack.mjs --key PRIVATE.pem --key-id ID --version SEMVER [--output PATH]');
  const payloads = new Map();
  async function collect(directory) {
    for (const entry of await readdir(directory,{withFileTypes:true})) {
      const file = path.join(directory,entry.name); if (entry.isSymbolicLink()) throw Error('Payload symlinks are not allowed.');
      if (entry.isDirectory()) await collect(file);
      else if (entry.name.endsWith('.mjs') && entry.name !== 'definitions.mjs') payloads.set(path.relative(root,file).replaceAll('\\','/'),await readFile(file));
    }
  }
  await collect(path.join(root,'src')); payloads.set('LICENSE',await readFile(path.join(root,'LICENSE')));
  payloads.set('assets/icon.png',await readFile(path.join(root,'assets/icon.png')));
  for (const [name,bytes] of payloads) if (name.endsWith('.mjs') && /\b(?:from|import)\s*\(?\s*['"](?:node:|https?:|file:)/u.test(bytes.toString('utf8'))) throw Error('Package runtime must not import Node/network/filesystem modules.');
  const signed = signedManifest(manifestDefinition({version,publisherKeyId:keyId}),payloads,await readFile(keyFile));
  const archive = packageZip(new Map([['manifest.json',signed.bytes],['signature.ed25519',signed.signature],...payloads]));
  const manifest = verifyPackage(archive,signed.publicKey);
  const expectedIds = registrations.map(source => source.id).sort(), actualIds = manifest.sources.map(source => source.id).sort();
  if (new Set(actualIds).size !== actualIds.length || JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) throw Error('Official bundle must preserve every registered source ID.');
  await mkdir(path.dirname(path.resolve(output)),{recursive:true}); await writeFile(output,archive);
  await writeFile(`${output}.public.json`,JSON.stringify({keyId,publicKey:signed.publicKey.toString('base64'),extensionIds:[manifest.extensionId],sourceIds:manifest.sources.map(source => source.id)},null,2)+'\n');
  await writeFile(`${output}.sha256`,`${createHash('sha256').update(archive).digest('hex')}  ${path.basename(output)}\n`);
  console.log(`Verified ${manifest.sources.length} sources / ${payloads.size} payload files / ${archive.length} bytes. Output: ${path.resolve(output)}`);
}
