import test from 'node:test';
import assert from 'node:assert/strict';
import createMangaKakalot,{buildFilters,searchPath,parseChapters,parsePages} from '../src/sources/mangakakalot.mjs';
test('MangaBox filters/search and opaque chapter IDs preserve legacy semantics', () => {
  assert.equal(buildFilters().length,3); assert.equal(buildFilters()[2].options.length,41);
  assert.deepEqual(searchPath({searchTerm:' One: Piece!! ',page:2}),{path:'/search/story/one_piece',params:{page:2}});
  assert.deepEqual(searchPath({selectedFilters:{genre:['action'],status:['ongoing'],sort:['topview']}}),{path:'/genre/action',params:{page:1,type:'topview',state:'ongoing'}});
  assert.equal(parseChapters({success:true,data:{chapters:[{chapter_slug:'c1',chapter_name:'Chapter 1.5'}]}},'first')[0].id,'/manga/first/c1');
});
test('MangaBox 2xstorage/CDN arrays, backup and DOM fallback do not duplicate image prefixes', () => {
  assert.deepEqual(parsePages({scripts:[`var cdns=['https://cdn.2xstorage.com/root/']; var chapterImages=['/1.jpg','https://other.2xstorage.com/2.jpg'];`],images:[]},'https://www.mangakakalot.gg'),[
    {index:0,imageUrl:'https://cdn.2xstorage.com/root/1.jpg'},{index:1,imageUrl:'https://other.2xstorage.com/2.jpg'}]);
  assert.deepEqual(parsePages({scripts:[],images:[{src:'/1.jpg'},{lazy:'/2.jpg'}]},'https://www.mangakakalot.gg'),[
    {index:0,imageUrl:'https://www.mangakakalot.gg/1.jpg'},{index:1,imageUrl:'https://www.mangakakalot.gg/2.jpg'}]);
});
test('MangaBox retry is source-local and never retries auth/cancellation/parse errors', async () => {
  for (const code of ['cancelled','auth_required','parse_error','rate_limited']) {
    let count = 0; const source = createMangaKakalot({http:{request:async () => {count++;throw Object.assign(Error(),{code});}}});
    await assert.rejects(source.getLatest(),error => error.code === code); assert.equal(count,1);
  }
  const calls = []; const source = createMangaKakalot({http:{request:async input => {calls.push(input.url); if (calls.length === 1) throw Object.assign(Error(),{code:'network'}); return {body:'html'};}},html:{extract:async () => []}});
  await source.getLatest(); await source.getLatest();
  assert.equal(new URL(calls[1]).host,'www.mangakakalove.com'); assert.equal(new URL(calls[2]).host,'www.mangakakalove.com');
});
