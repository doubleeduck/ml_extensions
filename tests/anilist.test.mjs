import test from 'node:test';
import assert from 'node:assert/strict';
import createAniList, {parseManga,browseRequest} from '../src/sources/anilist.mjs';

const item = id => ({id,title:{romaji:'Romaji',english:' English ',native:'原作'},genres:[' Action ','Drama'],
  format:'ONE_SHOT',status:'FINISHED',isAdult:true,averageScore:87,startDate:{year:2020},
  coverImage:{extraLarge:'https://s4.anilist.co/cover.jpg'},description:' Text '});
const context = handler => ({http:{request:async input => ({body:await handler(input)})}});
test('AniList preserves ID, title priority, rating scale and metadata fields', () => {
  const manga = parseManga(item(123));
  assert.equal(manga.id,'123'); assert.equal(manga.title,'English'); assert.equal(manga.secondaryTitle,'Romaji');
  assert.equal(manga.rating,8.7); assert.equal(manga.type,'One Shot'); assert.equal(manga.status,'completed');
  assert.equal(manga.ageRating,'18+'); assert.equal(manga.releaseYear,'2020'); assert.deepEqual(manga.tags,['Action','Drama']);
});
test('AniList dynamic query keeps all legacy filter keys and omits unused variables', () => {
  const request = browseRequest({page:0,searchTerm:' title ',selectedFilters:{sort:['SCORE','asc'],format:['MANGA','NOVEL'],
    status:['FINISHED'],country:['JP'],genre:['Action','Drama']}},'POPULARITY_DESC');
  assert.deepEqual(request.variables,{page:1,perPage:24,sort:['SCORE_ASC'],isAdult:false,search:'title',
    formatIn:['MANGA','NOVEL'],statusIn:['FINISHED'],country:'JP',genreIn:['Action','Drama']});
  for (const token of ['format_in:$formatIn','status_in:$statusIn','countryOfOrigin:$country','genre_in:$genreIn']) assert.ok(request.query.includes(token));
  const empty = browseRequest({},'POPULARITY_DESC');
  assert.equal(empty.query.includes('$search'),false); assert.equal(empty.query.includes('$formatIn'),false);
});
test('AniList popular/latest/search use POST GraphQL and stable fallback sorts', async () => {
  const sorts = [];
  const source = createAniList(context(input => {
    assert.equal(input.url,'https://graphql.anilist.co'); assert.equal(input.method,'POST');
    assert.equal(input.headers.Authorization,undefined); sorts.push(input.body.variables.sort[0]);
    return {data:{Page:{media:[item(123),item(123),item(456)]}}};
  }));
  assert.deepEqual((await source.getPopular()).map(value => value.id),['123','456']);
  await source.getLatest(); await source.search({searchTerm:'query',page:1,selectedFilters:{}});
  assert.deepEqual(sorts,['POPULARITY_DESC','START_DATE_DESC','SEARCH_MATCH']);
});
test('AniList genre cache belongs to the context and refresh is explicit', async () => {
  let calls = 0;
  const ctx = context(() => {calls++; return {data:{GenreCollection:['Action','Drama','Action']}};});
  const source = createAniList(ctx);
  assert.deepEqual((await source.getFilters())[4].options.map(value => value.value),['Action','Drama']);
  await source.getFilters(); assert.equal(calls,1);
  await createAniList(ctx).getFilters(); assert.equal(calls,2);
  await source.getFilters({refresh:true}); assert.equal(calls,3);
});
test('AniList recommendations preserve order, paging and exclude self/deleted/duplicate entries', async () => {
  const source = createAniList(context(input => {
    assert.deepEqual(input.body.variables,{id:123,page:2,perPage:25});
    return {data:{Media:{recommendations:{pageInfo:{hasNextPage:true},nodes:[123,456,456,null,789].map(id => ({mediaRecommendation:id ? item(id) : null}))}}}};
  }));
  const page = await source.getRecommendations({mangaId:'123',page:2});
  assert.deepEqual(page.items.map(value => value.id),['456','789']); assert.equal(page.page,2); assert.equal(page.hasNextPage,true);
});
test('AniList metadata-only contract and failed GraphQL payloads never fake chapters or empty success', async () => {
  const source = createAniList(context(() => ({errors:[{message:'Invalid request'}]})));
  assert.deepEqual(await source.getChapters(),[]);
  await assert.rejects(source.getPages(),error => error.code === 'parse_error');
  await assert.rejects(source.getPopular(),error => error.code === 'invalid_response');
  await assert.rejects(createAniList(context(() => ({data:{Page:{}}}))).getPopular(),error => error.code === 'parse_error');
  await assert.rejects(source.getDetails({mangaId:'9007199254740993'}),error => error.code === 'parse_error');
});
