import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {registrations,sourceDefinitions,manifestDefinition} from '../src/definitions.mjs';
import createSource from '../src/index.mjs';
import {canonicalJson,packageZip,signedManifest,verifyPackage} from '../tools/package_format.mjs';
test('unofficial package registers 24 standard IDs and its offline factories never perform IO', () => {
  assert.equal(registrations.length,24); assert.equal(new Set(registrations.map(source => source.id)).size,24);
  assert.deepEqual(registrations.map(source => source.id),["ru.puremanga","ru.astramanga","ru.comx","ru.inkstory","ru.mangadex","en.mangadex","ru.mangalib","ru.remanga","ru.readmanga","ru.mintmanga","ru.seimanga","ru.selfmanga","ru.usagi","ru.rumix","ru.senkuro","en.mangafox","en.mangakakalot","en.weebcentral","ru.mangachan","ru.mangashi","ru.desu","ru.shikimori","en.anilist","en.myanimelist"]);
  assert.ok(registrations.every(source => source.isNsfw === false));
  assert.equal(manifestDefinition({version:'1.0.0',publisherKeyId:'fixture'}).extensionId,'official.mangalaunch.sources');
  const deny = () => { throw Error('Factory must not perform IO.'); };
  for (const definition of sourceDefinitions()) {
    assert.equal('_module' in definition,false);
    const source = createSource(Object.freeze({sourceId:definition.id,baseUrl:definition.baseUrl,parameters:Object.freeze(definition.parameters),
      http:{request:deny},html:{extract:deny},settings:{get:deny,set:deny},auth:{getSession:deny,status:deny},log:{info:deny}}));
    for (const method of ['getDetails','getChapters','getPages',...definition.capabilities.filter(value => value !== 'account').map(value => ({browse:'getPopular',latest:'getLatest',search:'search',filters:'getFilters',recommendations:'getRecommendations'}[value]))]) assert.equal(typeof source[method],'function',`${definition.id}: ${method}`);
  }
  for (const id of ['missing','ru.nsfw.puremanga','ru.nsfw.mintmanga','ru.nudemoon','ru.allhentai','ru.nsfw.nudemoon']) assert.throws(() => createSource({sourceId:id}),error=>error.code==='source_unavailable');
});
test('unofficial ZIP/signature payload is reproducible and rejects tampering independently', () => {
  const {privateKey} = generateKeyPairSync('ed25519'), pem = privateKey.export({type:'pkcs8',format:'pem'}), payload = new Map([['src/index.mjs',Buffer.from('export default ()=>({});')]]);
  for (const definition of registrations) payload.set(definition.branding.icon,Buffer.from('Fixture image bytes'));
  const signed = signedManifest(manifestDefinition({version:'1.0.0',publisherKeyId:'test-generated'}),payload,pem);
  const files = new Map([['manifest.json',signed.bytes],['signature.ed25519',signed.signature],...payload]), first = packageZip(files), second = packageZip(new Map([...files].reverse()));
  assert.deepEqual(first,second); assert.equal(verifyPackage(first,signed.publicKey).sources.length,24);
  const corrupt = Buffer.from(first); corrupt[40] ^= 1; assert.throws(() => verifyPackage(corrupt,signed.publicKey));
  assert.equal(canonicalJson({z:1,a:{b:2,a:3}}),'{"a":{"a":3,"b":2},"z":1}');
});

test('Senkuro advertises latest and MangaChan grants its actual parent cookie domain', () => {
  assert.ok(registrations.find(s=>s.id==='ru.senkuro').capabilities.includes('latest'));
  const chan = registrations.find(s=>s.id==='ru.mangachan');
  assert.deepEqual(chan.network.authOrigins,['https://im.manga-chan.me','https://manga-chan.me']);
});

test('every bundled source declares its own packaged raster branding without app assets', async () => {
  for (const source of sourceDefinitions()) {
    assert.match(source.branding.icon,/^assets\/source_logos\/[a-z0-9]+\.(png|jpg)$/u);
    assert.match(source.branding.accentColor,/^#[A-F0-9]{6}$/u);
    const bytes = await readFile(new URL(`../${source.branding.icon}`,import.meta.url));
    assert.ok(bytes.length > 0 && bytes.length <= 256*1024);
  }
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
