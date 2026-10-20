import test from 'node:test';
import assert from 'node:assert/strict';
import createNudeMoon,{buildFilters,catalogUrl,encodeSearchTerm,normalizeId,parseListing,parseDetails,parsePages} from '../src/sources/nudemoon.mjs';
import {sourceDefinitions} from '../src/definitions.mjs';

const details = {title:'Демо / Demo',cover:'/images/thumb/2610/208.jpg',description:'Описание\n манги',authors:['Автор','Автор'],
  tags:['Тег','Тег'],metadata:['Дата: 19 Октября 2026 Страниц: 27'],reader:'/34344-online-original-slug.html'};
const card = {link:{href:'/34344-catalog-slug.html',title:'Демо / Demo'},title:'',image:{src:'/images/thumb/2610/208.jpg'}};
const listing = {title:'Манга на русском! Nude-Moon!',items:[card]};

test('Nude Moon registration declares adult Russian reading, scoped auth/media and stable numeric web URLs', () => {
  const source = sourceDefinitions().find(source => source.id === 'ru.nudemoon');
  assert.equal(source.language,'ru'); assert.equal(source.isNsfw,true);
  assert.deepEqual(source.network.origins,['https://nude-moon.org']);
  assert.deepEqual(source.network.imageOrigins,['https://nude-moon.org']);
  assert.deepEqual(source.auth.cookieOrigins,['https://nude-moon.org']);
  assert.equal(source.auth.loginUrl,'https://nude-moon.org/');
  assert.equal(source.web.mangaUrlTemplate,'/{id}-manga.html');
  assert.deepEqual(source.capabilities,['browse','latest','search','filters','account']);
});

test('Nude Moon IDs survive different slugs, reader URLs, mirror hosts and query strings', () => {
  for (const value of ['34344','/34344-catalog.html','34344-online-longer-slug.html?page=2','https://nude-moon.org/34344-home.html#comments']) assert.equal(normalizeId(value),'34344');
  for (const value of ['',null,'/manga/2026/10/1.jpg','/images/thumb/1.jpg','/0-bad.html','/34344-.html','/34344-bad/nested.html']) assert.equal(normalizeId(value),null);
  assert.deepEqual(parseListing({...listing,items:[card,{...card,link:{href:'/34344-other-slug.html'}},{link:{href:'/other.html'},image:{}},
    {link:{href:'/12-slug.html',title:'Другой'},image:{src:'data:image/png;base64,placeholder',lazy:'/images/thumb/other.jpg'}}]}).map(item => item.id),['34344','12']);
});

test('Nude Moon sort flags, first/next pages and special-character searches retain the exact query', () => {
  const filters = buildFilters(); assert.equal(filters[0].options.length,5);
  const popular = new URL(catalogUrl({page:2},'views'));
  assert.equal(popular.pathname,'/all_manga'); assert.equal(popular.searchParams.get('views'),''); assert.equal(popular.searchParams.get('rowstart'),'30');
  assert.equal(new URL(catalogUrl({page:0})).searchParams.has('rowstart'),false);
  const search = new URL(catalogUrl({page:3,searchTerm:' Демо & A+B? ',selectedFilters:{sort:['like']}}));
  assert.equal(search.pathname,'/search'); assert.equal(search.href,'https://nude-moon.org/search?stext=%C4%E5%EC%EE+%26+A%2BB%3F&rowstart=60');
  assert.equal(search.searchParams.get('rowstart'),'60'); assert.equal(search.searchParams.has('like'),false);
  assert.throws(() => catalogUrl({selectedFilters:{sort:['unknown']}}),{code:'parse_error'});
});

test('Nude Moon search matches Windows-1251 browser form encoding for every defined byte', () => {
  const decoder = new TextDecoder('windows-1251');
  for (let byte = 128; byte < 256; byte++) {
    if (byte === 0x98) continue; // Undefined CP1251 codepoint.
    const char = decoder.decode(Uint8Array.of(byte));
    assert.equal(encodeSearchTerm(char),`%${byte.toString(16).toUpperCase()}`);
  }
  assert.equal(encodeSearchTerm('Ё ё &+😀'),'%A8+%B8+%26%2B%26%23128512%3B');
});

test('Nude Moon valid empty paging differs from incomplete HTTP-200 search responses', () => {
  assert.deepEqual(parseListing({...listing,items:[]}),[]);
  for (const data of [{title:'',items:[]},{title:'Challenge',items:[]},{title:listing.title}]) assert.throws(() => parseListing(data),{code:'parse_error'});
});

test('Nude Moon details preserve Cyrillic, authors, page count and null defaults', () => {
  const item = parseDetails(details,'34344');
  assert.equal(item.title,'Демо / Demo'); assert.equal(item.description,'Описание манги');
  assert.equal(item.author,'Автор'); assert.equal(item.artist,'Автор'); assert.equal(item.pageCount,27);
  assert.deepEqual(item.tags,['Тег']); assert.equal(item.coverUrl,'https://nude-moon.org/images/thumb/2610/208.jpg');
  assert.equal(item.status,null); assert.equal(item.releaseYear,null); assert.equal(item.ageRating,'18+');
  assert.throws(() => parseDetails({...details,title:''},'34344'),{code:'parse_error'});
});

test('Nude Moon row reader retains lazy images, order and non-numeric filenames, excluding placeholders', () => {
  const pages = parsePages({title:'Demo',images:[{src:'/manga/2026/001.jpg'},
    {src:'data:image/gif;base64,placeholder',lazy:'/manga/2026/002.jpg'},
    {src:'/manga/2026/001.jpg'},{lazy:'/manga/2026/Team.jpg'},{src:'javascript:alert(1)'}]});
  assert.deepEqual(pages,[{index:0,imageUrl:'https://nude-moon.org/manga/2026/001.jpg'},
    {index:1,imageUrl:'https://nude-moon.org/manga/2026/002.jpg'},{index:2,imageUrl:'https://nude-moon.org/manga/2026/Team.jpg'}]);
  for (const value of [{title:'Demo',images:[]},{title:null,images:[{src:'/manga/1.jpg'}]}]) assert.throws(() => parsePages(value),{code:'parse_error'});
});

function context({reply,extract} = {}) {
  const requests = [], projections = [];
  return {requests,projections,ctx:{http:{async request(input) { requests.push(input); return reply ? reply(input) : {body:'html',url:input.url}; }},
    html:{async extract(body,projection) { projections.push(projection); return extract ? extract(projection) : details; }}}};
}

test('Nude Moon dispatches catalog/details/chapter/row-reader requests using host text decoding and ISO dates', async () => {
  const {ctx,requests,projections} = context({extract:projection => projection.fields.items ? listing : projection.fields.images ? {title:'Demo',images:[{lazy:'/manga/1.jpg'}]} : details});
  const source = createNudeMoon(ctx);
  await source.getPopular({page:2}); await source.getLatest(); await source.search({searchTerm:'a&b'});
  assert.equal((await source.getDetails({mangaId:'34344'})).id,'34344');
  const [chapter] = await source.getChapters({mangaId:'34344'});
  assert.equal(chapter.id,'34344'); assert.equal(chapter.number,1); assert.equal(chapter.uploadedAt,'2026-10-19T00:00:00.000Z');
  assert.equal(chapter.access.type,'available');
  assert.deepEqual(await source.getPages({mangaId:'34344',chapterId:chapter.id}),[{index:0,imageUrl:'https://nude-moon.org/manga/1.jpg'}]);
  assert.equal(requests[0].url,'https://nude-moon.org/all_manga?views=&rowstart=30');
  assert.equal(requests[1].url,'https://nude-moon.org/all_manga?date=');
  assert.equal(new URL(requests[2].url).searchParams.get('stext'),'a&b');
  assert.equal(requests.at(-1).url,'https://nude-moon.org/34344-online-manga.html?row');
  assert.ok(requests.every(input => input.method === 'GET' && input.responseType === 'text' && input.headers.Referer === 'https://nude-moon.org/'));
  assert.ok(projections.every((value,index) => value.baseUrl === requests[index].url));
});

test('Nude Moon invalid IDs and absent reader links fail; HTTP/auth/challenge errors retain their codes', async () => {
  const {ctx,requests} = context({extract:() => ({...details,reader:'/9-online-other.html'})}), source = createNudeMoon(ctx);
  await assert.rejects(source.getDetails({mangaId:'bad'}),{code:'parse_error'}); assert.equal(requests.length,0);
  await assert.rejects(source.getChapters({mangaId:'34344'}),{code:'parse_error'});
  for (const code of ['auth_required','challenge_required','rate_limited','network']) {
    const {ctx} = context({reply:() => {throw Object.assign(Error('Host failure'),{code});}});
    await assert.rejects(createNudeMoon(ctx).getLatest(),{code});
  }
  const empty = context({reply:() => ({body:''})}); await assert.rejects(createNudeMoon(empty.ctx).getLatest(),{code:'invalid_response'});
});
