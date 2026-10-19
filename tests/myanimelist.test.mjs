import test from 'node:test';
import assert from 'node:assert/strict';
import createMyAnimeList, {parseManga,parseBrowse,browseUrl} from '../src/sources/myanimelist.mjs';

const item = id => ({id,title:' English ',alternative_titles:{en:'English',ja:'原作',synonyms:['Other']},
  main_picture:{large:'https://cdn.myanimelist.net/cover.jpg'},synopsis:' Text ',media_type:'one_shot',status:'finished',
  start_date:'2020-01-01',genres:[{name:'Action'}],mean:8.7,nsfw:'gray',authors:[
    {role:'Story',first_name:'A',last_name:'B'},{role:'Story',first_name:'A',last_name:'B'},{role:'Art',first_name:'C'}]});
const context = (http,html = () => {throw Error('HTML not expected');}) => ({http:{request:async input => ({url:input.url,body:await http(input)})},
  html:{extract:async (body,query) => html(body,query)}});
test('MAL preserves numeric IDs, author roles and metadata rating scale', () => {
  const manga = parseManga(item(123));
  assert.equal(manga.id,'123'); assert.equal(manga.title,'English'); assert.equal(manga.secondaryTitle,'原作');
  assert.equal(manga.author,'A B'); assert.equal(manga.artist,'C'); assert.equal(manga.rating,8.7);
  assert.equal(manga.status,'completed'); assert.equal(manga.type,'One Shot'); assert.equal(manga.ageRating,'18+');
});
test('MAL API ranking/search/details retain page sizes, IDs and fields, leaving app client ID to host', async () => {
  const requests = [];
  const source = createMyAnimeList(context(input => {requests.push(input); return input.url.includes('/manga/123?') ? item(123) : {data:[{node:item(123)}]};}));
  await source.getPopular({page:2}); await source.getLatest(); await source.search({searchTerm:'x'.repeat(80),selectedFilters:{}});
  assert.equal((await source.getDetails({mangaId:'123'})).id,'123');
  const [popular,latest,search] = requests.map(input => new URL(input.url));
  assert.equal(popular.searchParams.get('ranking_type'),'bypopularity'); assert.equal(popular.searchParams.get('offset'),'24');
  assert.equal(latest.searchParams.get('ranking_type'),'all'); assert.equal(search.searchParams.get('q').length,64);
  assert.ok(requests.every(input => input.headers['X-MAL-CLIENT-ID'] == null && input.headers.Cookie == null));
});
test('MAL minimal-fields fallback is bounded and does not repeat auth/rate-limit/cancel failures', async () => {
  let calls = 0;
  const source = createMyAnimeList(context(input => {calls++; return {data:input.url.includes('fields=') ? [] : [{node:item(123)}]};}));
  assert.equal((await source.getPopular())[0].id,'123'); assert.equal(calls,2);
  await source.getPopular({page:2}); assert.equal(calls,3);
  for (const code of ['auth_required','rate_limited','cancelled','auth_session_changed','parse_error']) {
    let attempts = 0;
    await assert.rejects(createMyAnimeList(context(() => {attempts++; throw Object.assign(Error(code),{code});})).getPopular(),error => error.code === code);
    assert.equal(attempts,1);
  }
});
test('MAL filtered search uses website values and repeated genre parameters instead of API-only filters', async () => {
  const query = {page:2,searchTerm:' title ',selectedFilters:{type:['manhwa|5'],status:['finished|2'],genre:['1','2']}};
  const url = new URL(browseUrl(query));
  assert.equal(url.searchParams.get('show'),'50'); assert.equal(url.searchParams.get('q'),'title');
  assert.equal(url.searchParams.get('type'),'5'); assert.equal(url.searchParams.get('status'),'2');
  assert.deepEqual(url.searchParams.getAll('genre[]'),['1','2']);
  const source = createMyAnimeList(context(input => {assert.equal(input.responseType,'text'); return 'HTML';},
    (body,projection) => {assert.equal(body,'HTML'); assert.ok(projection.fields.tiles); return {tiles:[],rows:[]};}));
  assert.deepEqual(await source.search(query),[]);
});
test('MAL tile and table projections retain larger/lazy covers, descriptions, genres, status and year', () => {
  const tile = parseBrowse({tiles:[{href:'/manga/123/title',title:'Title',info:['Manga, 2020','Publishing'],publishing:null,
    synopsis1:'Text',genres:['Action'],image:{dataSet:'/cover.jpg 1x, /cover2.jpg 2x'}}],rows:[]})[0];
  assert.equal(tile.coverUrl,'https://myanimelist.net/cover.jpg'); assert.equal(tile.status,'Publishing'); assert.equal(tile.releaseYear,'2020');
  const row = parseBrowse({tiles:[],rows:[{links:[{href:'/manga/123/title',title:''},{href:'/manga/123/title',title:'Title'}],
    description:'Title Short description',type:'Manga',rating:'8.7',image:{src:'/cover.jpg'}}]})[0];
  assert.equal(row.description,'Short description'); assert.equal(row.rating,8.7); assert.equal(row.id,'123');
});
test('MAL genres cache is per context and count suffix is removed', async () => {
  let calls = 0;
  const ctx = context(() => {calls++; return 'HTML';},(_,projection) => {
    assert.equal(projection.selector,'[name="genre[]"]'); return [{value:'1',label:'Action (12,300)'},{value:'1',label:'Action'}];});
  const source = createMyAnimeList(ctx);
  assert.deepEqual((await source.getFilters())[3].options.map(value => [value.value,value.label]),[['1','Action']]);
  await source.getFilters(); assert.equal(calls,1);
  await source.getFilters({refresh:true}); assert.equal(calls,2);
  await createMyAnimeList(ctx).getFilters(); assert.equal(calls,3);
});
test('MAL recommendations exclude self and duplicates and do no HTTP work on page 2', async () => {
  let calls = 0;
  const source = createMyAnimeList(context(() => {calls++; return 'HTML';},() => [123,456,456].map(id => ({
    title:`Title ${id}`,href:`/recommendations/manga/123-${id}`,image:{dataSrc:'https://cdn.myanimelist.net/cover.jpg'}}))));
  assert.deepEqual((await source.getRecommendations({mangaId:'123'})).items.map(value => value.id),['456']);
  assert.deepEqual((await source.getRecommendations({mangaId:'123',page:2})).items,[]); assert.equal(calls,1);
  assert.deepEqual(await source.getChapters(),[]); await assert.rejects(source.getPages(),error => error.code === 'parse_error');
  await assert.rejects(createMyAnimeList(context(() => ({oops:true}))).getPopular(),error => error.code === 'parse_error');
});
