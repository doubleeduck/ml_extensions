import test from 'node:test';
import assert from 'node:assert/strict';
import createRemanga from '../src/sources/remanga.mjs';
import {apiDate,buildFilters,chapterAccess,parseCatalog,parseChapter,parseFilterOptions,parseManga,parsePages,searchParameters} from '../src/sources/remanga_parser.mjs';
import {sourceDefinitions} from '../src/definitions.mjs';

const base = 'https://remanga.org', api = 'https://api.remanga.org';
const fixture = {id:1,dir:'<date>title',main_name:'Название',secondary_name:'Title',issue_year:2024,avg_rating:'9.4',
  cover:{low:'/low.jpg',mid:'/mid.jpg',high:'/high.jpg'},type:{id:2,name:'Манхва'},status:{id:2,name:'Продолжается'},age_limit:{id:1,name:'16+'},
  genres:[{id:3,name:'Боевые искусства'}],categories:[{id:6,name:'В цвете'}],creators:[{type:1,name:'Автор'},{type:4,name:'Художник'},{type:3,name:'Издательство'}],
  branches:[{id:11},{id:12}],meta:{}};
const chapterFixture = {id:101,tome:2,chapter:'10.5',index:1,name:'Начало',upload_date:'2026-10-24T11:22:33.123456',is_paid:false,is_bought:false,is_published:true};
const reader = {id:101,is_paid:false,is_published:true,server:{link:'https://img3.reimg.org/',fallback_link:'https://img3.reimg2.org/'},pages:[
  [{id:1,link:'https://img3.reimg2.org/a.jpg?sig=keep'},{id:2,link:'https://img3.reimg2.org/b.jpg'}],
  [{id:3,link:'https://img3.reimg2.org/a.jpg?sig=keep'}],
]};
const options = {types:[{id:1,name:'Манга'}],genres:[{id:3,name:'Боевые искусства'}],categories:[{id:6,name:'В цвете'}],
  status:[{id:1,name:'Закончен'},{id:2,name:'Продолжается'}],translate_status:[{id:4,name:'Нет переводчика'}],age_limit:[{id:0,name:'Для всех'}]};
const flight = value => `self.__next_f.push(${JSON.stringify([1,`6:${JSON.stringify(['$','$L1',null,{filtersOptions:value}])}\n`])})`;
const context = (http,extra = {}) => ({sourceId:'ru.remanga',baseUrl:base,parameters:{apiBaseUrl:api},settings:{get:async()=>({})},
  http:{request:http},html:{extract:async body=>body},...extra});
const reply = body => ({body});

test('ReManga is a standard source with packaged branding, mirror support and host cookie-backed auth', () => {
  const definition = sourceDefinitions().find(source=>source.id==='ru.remanga');
  assert.equal(definition.isNsfw,false); assert.equal(definition.supportsCustomBaseUrl,true);
  assert.ok(definition.capabilities.includes('recommendations'));
  assert.equal(definition.auth.loginUrl,base+'/');
  assert.deepEqual(definition.auth.rules.tokenCookieNames,['auth:token']);
  assert.ok(definition.auth.sessionExport.headers.includes('Authorization'));
  assert.deepEqual(definition.auth.sessionExport.values,[]);
  for(const origin of ['https://reimg.org','https://reimg2.org']){
    assert.ok(definition.network.imageOrigins.includes(origin));
    assert.ok(!definition.network.authOrigins.includes(origin));
  }
  assert.equal(definition.web.mangaUrlTemplate,'/manga/{id}/main');
});
test('catalog and recommendation rows preserve raw stable slugs and full covers', () => {
  const data = parseCatalog({results:[fixture,fixture],next:'?page=2'},base);
  assert.equal(data.items.length,1); assert.equal(data.hasNextPage,true);
  assert.equal(data.items[0].id,'<date>title'); assert.equal(data.items[0].coverUrl,base+'/high.jpg');
  const detail=parseManga(fixture,base,{description:'Описание'});
  assert.equal(detail.description,'Описание');assert.equal(detail.author,'Автор');assert.equal(detail.artist,'Художник');
  assert.equal(detail.status,'ongoing'); assert.equal(detail.rating,9.4); assert.deepEqual(detail.tags,['Боевые искусства','В цвете']);
  assert.equal(parseCatalog({results:[{title:fixture}],next:null},base,{related:true}).items[0].title,'Название');
  assert.throws(()=>parseCatalog({results:{}},base),e=>e.code==='parse_error');
  assert.throws(()=>parseCatalog({results:[{...fixture,main_name:null}]},base),e=>e.code==='parse_error');
});
test('chapter numbers, explicit API timezone and microseconds work independently of host timezone', () => {
  const result = parseChapter(chapterFixture);
  assert.equal(result.id,'101');assert.equal(result.number,10.5);assert.equal(result.title,'Том 2. Глава 10.5 — Начало');
  assert.equal(result.uploadedAt,'2026-10-24T08:22:33.123Z');
  assert.equal(apiDate('2026-10-24'),'2026-10-23T21:00:00.000Z');
  assert.equal(apiDate('2026-10-24T08:00:00Z'),'2026-10-24T08:00:00.000Z');
  assert.equal(apiDate('bad'),null);
  assert.equal(parseChapter({...chapterFixture,chapter:'Экстра'}).number,-1);
});
test('paid and delayed access is explicit; a paid preview is never returned as the whole chapter', () => {
  const paid={...reader,is_paid:true,is_bought:false,price:'15.00',pub_date:'2026-12-07T00:00:00'};
  assert.throws(()=>parsePages(paid),e=>e.code==='chapter_unavailable'&&e.access.type==='paid'&&e.access.priceLabel==='15.00');
  assert.equal(chapterAccess(paid).availableAt,'2026-12-06T21:00:00.000Z');
  assert.equal(parsePages({...paid,is_bought:true}).length,3);
  assert.throws(()=>parsePages({...reader,is_published:false,pub_date:'2027-01-01'}),e=>e.access?.type==='temporarilyUnavailable');
  assert.throws(()=>parsePages({...reader,pages:[]}),e=>e.code==='parse_error');
});
test('all reader segments retain their order, duplicates, signatures and optional API-declared server selection', () => {
  assert.deepEqual(parsePages(reader),[
    {index:0,imageUrl:'https://img3.reimg2.org/a.jpg?sig=keep'},
    {index:1,imageUrl:'https://img3.reimg2.org/b.jpg'},
    {index:2,imageUrl:'https://img3.reimg2.org/a.jpg?sig=keep'},
  ]);
  assert.equal(parsePages(reader,{imageServer:'primary'})[0].imageUrl,'https://img3.reimg.org/a.jpg?sig=keep');
  assert.equal(parsePages({...reader,pages:[[{link:'https://other.reimg.org/keep.jpg'}]]},{imageServer:'primary'})[0].imageUrl,'https://other.reimg.org/keep.jpg');
  assert.throws(()=>parsePages({...reader,pages:[[{}]]}),e=>e.code==='parse_error');
});

test('automatic reader server uses the API reserve when the primary image CDN is blocked', async () => {
  const blocked = {...reader,server:{link:'https://img.reimg.org/',fallback_link:'https://img-reserve.reimg2.org/'},pages:[
    [{link:'https://img.reimg.org/images/title/1.webp?signature=a%2Bb&expires=42'}],
    [{link:'/images/title/2.webp?signature=second'},{link:'https://other.reimg.org/unchanged.webp'}],
  ]};
  const pages = parsePages(blocked);
  assert.deepEqual(pages,[
    {index:0,imageUrl:'https://img-reserve.reimg2.org/images/title/1.webp?signature=a%2Bb&expires=42'},
    {index:1,imageUrl:'https://img-reserve.reimg2.org/images/title/2.webp?signature=second'},
    {index:2,imageUrl:'https://other.reimg.org/unchanged.webp'},
  ]);
  // The persisted default from older package versions takes the same path.
  assert.deepEqual(parsePages(blocked,{imageServer:'original'}),pages);
  assert.deepEqual(parsePages(blocked,{imageServer:'reserve'}),pages);
  assert.equal(parsePages(blocked,{imageServer:'primary'})[0].imageUrl,'https://img.reimg.org/images/title/1.webp?signature=a%2Bb&expires=42');
  assert.equal(parsePages({...blocked,server:{link:blocked.server.link}})[0].imageUrl,'https://img.reimg.org/images/title/1.webp?signature=a%2Bb&expires=42');
  let calls=0;
  const source=createRemanga(context(async()=>{calls++;return reply(blocked)}));
  assert.deepEqual(await source.getPages({chapterId:'1976293'}),pages);
  assert.equal(calls,1); // No CDN probes or title requests in JavaScript.
});
test('Next filter data is parsed as JSON across script chunks without running JavaScript', () => {
  const text=`6:${JSON.stringify(['$','$L1',null,{filtersOptions:options}])}\n`;
  const cut=Math.floor(text.length/2);
  const chunks=[`self.__next_f.push(${JSON.stringify([1,text.slice(0,cut)])});`,`self.__next_f.push(${JSON.stringify([1,text.slice(cut)])})`];
  assert.deepEqual(parseFilterOptions(chunks),options);
  const filters=buildFilters(parseFilterOptions([flight(options)]));
  assert.equal(filters.find(f=>f.key==='genres').kind,'triStateMultiSelect');
  assert.equal(filters.find(f=>f.key==='categories').kind,'triStateMultiSelect');
  assert.deepEqual(filters.find(f=>f.key==='age_limit').options,[{value:'0',label:'Для всех',caption:null}]);
  assert.deepEqual(filters.find(f=>f.key==='unstrict_search_fields').defaultValues,['genres','categories']);
  assert.throws(()=>parseFilterOptions(['self.__next_f.push((globalThis.bad=true,[]))']),e=>e.code==='parse_error');
  assert.equal(globalThis.bad,undefined);
  assert.throws(()=>buildFilters({...options,genres:null}),e=>e.code==='parse_error');
});
test('search uses API IDs, direction, include/exclude lists, ranges and explicit empty loose-search selection', () => {
  const query=searchParameters({searchTerm:' A&B / + ',page:2,selectedFilters:{sort:['rating','asc'],
    genres:['include:3','exclude:5','include:3','bad'],categories:['exclude:6'],types:['include:1','exclude:2'],status:['1'],age_limit:['0'],
    'count_chapters.min':['50'],'rating.max':['9.5'],'issue_year.min':['2020'],'issue_year.max':['bad'],unstrict_search_fields:[]}});
  assert.deepEqual(query,{count:30,page:2,ordering:'rating',search:'A&B / +',types:['1'],exclude_types:['2'],genres:['3'],exclude_genres:['5'],
    exclude_categories:['6'],status:['1'],age_limit:['0'],count_chapters_gte:50,rating_lte:9.5,issue_year_gte:2020});
  assert.equal(searchParameters({}).ordering,'-score');
  assert.equal(searchParameters({selectedFilters:{sort:['rating','asc']}},'chapter_date').ordering,'-chapter_date');
});
test('details and chapters share one in-flight title request; main branch pages stop at server next', async () => {
  const urls=[];
  const source=createRemanga(context(async req=>{
    const url=new URL(req.url);urls.push(url);
    if(url.pathname.includes('/chapters/'))return reply(url.searchParams.get('page')==='1'?{results:[chapterFixture],next:2}:{results:[{...chapterFixture,id:102,chapter:'9'}],next:null});
    return reply({...fixture,description:'<p>Описание</p>'});
  },{html:{extract:async(body)=>body==='scripts'?[]:'Описание'}}));
  const [details,chapters]=await Promise.all([source.getDetails({mangaId:fixture.dir}),source.getChapters({mangaId:fixture.dir})]);
  assert.equal(details.description,'Описание'); assert.deepEqual(chapters.map(c=>c.id),['101','102']);
  assert.equal(urls.filter(u=>u.pathname.includes('titles/%3Cdate%3Etitle/')).length,1);
  assert.equal(urls.filter(u=>u.pathname.endsWith('/chapters/')).length,2);
  assert.ok(urls.filter(u=>u.pathname.endsWith('/chapters/')).every(u=>u.searchParams.get('branch_id')==='11'&&u.searchParams.get('count')==='50'));
  await source.getChapters({mangaId:fixture.dir}); assert.equal(urls.length,3);
});
test('all branches are opt-in, chapter IDs are deduplicated and stalled pagination is rejected', async () => {
  const source=createRemanga(context(async req=>reply(req.url.includes('/chapters/')?{results:[chapterFixture],next:null}:fixture),
    {settings:{get:async()=>({branchMode:'all'})}}));
  assert.equal((await source.getChapters({mangaId:fixture.dir})).length,1);
  const stalled=createRemanga(context(async req=>reply(req.url.includes('/chapters/')?{results:[],next:2}:fixture)));
  await assert.rejects(stalled.getChapters({mangaId:fixture.dir}),e=>e.code==='parse_error');
});
test('catalog, latest, mirror headers and special query strings each need only one HTTP request', async () => {
  const requests=[];
  const source=createRemanga(context(async req=>{requests.push(req);return reply({results:[fixture],next:null})},{baseUrl:'https://mirror.example'}));
  await source.getPopular({page:1});await source.getLatest({page:2});await source.search({page:1,searchTerm:'A&B / +',selectedFilters:{sort:['views','asc']}});
  assert.equal(requests.length,3);assert.ok(requests.every(req=>req.url.startsWith(api+'/')&&req.headers.Referer==='https://mirror.example/'&&req.headers.Origin==='https://mirror.example'));
  assert.equal(new URL(requests[1].url).searchParams.get('ordering'),'-chapter_date');
  assert.equal(new URL(requests[2].url).searchParams.get('search'),'A&B / +');
  assert.ok(requests.every(req=>!('Cookie'in req.headers)&&!('Authorization'in req.headers)));
});
test('filters coalesce in flight, refresh explicitly and never cache failures', async () => {
  let calls=0,extracts=0,fail=true;
  const source=createRemanga(context(async()=>{calls++;if(fail)throw Object.assign(Error('blocked'),{code:'challenge_required'});return reply('<script>data</script>')},
    {html:{extract:async()=>{extracts++;return [flight(options)]}}}));
  await assert.rejects(source.getFilters(),e=>e.code==='challenge_required');fail=false;
  const [one,two]=await Promise.all([source.getFilters(),source.getFilters()]);assert.deepEqual(one,two);assert.equal(calls,2);assert.equal(extracts,1);
  await source.getFilters({refresh:true});assert.equal(calls,3);
});
test('only an explicit invalid pagination page becomes an empty success; authorization and rate limits propagate once', async () => {
  for(const error of [{code:'auth_required',httpStatus:401},{code:'access_denied',httpStatus:403},{code:'rate_limited',httpStatus:429},
    {code:'not_found',httpStatus:404,body:{detail:'Endpoint missing'}}]){
    let calls=0;const source=createRemanga(context(async()=>{calls++;throw error}));
    await assert.rejects(source.getPopular({page:2}),e=>e===error);assert.equal(calls,1);
  }
  const source=createRemanga(context(async()=>{throw {code:'not_found',httpStatus:404,body:{detail:'Invalid page.'}}}));
  assert.deepEqual(await source.getPopular({page:2}),[]);
  await assert.rejects(source.getPopular({page:1}),e=>e.httpStatus===404);
  assert.deepEqual(await source.getRecommendations({mangaId:'title',page:2}),{items:[],page:2,hasNextPage:false});
});
test('paid chapter requires one chapter call; reader settings do not trigger catalog or title refetch', async () => {
  let calls=0;const source=createRemanga(context(async()=>{calls++;return reply({...reader,is_paid:true,is_bought:false,pages:[]})}));
  await assert.rejects(source.getPages({mangaId:'title',chapterId:'101'}),e=>e.code==='chapter_unavailable');
  assert.equal(calls,1);
});
