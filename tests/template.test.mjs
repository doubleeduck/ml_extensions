import test from 'node:test';
import assert from 'node:assert/strict';
import createExample from '../templates/json-api/src/index.mjs';
test('JSON authoring template covers catalog/search/details/chapters/pages without startup IO', async () => {
  const calls = [], row = {id:'book/1',title:'Fixture',cover:'https://images.example.org/cover.jpg'};
  const source = createExample({baseUrl:'https://example.org',http:{async request(request) {
    const url = new URL(request.url); calls.push(url);
    if (url.pathname.endsWith('/pages')) return {body:{images:['https://images.example.org/1.jpg','https://images.example.org/2.jpg']}};
    if (url.pathname.endsWith('/chapters')) return {body:{items:[{id:'chapter/1',title:'Chapter 1.5',number:1.5}]}};
    return {body:url.pathname === '/api/titles' ? {items:[row]} : row};
  }}});
  assert.equal(calls.length,0);
  assert.equal((await source.getPopular({page:2}))[0].id,'book/1'); assert.equal(calls.at(-1).searchParams.get('page'),'2');
  await source.getLatest(); assert.equal(calls.at(-1).searchParams.get('sort'),'latest');
  await source.search({searchTerm:'Русский & English',page:1}); assert.equal(calls.at(-1).searchParams.get('q'),'Русский & English');
  assert.equal((await source.getDetails({mangaId:'book/1'})).title,'Fixture'); assert.ok(calls.at(-1).pathname.includes('book%2F1'));
  assert.equal((await source.getChapters({mangaId:'book/1'}))[0].number,1.5);
  assert.deepEqual((await source.getPages({chapterId:'chapter/1'})).map(page => page.index),[0,1]);
  assert.deepEqual(await source.getFilters(),[]);
});
test('JSON template rejects malformed API collections instead of returning a false empty success', async () => {
  const source = createExample({baseUrl:'https://example.org',http:{request:async () => ({body:{items:null}})}});
  await assert.rejects(source.getPopular(),error => error.code === 'parse_error');
});
