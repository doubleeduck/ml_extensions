import test from 'node:test';
import assert from 'node:assert/strict';
import createShikimori, {parseManga} from '../src/sources/shikimori.mjs';

const item = id => ({id,russian:['',' Русское имя '],english:['English'],name:'Name',
  image:{original:'/cover.jpg'},kind:'one_shot',description:' описание ',score:'8.7',status:'released',aired_on:'2020-01-03',
  genres:[{russian:'Экшен',name:'Action'}]});
const context = handler => ({http:{request:async request => ({body:await handler(new URL(request.url))})}});
test('metadata keeps numeric IDs as the same string, Russian names and rating scale', () => {
  const value = parseManga(item(656));
  assert.equal(value.id,'656'); assert.equal(value.title,'Русское имя');
  assert.equal(value.secondaryTitle,'English'); assert.equal(value.rating,8.7);
  assert.equal(value.type,'One Shot'); assert.equal(value.releaseYear,'2020');
  assert.deepEqual(value.tags,['Экшен']); assert.equal(value.coverUrl,'https://shikimori.io/cover.jpg');
});
test('search filter values use the existing REST parameter names', async () => {
  const source = createShikimori(context(url => {
    assert.equal(url.pathname,'/api/mangas');
    assert.equal(url.searchParams.get('page'),'2'); assert.equal(url.searchParams.get('limit'),'24');
    assert.equal(url.searchParams.get('order'),'ranked'); assert.equal(url.searchParams.get('genre_v2'),'4');
    assert.equal(url.searchParams.get('kind'),'manga'); assert.equal(url.searchParams.get('search'),'vagabond');
    return [item(656)];
  }));
  assert.equal((await source.search({page:2,searchTerm:' vagabond ',selectedFilters:{sort:['ranked:desc'],genre:['4'],kind:['manga']}}))[0].id,'656');
});
test('genre cache is per source context and refresh is explicit', async () => {
  let calls = 0;
  const handler = () => { calls++; return [{id:1,entry_type:'manga',name:'Action'},{id:2,entry_type:'anime',name:'Anime'}]; };
  const source = createShikimori(context(handler)), other = createShikimori(context(handler));
  assert.deepEqual((await source.getFilters())[3].options.map(item => item.value),['1']);
  await source.getFilters(); assert.equal(calls,1);
  await other.getFilters(); assert.equal(calls,2);
  await source.getFilters({refresh:true}); assert.equal(calls,3);
});
test('metadata-only chapters are empty and recommendations retain order/exclude self', async () => {
  const source = createShikimori(context(() => [item(656),item(2),item(3),item(2)]));
  assert.deepEqual(await source.getChapters(),[]);
  await assert.rejects(source.getPages(),error => error.code === 'parse_error');
  const recommendations = await source.getRecommendations({mangaId:'656'});
  assert.deepEqual(recommendations.items.map(item => item.id),['2','3']);
  assert.equal(recommendations.hasNextPage,false);
});
test('malformed REST response is not mistaken for an empty catalog', async () => {
  await assert.rejects(createShikimori(context(() => ({error:true}))).getPopular(),error => error.code === 'parse_error');
});
