import test from 'node:test';
import assert from 'node:assert/strict';
import createLibGroup from '../src/engines/libgroup.mjs';
import {decodeChapterId, parseAccess, parseCatalogManga, parseChapterEntries, parseDetails, parseFilters, searchParameters, summary} from '../src/engines/libgroup_parser.mjs';

const config = {titleLanguage:'eng',chapterMode:'ms_mixing'};
const item = {id:7965,slug:'chainsaw-man',slug_url:'7965--chainsaw-man',eng_name:'Chainsaw Man',rus_name:'Человек-бензопила',name:'Name',
  cover:{md:'https://cover.example/image.jpg'},status:{label:'Ongoing'},type:{label:'Manga'},caution:{label:'16+'},
  rating:{average:'9.2'},releaseDateString:'December 2018',genres:[{name:'Drama'},{name:'drama'}]};
function context(handler, settings = {}, siteId = 1) {
  return {sourceId:siteId === 1 ? 'ru.mangalib' : siteId === 2 ? 'ru.yaoilib' : 'ru.hentailib',
    parameters:{siteId:String(siteId)},baseUrl:siteId === 1 ? 'https://mangalib.me' : siteId === 2 ? 'https://v2.shlib.life' : 'https://hentailib.me',
    settings:{get:async () => settings},html:{extract:async () => ['Office workers']},
    http:{request:async request => ({status:200,headers:{},url:request.url,body:await handler(new URL(request.url),request)})}};
}
test('catalog and detail title selection preserve persistent IDs, title settings and rich descriptions', () => {
  const english = parseCatalogManga(item,config), russian = parseCatalogManga(item,{titleLanguage:'rus'});
  assert.equal(english.id,'7965--chainsaw-man'); assert.equal(english.title,'Chainsaw Man');
  assert.equal(russian.title,'Человек-бензопила'); assert.equal(english.rating,9.2);
  assert.deepEqual(english.tags,['Drama']); assert.equal(english.releaseYear,'2018');
  const details = parseDetails({preview:item,details:{...item,eng_name:'',summary:{type:'doc',content:[
    {type:'paragraph',content:[{type:'text',text:'First'},{type:'hardBreak'},{type:'text',text:'Second'}]},
    {type:'paragraph',content:[{type:'text',text:'Next'}]}]},authors:[{name:'Fujimoto'}],tags:[{name:'Drama'},{name:'Action'}]},settings:config});
  assert.equal(details.title,'Chainsaw Man'); assert.equal(details.author,'Fujimoto');
  assert.equal(details.description,'First\nSecond\nNext'); assert.deepEqual(details.tags,['Drama','Action']);
  assert.equal(summary([' one ',' two ']),'one \n two');
});
test('chapter IDs, fractional numbers and both legacy chapter modes remain unchanged', () => {
  const raw = {volume:'2',number:'10.5',name:'Bonus',branches:[{branch_id:4666,created_at:'2025-01-01T00:00:00Z',teams:[{name:'Team'}]},
    {id:2,user:{username:'User'}}]};
  const primary = parseChapterEntries(raw,config);
  assert.equal(primary[0].id,'2|10.5'); assert.equal(primary[0].number,10.5);
  assert.equal(primary[0].title,'Vol. 2 Ch. 10.5 - Bonus');
  const combined = parseChapterEntries(raw,{...config,chapterMode:'ms_combining',showAlternativeBranchSource:true});
  assert.deepEqual(combined.map(item => item.id),['2|10.5|4666','2|10.5|2']);
  assert.equal(combined[0].title,'Vol. 2 Ch. 10.5 - Bonus - Team');
  assert.equal(combined[1].title,'Vol. 2 Ch. 10.5 - Bonus - User');
  assert.deepEqual(decodeChapterId('2|10.5|4666'),{volume:'2',number:'10.5',branch_id:'4666'});
  assert.throws(() => decodeChapterId('invalid'),error => error.code === 'parse_error');
});
test('paid and temporary chapter restrictions retain typed access/price/expiry data', () => {
  const temporary = parseAccess({restricted_view:{is_open:false,price:18,expired_at:'2026-07-08T06:17:00.000000Z'}});
  assert.equal(temporary.type,'temporarilyUnavailable'); assert.equal(temporary.priceLabel,'18');
  assert.equal(temporary.availableAt,'2026-07-08T06:17:00.000Z');
  assert.equal(parseAccess({restricted_view:{is_open:false,price:2.5}}).type,'paid');
});
test('search parameters preserve multi/tri-state filters, list exclusions and sort direction', () => {
  const query = searchParameters({searchTerm:' test ',selectedFilters:{types:['1'],format:['include:2'],genres:['exclude:3'],
    tags:['include:4','exclude:5'],bookmarks:['exclude:1'],sort:['rate_avg','asc'],require_chapters:['true']}});
  assert.deepEqual(query,{q:'test','types[]':['1'],'format[]':['2'],'genres_exclude[]':['3'],'tags[]':['4'],'tags_exclude[]':['5'],
    'bookmarks_exclude[]':['1'],sort_by:'rate_avg',sort_type:'asc',chap_count_min:'1'});
});
test('constants only expose options for this site and keep original filter keys', () => {
  const filters = parseFilters({types:[{id:1,label:'Manga',site_ids:[1]},{id:2,label:'Other',site_ids:[4]}],
    genres:[{id:3,name:'Drama',site_ids:[1,4]}]},1);
  assert.deepEqual(filters.map(item => item.key),['sort','types','genres','bookmarks','require_chapters']);
  assert.deepEqual(filters.find(item => item.key === 'types').options.map(item => item.value),['1']);
});
test('three site instances send their own Site-Id and origin, with separate settings', async () => {
  for (const site of [1,2,4]) {
    const source = createLibGroup(context((url,request) => {
      assert.equal(request.headers['Site-Id'],String(site));
      assert.equal(url.searchParams.get('site_id[]'),String(site));
      assert.equal(request.headers.Origin,site === 1 ? 'https://mangalib.me' : site === 2 ? 'https://v2.shlib.life' : 'https://hentailib.me');
      assert.equal(request.headers.Cookie,undefined); assert.equal(request.headers.Authorization,undefined);
      return {data:[item]};
    },{titleLanguage:site === 1 ? 'eng' : 'rus'},site));
    assert.equal((await source.getPopular())[0].title,site === 1 ? 'Chainsaw Man' : 'Человек-бензопила');
  }
});
test('mirror failover retries transport failure but never auth/rate-limit/cancellation', async () => {
  const hosts = [];
  const source = createLibGroup(context(url => {
    hosts.push(url.host);
    if (hosts.length === 1) throw Object.assign(new Error('offline'),{code:'network'});
    return {data:[item]};
  }));
  await source.getPopular(); assert.deepEqual(hosts,['api2.mangalib.me','api.cdnlibs.org']);
  for (const code of ['auth_required','cancelled','rate_limited','parse_error']) {
    let calls = 0;
    const failed = createLibGroup(context(() => { calls++; throw Object.assign(new Error(code),{code}); }));
    await assert.rejects(failed.getPopular(),error => error.code === code);
    assert.equal(calls,1);
  }
});
test('restricted chapter error from HTTP 403 is not hidden by mirror retries', async () => {
  let calls = 0;
  const source = createLibGroup(context(() => { calls++; throw {code:'access_denied',status:403,
    body:{data:{restricted_view:{is_open:false,price:18,expired_at:'2026-07-08T06:17:00Z'}}}}; }));
  await assert.rejects(source.getPages({mangaId:'demo',chapterId:'2|42'}),error =>
    error.code === 'chapter_unavailable' && error.access.type === 'temporarilyUnavailable' && error.access.priceLabel === '18');
  assert.equal(calls,1);
});
test('chapter list reverses endpoint order without merging chapter identities', async () => {
  const source = createLibGroup(context(() => ({data:[{volume:1,number:1},{volume:1,number:2}]})));
  assert.deepEqual((await source.getChapters({mangaId:'demo'})).map(item => item.id),['1|2','1|1']);
});
test('auto image probing is coalesced across 40 pages and cached for the next chapter', async () => {
  let probes = 0, constants = 0;
  const ctx = context((url,request) => {
    if (request.method === 'HEAD') { probes++; return ''; }
    if (url.pathname.endsWith('/constants')) { constants++; return {data:{imageServers:[{id:'main',url:'https://img.example',site_ids:[1]}]}}; }
    return {data:{pages:Array.from({length:40},(_,index) => ({slug:String(index+1),url:`/same-bucket/${40-index}.png`}))}};
  },{imageServer:'auto'});
  const source = createLibGroup(ctx);
  const pages = await source.getPages({mangaId:'demo',chapterId:'1|1'});
  assert.equal(pages.length,40); assert.equal(probes,1); assert.equal(constants,1);
  assert.equal(pages[0].imageUrl,'https://img.example/same-bucket/40.png');
  assert.deepEqual(pages.map(item => item.index),Array.from({length:40},(_,index) => index));
  await source.getPages({mangaId:'demo',chapterId:'1|2'});
  assert.equal(probes,1); assert.equal(constants,1);
});
test('details merge HTML creation tags while preserving API metadata and IDs', async () => {
  const source = createLibGroup(context((url,request) => request.responseType === 'text' ? '<html>tags</html>' : {data:{...item,summary:'Summary'}}));
  const details = await source.getDetails({mangaId:item.slug_url});
  assert.equal(details.id,item.slug_url); assert.equal(details.description,'Summary');
  assert.deepEqual(details.tags,['Drama','Office workers']);
});
test('similar titles stay within current site and retain recommendation order', async () => {
  const source = createLibGroup(context(() => ({data:[{media:item},{media:{...item,slug_url:'other-site',site:4}},
    {media:{...item,slug_url:'recommended',site:1}},{media:{...item,slug_url:'recommended',site:1}}]})));
  const result = await source.getRecommendations({mangaId:item.slug_url});
  assert.deepEqual(result.items.map(item => item.id),['recommended']); assert.equal(result.hasNextPage,false);
});
