import assert from 'node:assert/strict';
import test from 'node:test';
import createSource from '../src/sources/inkstory.mjs';

function context(responder) {
  const requests = [];
  return {requests, sourceId:'ru.inkstory', baseUrl:'https://inkstory.net',
    settings:{async get(){return {}; }},
    http:{async request(input){requests.push(input); return {url:input.url,status:200,body:await responder(new URL(input.url),input)};}},
    html:{async extract(){throw new Error('Unexpected HTML request');}},
  };
}

test('paired details and chapters reuse the book lookup without repeating its JSON request', async () => {
  const ctx=context(url=>url.pathname==='/v2/books/demo' ? {id:'book-id',slug:'demo',name:{ru:'Демо'}} :
    [{id:'ch-1',number:1,branchId:'main'}]);
  const source=createSource(ctx);
  assert.equal((await source.getDetails({mangaId:'/content/demo'})).title,'Демо');
  assert.equal((await source.getChapters({mangaId:'/content/demo'})).length,1);
  assert.equal(ctx.requests.filter(request=>new URL(request.url).pathname==='/v2/books/demo').length,1);
});
test('chapter requests preserve endpoints and only return largest translation', async () => {
  const ctx = context(url => url.pathname === '/v2/books/demo' ? {id:'book-id'} : [
    {id:'a1',number:1,branchId:'a'},{id:'b1',number:1,branchId:'b'},{id:'b2',number:2,branchId:'b'}]);
  const result = await createSource(ctx).getChapters({mangaId:'/content/demo'});
  assert.deepEqual(result.map(item=>item.id), ['/content/demo/b1','/content/demo/b2']);
  assert.deepEqual(ctx.requests.map(item=>new URL(item.url).pathname), ['/v2/books/demo','/v2/chapters']);
  assert.equal(new URL(ctx.requests[1].url).searchParams.get('bookId'), 'book-id');
});
test('search preserves tri-state, repeated filters, order and validated ranges', async () => {
  const ctx = context(() => []);
  await createSource(ctx).search({page:2,searchTerm:'  Demo  ',selectedFilters:{
    sort:['averageRating','asc'],status:['DONE','ONGOING'],genre:['include:action','exclude:adult'],
    chaptersCountMin:['2.5'],yearMin:['2024'],averageRatingMin:['8,5'],strictLabelEqual:['true'],
  }});
  const query = new URL(ctx.requests[0].url).searchParams;
  assert.equal(query.get('page'), '1');
  assert.equal(query.get('search'), 'Demo');
  assert.equal(query.get('sort'), 'averageRating,asc');
  assert.deepEqual(query.getAll('status'), ['DONE','ONGOING']);
  assert.equal(query.get('labelsInclude'), 'action');
  assert.equal(query.get('labelsExclude'), 'adult');
  assert.equal(query.get('averageRatingMin'), '8.5');
  assert.equal(query.get('yearMin'), '2024');
  assert.ok(!query.has('chaptersCountMin'));
});
test('filter caches belong to factory instance, with explicit refresh', async () => {
  const left=context(()=>[]),right=context(()=>[]), a=createSource(left),b=createSource(right);
  await a.getFilters({}); await a.getFilters({});
  assert.equal(left.requests.length,1); assert.equal(right.requests.length,0);
  await b.getFilters({}); await a.getFilters({refresh:true});
  assert.equal(left.requests.length,2); assert.equal(right.requests.length,1);
});
test('invalid reader IDs do not start HTTP or produce a successful empty result', async () => {
  const ctx=context(()=>[]),source=createSource(ctx);
  await assert.rejects(source.getPages({mangaId:'/content/demo',chapterId:'invalid'}),{code:'parse_error'});
  await assert.rejects(source.getDetails({mangaId:'/bad'}),{code:'parse_error'});
  assert.equal(ctx.requests.length,0);
});
test('recommendation pages beyond first do not refetch website', async () => {
  const ctx=context(()=>[]);
  assert.deepEqual(await createSource(ctx).getRecommendations({mangaId:'/content/demo',page:2}),
    {items:[],page:2,hasNextPage:false});
  assert.equal(ctx.requests.length,0);
});
