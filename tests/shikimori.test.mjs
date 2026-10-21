import test from 'node:test';
import assert from 'node:assert/strict';
import createShikimori,{parseManga} from '../src/sources/shikimori.mjs';

const item = id => ({id,russian:['',' Русское имя '],english:['English'],name:'Name',
  image:{original:'/cover.jpg'},kind:'one_shot',description:' описание ',score:'8.7',status:'released',aired_on:'2020-01-03',
  genres:[{russian:'Экшен',name:'Action'}]});
const context = ({rest = () => [],graph = () => ({data:{mangas:[]}})} = {}) => ({http:{request:async request =>
  ({body:await (request.method === 'POST' ? graph(request) : rest(new URL(request.url)))})}});

test('metadata keeps numeric IDs, Russian names, rating scale and legacy fields', () => {
  const value = parseManga(item(656));
  assert.equal(value.id,'656'); assert.equal(value.title,'Русское имя');
  assert.equal(value.secondaryTitle,'English'); assert.equal(value.rating,8.7);
  assert.equal(value.type,'One Shot'); assert.equal(value.releaseYear,'2020');
  assert.deepEqual(value.tags,['Экшен']); assert.equal(value.coverUrl,'https://shikimori.io/cover.jpg');
});

test('search sends paging, search and existing filter IDs in one GraphQL request', async () => {
  let calls=0;
  const source=createShikimori(context({rest:()=>assert.fail('No REST catalog lookup'),graph:request=>{
    calls++; assert.equal(request.url,'https://shikimori.io/api/graphql');
    assert.deepEqual(request.body.variables,{page:2,order:'ranked',search:'vagabond',genre:'4',kind:'manga'});
    return {data:{mangas:[item(656)]}};
  }}));
  assert.equal((await source.search({page:2,searchTerm:' vagabond ',selectedFilters:{sort:['ranked:desc'],genre:['4'],kind:['manga']}}))[0].id,'656');
  assert.equal(calls,1);
});

test('genre cache is per context, refresh is explicit and sort has fixed directions', async () => {
  let calls=0;
  const rest=()=>{ calls++; return [{id:1,entry_type:'manga',name:'Action'},{id:2,entry_type:'anime',name:'Anime'}]; };
  const source=createShikimori(context({rest})), other=createShikimori(context({rest}));
  const filters=await source.getFilters();
  assert.equal(filters[0].kind,'sort'); assert.equal(filters[0].supportsDirection,false);
  assert.deepEqual(filters[3].options.map(item=>item.value),['1']);
  await source.getFilters(); assert.equal(calls,1);
  await other.getFilters(); assert.equal(calls,2);
  await source.getFilters({refresh:true}); assert.equal(calls,3);
});

test('metadata-only chapters stay empty and batched recommendations keep order and exclude self', async () => {
  const source=createShikimori(context({rest:()=>[item(656),item(2),item(3),item(2)]}));
  assert.deepEqual(await source.getChapters(),[]);
  await assert.rejects(source.getPages(),{code:'parse_error'});
  const related=await source.getRecommendations({mangaId:'656'});
  assert.deepEqual(related.items.map(item=>item.id),['2','3']); assert.equal(related.hasNextPage,false);
});

test('GraphQL errors and malformed envelopes are never successful empty catalogs', async () => {
  for (const [body,code] of [[{errors:[{message:'bad query'}]},'invalid_response'],[{},'parse_error'],[{data:{mangas:{}}},'parse_error']]) {
    await assert.rejects(createShikimori(context({graph:()=>body})).getPopular(),{code});
  }
});

test('REST missing-file placeholders are never emitted as image URLs', () => {
  assert.equal(parseManga({...item(197170),image:{original:'/assets/globals/missing_original.jpg'}}).coverUrl,null);
});

test('latest includes authoritative posters in its single catalog request', async () => {
  let calls=0;
  const source=createShikimori(context({rest:()=>assert.fail('No separate REST or title-page lookup'),graph:request=>{
    calls++; assert.deepEqual(request.body.variables,{order:'aired_on',page:2});
    assert.match(request.body.query,/poster \{ originalUrl mainUrl previewUrl \}/u);
    return {data:{mangas:[197170,197276].map(id=>({...item(id),poster:{originalUrl:'https://shikimori.io/uploads/poster/'+id+'.jpeg'}}))}};
  }}));
  const latest=await source.getLatest({page:2});
  assert.deepEqual(latest.map(m=>m.id),['197170','197276']);
  assert.deepEqual(latest.map(m=>m.coverUrl),['https://shikimori.io/uploads/poster/197170.jpeg','https://shikimori.io/uploads/poster/197276.jpeg']);
  assert.equal(calls,1);
});

test('details use GraphQL metadata and posters without an extra cover or HTML request', async () => {
  let calls=0;
  const source=createShikimori(context({graph:request=>{
    calls++; assert.deepEqual(request.body.variables,{ids:'197170'});
    return {data:{mangas:[{id:'197170',name:'Name',russian:'Русский',english:'Alias',japanese:'Other',description:'Summary',kind:'manhwa',score:8.7,status:'ongoing',
      airedOn:{year:2026},genres:[{russian:'Романтика'}],poster:{originalUrl:'https://shikimori.io/uploads/poster/full.jpeg'}}]}};
  }}));
  const details=await source.getDetails({mangaId:'197170'});
  assert.equal(details.coverUrl,'https://shikimori.io/uploads/poster/full.jpeg'); assert.equal(details.releaseYear,'2026');
  assert.equal(details.secondaryTitle,'Alias'); assert.equal(details.description,'Summary'); assert.deepEqual(details.tags,['Романтика']); assert.equal(calls,1);
});

test('REST-only chapters/volumes ordering batches posters and preserves original order', async () => {
  for (const order of ['chapters','volumes']) {
    let restCalls=0, posterCalls=0;
    const source=createShikimori(context({rest:url=>{
      restCalls++; assert.equal(url.searchParams.get('order'),order); assert.equal(url.searchParams.get('genre_v2'),'4');
      return [item(2),item(1)];
    },graph:request=>{
      posterCalls++; assert.deepEqual(request.body.variables,{ids:'2,1',limit:2});
      return {data:{mangas:[{id:'1',poster:{originalUrl:'https://shikimori.io/1.jpg'}},{id:'2',poster:{originalUrl:'https://shikimori.io/2.jpg'}}]}};
    }}));
    const items=await source.search({selectedFilters:{sort:[order,'asc'],genre:['4']}});
    assert.deepEqual(items.map(m=>m.coverUrl),['https://shikimori.io/2.jpg','https://shikimori.io/1.jpg']);
    assert.equal(restCalls,1); assert.equal(posterCalls,1);
  }
});

test('missing posters remain empty, and empty REST results do not request a poster batch', async () => {
  const source=createShikimori(context({graph:()=>({data:{mangas:[{id:'1',name:'No cover',poster:null}]}})}));
  assert.equal((await source.getPopular())[0].coverUrl,null);
  const empty=createShikimori(context({rest:()=>[],graph:()=>assert.fail('No poster lookup for empty REST result')}));
  assert.deepEqual(await empty.search({selectedFilters:{sort:['chapters']}}),[]);
});

test('invalid details IDs make no request and an absent title is an error', async () => {
  const source=createShikimori(context({graph:()=>assert.fail('No lookup for invalid ID')}));
  await assert.rejects(source.getDetails({mangaId:'../1'}),{code:'parse_error'});
  await assert.rejects(createShikimori(context()).getDetails({mangaId:'1'}),{code:'parse_error'});
});
