import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {registrations,sourceDefinitions,manifestDefinition} from '../src/definitions.mjs';
import createSource from '../src/index.mjs';
import {canonicalJson,packageZip,signedManifest,verifyPackage} from '../tools/package_format.mjs';
test('official package registers 30 persistent IDs and its offline factories never perform IO', () => {
  assert.equal(registrations.length,30); assert.equal(new Set(registrations.map(source => source.id)).size,30);
  const deny = () => { throw Error('Factory must not perform IO.'); };
  for (const definition of sourceDefinitions()) {
    assert.equal('_module' in definition,false);
    const source = createSource(Object.freeze({sourceId:definition.id,baseUrl:definition.baseUrl,parameters:Object.freeze(definition.parameters),
      http:{request:deny},html:{extract:deny},settings:{get:deny,set:deny},auth:{getSession:deny,status:deny},log:{info:deny}}));
    for (const method of ['getDetails','getChapters','getPages',...definition.capabilities.filter(value => value !== 'account').map(value => ({browse:'getPopular',latest:'getLatest',search:'search',filters:'getFilters',recommendations:'getRecommendations'}[value]))]) assert.equal(typeof source[method],'function',`${definition.id}: ${method}`);
  }
  assert.throws(() => createSource({sourceId:'missing'}));
});
test('official ZIP/signature payload is reproducible and rejects tampering independently', () => {
  const {privateKey} = generateKeyPairSync('ed25519'), pem = privateKey.export({type:'pkcs8',format:'pem'}), payload = new Map([['src/index.mjs',Buffer.from('export default ()=>({});')]]);
  const signed = signedManifest(manifestDefinition({version:'1.0.0',publisherKeyId:'test-generated'}),payload,pem);
  const files = new Map([['manifest.json',signed.bytes],['signature.ed25519',signed.signature],...payload]), first = packageZip(files), second = packageZip(new Map([...files].reverse()));
  assert.deepEqual(first,second); assert.equal(verifyPackage(first,signed.publicKey).sources.length,30);
  const corrupt = Buffer.from(first); corrupt[40] ^= 1; assert.throws(() => verifyPackage(corrupt,signed.publicKey));
  assert.equal(canonicalJson({z:1,a:{b:2,a:3}}),'{"a":{"a":3,"b":2},"z":1}');
});
test('published runtime graph contains no Node/native/old Dart implementation or private signing key', async () => {
  async function inspect(directory) {
    for (const item of await readdir(directory,{withFileTypes:true})) {
      const file = new URL(`${item.name}${item.isDirectory() ? '/' : ''}`,directory);
      if (item.isDirectory()) await inspect(file);
      else { const source = await readFile(file,'utf8'); assert.ok(item.name.endsWith('.mjs')); assert.ok(!source.includes('PRIVATE KEY'));
        assert.ok(!/\b(?:from|import)\s*\(?\s*['"](?:node:|https?:|file:)/u.test(source)); assert.ok(!source.includes('.dart')); }
    }
  }
  await inspect(new URL('../src/',import.meta.url));
});
test('canonical metadata rejects lone surrogates in both values and keys', () => {
  for (const value of ['\ud800','\udfff',{['\ud800']:1},{title:'\udfff'}]) assert.throws(() => canonicalJson(value));
  assert.equal(canonicalJson({title:'😀'}),'{"title":"😀"}');
});
