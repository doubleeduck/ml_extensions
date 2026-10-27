import test from 'node:test';
import assert from 'node:assert/strict';
import createComX,{isChallenge} from '../src/sources/comx.mjs';
import {sourceDefinitions} from '../src/definitions.mjs';
import {catalogRequest,chapterId,parseChapters,parseDetails,parseFilters,parseListing,parsePages,titleId} from '../src/sources/comx_parser.mjs';

const base='https://com-x.life',dataScript=value=>`window.__DATA__=${JSON.stringify(value)};window.__COMMENTS__={};`;
const chapter={news_id:7,chapters:[{id:99,posi:1,number:1,title:'# 1',pages:2,date:'27.10.2026'},{id:100,posi:2,number:1.5,volume:2,title:'Бонус',date:'26.10.2026'}],limit:30};
const row={link:'/7-name.html',title:'Title / Название',image:{src:'data:image/gif;base64,placeholder',lazy:'https://rus.com-x.life/cover.webp'},metadata:['Publisher','2026']};
const details={title:'Название',secondaryTitle:'Title',description:'Описание',image:{src:'/cover-full.jpg'},rating:'4.5 100 голосов',metadata:[{label:'Автор:',value:'Автор: Writer'},{label:'Год:',value:'Год: 2026'}],tags:['Фэнтези'],scripts:[dataScript(chapter)],recommendations:[row,{...row,link:'/8-other.html',title:'Другое'}]};
const filterData={filter_items:Object.fromEntries([['p.cat','Раздел'],['g','Жанры'],['t','Тип выпуска'],['st','Статус']].map(([key,title])=>[key,{title,format:'list',values:[{id:1,value:'Первый'},{id:2,value:'Второй'}]}]))};
const filterScripts=[`window.__XFILTER__=${JSON.stringify(filterData)};`];
const reader={news_id:7,chapter_id:99,host:'img.com-x.life',host_ru:'rus.com-x.life',pages:2,images:['7/99/one.jpg?sig=keep','7/99/two.webp']};
function fixture({fail=null,mirror=base}={}) {
  const calls=[];let failed=false;
  const source=createComX({baseUrl:mirror,settings:{get:async()=>({})},auth:{getSession:async()=>({cookieHeader:'dle_user_id=1; dle_password=fixture; cx_imghost=rus'})},
    http:{request:async input=>{calls.push(input);if(fail&&!failed){failed=true;throw fail;}return {status:200,url:input.url,body:input.url.includes('/reader/')?'reader':input.url.includes('7-manga')?'title':'catalog'};}},
    html:{extract:async(body,p)=>body==='reader'?[dataScript(reader)]:body==='title'?details:p.selector?.startsWith('#dle-content')?[row]:filterScripts}});
  return {source,calls};
}
test('Com-X registration scopes real login cookies separately from browser verification and grants both image servers',()=>{
  const d=sourceDefinitions().find(d=>d.id==='ru.comx');assert.equal(d.isNsfw,false);assert.deepEqual(d.auth.rules.cookieAll,['dle_user_id','dle_password']);assert.equal(d.network.transportProfile,'host.platform.v1');assert.ok(d.network.imageOrigins.includes('https://rus.com-x.life'));assert.ok(d.features.recommendations&&d.features.auth&&d.supportsCustomBaseUrl);
});
test('Com-X numeric title IDs survive slugs and mirror names; reader IDs cannot escape the route',()=>{
  for(const value of ['7','/7-old-name.html','https://mirror.example/7-renamed.html?x=1'])assert.equal(titleId(value),'7');
  assert.deepEqual(chapterId('/reader/7/99'),{title:'7',chapter:'99'});
  for(const value of ['../7/99','7/99/else','0/99','7/not-number'])assert.throws(()=>chapterId(value),e=>e.code==='parse_error');
});
test('Com-X listing prefers real lazy covers, preserves full title, deduplicates canonical numeric IDs and ignores placeholders',()=>{
  const result=parseListing([row,{...row,link:'/7-new-slug.html'},{...row,link:'/8-other.html',image:{src:'data:image/png;base64,x'}}],base);
  assert.equal(result.length,1);assert.equal(result[0].title,'Название');assert.equal(result[0].secondaryTitle,'Title');assert.equal(result[0].coverUrl,row.image.lazy);
});
test('Com-X details strip definition labels, retain original/full cover and read only the explicit recommendation block',()=>{
  const result=parseDetails(details,base);assert.equal(result.info.author,'Writer');assert.equal(result.info.releaseYear,'2026');assert.equal(result.info.rating,9);assert.equal(result.info.coverUrl,`${base}/cover-full.jpg`);assert.deepEqual(result.recommendations.map(r=>r.id),['8']);
});
test('Com-X consumes the complete embedded chapter list, including fractional numbers, without per-chapter requests',()=>{
  const values=parseChapters({...chapter,limit:1},'7');assert.deepEqual(values.map(c=>c.id),['7/100','7/99']);assert.equal(values[0].number,1.5);assert.equal(values[1].uploadedAt,'2026-10-27T00:00:00.000Z');assert.throws(()=>parseChapters(chapter,'8'),e=>e.code==='parse_error');
});
test('Com-X details, chapters and recommendations share one title HTTP call and failed reads are retryable',async()=>{
  const {source,calls}=fixture({fail:Object.assign(Error('timeout'),{code:'timeout'})});await assert.rejects(source.getDetails({mangaId:'7'}),e=>e.code==='timeout');
  const [d,c,r]=await Promise.all([source.getDetails({mangaId:'7'}),source.getChapters({mangaId:'7'}),source.getRecommendations({mangaId:'7'})]);assert.equal(d.id,'7');assert.equal(c.length,2);assert.equal(r.items.length,1);assert.equal(calls.length,2);await source.getRecommendations({mangaId:'7',page:2});assert.equal(calls.length,2);
});
test('Com-X detects custom 404 verification and successful HTML challenge responses without retry loops',async()=>{
  const body='<script>function showTs(){}</script>Для доступа к сайту необходимо включить JavaScript.';
  assert.equal(isChallenge(body),true);assert.equal(isChallenge('normal','https://com-x.life/_c?t=x'),true);assert.equal(isChallenge('<html>Не найдено</html>'),false);
  const {source,calls}=fixture({fail:Object.assign(Error('404'),{code:'not_found',httpStatus:404,body})});await assert.rejects(source.getLatest({page:2}),e=>e.code==='challenge_required');assert.equal(calls.length,1);
});
test('Com-X ordinary missing later pages end pagination and unrelated HTTP errors remain errors',async()=>{
  const missing=fixture({fail:Object.assign(Error('404'),{code:'not_found',httpStatus:404,body:'Missing page'})});assert.deepEqual(await missing.source.getLatest({page:3}),[]);
  const offline=fixture({fail:Object.assign(Error('offline'),{code:'offline'})});await assert.rejects(offline.source.getLatest(),e=>e.code==='offline');
});
test('Com-X inspects a protected POST redirect with GET because the host does not replay POSTs',async()=>{
  const calls=[];
  const source=createComX({baseUrl:base,http:{request:async input=>{
    calls.push(input.method);
    if(input.method==='POST')throw Object.assign(Error('POST redirects are not replayed automatically'),{code:'invalid_response',phase:'http'});
    throw Object.assign(Error('404'),{code:'not_found',httpStatus:404,body:'<script>function showTs(){}</script>'});
  }}});
  await assert.rejects(source.getPopular(),e=>e.code==='challenge_required');assert.deepEqual(calls,['POST','GET']);
});
test('Com-X catalog serializes actual include/exclude and year paths with request-local form sorting',()=>{
  const request=catalogRequest(base,{page:2,selectedFilters:{sort:['title','asc'],'p.cat':['include:3'],g:['include:42','exclude:29'],yearFrom:['2020'],yearTo:['2026'],a:['Jeff Lemire']}});
  assert.equal(request.method,'POST');assert.match(request.url,/\/ComicList\/p.cat=3\/g=42\/exc_g=29\/y\[from\]=2020\/y\[to\]=2026\/a=Jeff%20Lemire\/page\/2\/$/u);
  const body=new URLSearchParams(request.body);assert.equal(body.get('dlenewssortby'),'title');assert.equal(body.get('dledirection'),'asc');assert.equal(body.get('set_new_sort'),'dle_sort_xfilter');assert.equal(new URLSearchParams(catalogRequest(base).body).get('set_new_sort'),'dle_sort_cat_1');
});
test('Com-X catalog and title search stay separate instead of silently dropping filters or sorting',()=>{
  assert.equal(catalogRequest(base,{searchTerm:'Название'}).method,'GET');
  assert.equal(catalogRequest(base,{searchTerm:'Название',page:2}).url,`${base}/search/${encodeURIComponent('Название')}/page/2/`);
  assert.throws(()=>catalogRequest(base,{searchTerm:'Название',selectedFilters:{g:['include:42']}}),e=>e.code==='unsupported');assert.throws(()=>catalogRequest(base,{searchTerm:'Название',selectedFilters:{sort:['title','asc']}}),e=>e.code==='unsupported');
  for(const selectedFilters of [{g:['include:../x']},{yearFrom:['NaN']},{sort:['unknown']}])assert.throws(()=>catalogRequest(base,{selectedFilters}),e=>e.code==='parse_error');
});
test('Com-X popular/latest parallel calls explicitly select different ordering',async()=>{
  const {source,calls}=fixture();await Promise.all([source.getPopular(),source.getLatest()]);assert.deepEqual(calls.map(c=>new URLSearchParams(c.body).get('dlenewssortby')),['rating','editdate']);
});
test('Com-X filters support tri-state options and do not fetch author suggestions per keystroke',async()=>{
  const f=parseFilters(filterScripts);assert.equal(f.find(f=>f.key==='g').kind,'triStateMultiSelect');assert.equal(f.find(f=>f.key==='a').kind,'text');
  const {source,calls}=fixture();await Promise.all([source.getFilters(),source.getFilters()]);await source.getFilters();assert.equal(calls.length,1);await source.getFilters({refresh:true});assert.equal(calls.length,2);
});
test('Com-X reader selects the saved regional host and preserves signed full-page URLs',()=>{
  const scripts=[dataScript(reader)];const pages=parsePages(scripts,'7/99',{cookieHeader:'cx_imghost=rus'});assert.equal(pages.length,2);assert.equal(pages[0].imageUrl,'https://rus.com-x.life/comix/7/99/one.jpg?sig=keep');assert.equal(parsePages(scripts,'7/99',{server:'global'})[0].imageUrl,'https://img.com-x.life/comix/7/99/one.jpg?sig=keep');
  for(const data of [{...reader,pages:3},{...reader,images:[]},{...reader,host:'evil.example'},{...reader,images:['../../foreign.jpg','7/99/2.jpg']}])assert.throws(()=>parsePages([dataScript(data)],'7/99'));
});
test('Com-X custom base and reader membership are checked without changing independent CDN origins',async()=>{
  const {source,calls}=fixture({mirror:'https://mirror.example'});await source.getDetails({mangaId:'7'});const pages=await source.getPages({mangaId:'7',chapterId:'7/99'});assert.equal(calls[0].url,'https://mirror.example/7-manga.html');assert.equal(pages[0].imageUrl,'https://rus.com-x.life/comix/7/99/one.jpg?sig=keep');const before=calls.length;await assert.rejects(source.getPages({mangaId:'8',chapterId:'7/99'}),e=>e.code==='parse_error');assert.equal(calls.length,before);
});
