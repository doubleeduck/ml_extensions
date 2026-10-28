import test from 'node:test';
import assert from 'node:assert/strict';
import createPureManga from '../src/sources/puremanga.mjs';
import {sourceDefinitions} from '../src/definitions.mjs';
import {catalogQuery,largestBranch,normalizeImageUrl,parseChapters,parseFilters,parseListing,parseManga,parsePages} from '../src/sources/puremanga_parser.mjs';

const base='https://v1.puremanga.me',api='https://api.inuko.me/v2/',uuid='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
const book={id:'book-uuid',slug:'demo',name:{ru:'Название',en:'Title'},poster:'https://static.inuko.me/book/full.webp',description:'Описание',status:'ONGOING',type:'COMIC',year:2024,averageRating:9.4,
  labels:[{slug:'fantasy',name:'Фэнтези',kind:'GENRE'},{slug:'magic',name:'Магия',kind:'TAG'}],relations:[{type:'AUTHOR',publisher:{name:'Writer'}},{type:'ARTIST',publisher:{name:'Artist'}}]};
const rows=[{id:uuid,number:1,volume:1,branchId:'main',name:'Начало',createdAt:'2026-10-27T00:00:00Z'},{id:second,number:1.5,volume:1,branchId:'main',title:'Бонус'}];
const pageUrl=`https://static.inuko.me/chapters/${uuid}/aaaaaaaa-aaaa-saaa-aaaa-aaaaaaaaaaaa.webp?sig=keep`;
const genreId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',tagId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',excludedId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const labels=[{...book.labels[0],id:genreId},{...book.labels[1],id:tagId},{slug:'drama',name:'Драма',kind:'GENRE',id:excludedId}];
const card={path:'/content/demo',image:{alt:book.name.ru,src:book.poster},metadata:['Япония • 2024',book.name.ru],rating:'9.4'};
function fixture({mirror=base,failBook=false,failLabels=false,catalogPages=null,catalogHeading='Каталог'}={}) {
  const calls=[];let failedBook=false,failedLabels=false;
  const source=createPureManga({baseUrl:mirror,parameters:{apiBaseUrl:api,serviceName:'puremanga.me'},http:{request:async input=>{
    calls.push(input);const u=new URL(input.url);let body;
    if(u.pathname.endsWith('/books/demo')){if(failBook&&!failedBook){failedBook=true;throw Object.assign(Error('auth'),{code:'auth_required'});}body=book;}
    else if(u.pathname.endsWith('/labels')){if(failLabels&&!failedLabels){failedLabels=true;throw Object.assign(Error('timeout'),{code:'timeout'});}body=labels;}
    else if(u.pathname.endsWith('/chapters'))body=rows;
    else if(u.pathname.endsWith(`/chapters/${uuid}`)||u.pathname.endsWith(`/chapters/${second}`))body={pages:[{index:1,image:'https://static.inuko.me/2.jpg'},{index:0,image:pageUrl}]};
    else if(u.pathname.endsWith('/chapter-update-feed'))body=[{book}];
    else if(u.origin===new URL(mirror).origin)body=u.pathname==='/content'?JSON.stringify({heading:catalogHeading,items:catalogPages?.[u.searchParams.get('page')]??[card]}):'recommendations';
    else body=[book];
    return {status:200,url:input.url,body};
  }},html:{extract:async body=>body==='recommendations'?{items:[{path:'/content/demo',image:{src:book.poster,alt:'Self'}},{path:'/content/other',image:{src:'https://static.inuko.me/other.webp',alt:'Похожее'}},{path:'/content/other',image:{src:book.poster,alt:'Duplicate'}}]}:JSON.parse(body)}});
  return {source,calls};
}
test('PureManga belongs to the standard package with a new ID and retains SSO and the page decoder',()=>{
  const d=sourceDefinitions().find(d=>d.id==='ru.puremanga');assert.equal(d.isNsfw,false);assert.equal(d.metadataOnly,false);assert.equal(d.parameters.serviceName,'puremanga.me');assert.deepEqual(d.auth.rules.cookieAll,['__otaku_session']);assert.ok(d.auth.cookieOrigins.includes('https://sso.inuko.me'));assert.ok(d.auth.cookieOrigins.includes('https://inuko.me'));assert.equal(d.network.transportProfile,'host.platform.v1');assert.equal(d.media.transform.algorithm,'xor');assert.equal(d.media.transform.marker,'x');
});
test('PureManga metadata retains original cover, authors, genre/tag labels and release data',()=>{
  const d=parseManga(book);assert.equal(d.id,'/content/demo');assert.equal(d.coverUrl,book.poster);assert.equal(d.author,'Writer');assert.equal(d.artist,'Artist');assert.deepEqual(d.tags,['Фэнтези','Магия']);assert.equal(d.releaseYear,'2024');
});
test('PureManga never mixes alternative chapter branches or lets duplicates alter branch selection',()=>{
  const alternatives=[...rows,{...rows[0]},{...rows[0],id:'alternate',branchId:'other'}];assert.deepEqual(largestBranch(alternatives).map(c=>c.id),[uuid,second]);assert.deepEqual(parseChapters(alternatives,'/content/demo').map(c=>c.id),[`/content/demo/${second}`,`/content/demo/${uuid}`]);assert.match(parseChapters(rows,'/content/demo')[0].title,/Том 1\. Глава 1\.5: Бонус/u);
});
test('PureManga details/chapters share one book read; chapter lists are cached and failed auth reads are retryable',async()=>{
  const {source,calls}=fixture({failBook:true});await assert.rejects(source.getDetails({mangaId:'/content/demo'}),e=>e.code==='auth_required');
  await Promise.all([source.getDetails({mangaId:'/content/demo'}),source.getChapters({mangaId:'/content/demo'})]);await source.getChapters({mangaId:'/content/demo'});assert.equal(calls.filter(c=>new URL(c.url).pathname.endsWith('/books/demo')).length,2);assert.equal(calls.filter(c=>new URL(c.url).pathname.endsWith('/chapters')).length,1);
});
test('PureManga catalog uses the complete website catalog with zero-based pages in one request',async()=>{
  const {source,calls}=fixture();await source.getPopular({page:2});const r=calls[0],u=new URL(r.url);assert.equal(u.origin,base);assert.equal(u.pathname,'/content');assert.equal(r.responseType,'text');assert.equal(u.searchParams.get('page'),'1');assert.equal(u.searchParams.get('size'),'40');assert.equal(u.searchParams.get('sort'),'viewsCount');assert.equal(u.searchParams.get('orderBy'),'desc');assert.equal(calls.length,1);
  await source.getDetails({mangaId:'/content/demo'});assert.equal(calls[1].headers['X-Service-Name'],'puremanga.me');
});
test('PureManga latest uses the chapter-update feed rather than inheriting catalog sorting',async()=>{
  const {source,calls}=fixture();await source.getLatest({page:3});const u=new URL(calls[0].url);assert.equal(u.pathname,'/v2/chapter-update-feed');assert.equal(u.searchParams.get('page'),'2');assert.equal(u.searchParams.get('onlyBorderChapters'),'true');
});
test('PureManga filters support genre/tag exclusion, strict matching, ranges and refresh after errors',async()=>{
  const parsed=parseFilters(book.labels);assert.equal(parsed.find(f=>f.key==='genre').kind,'triStateMultiSelect');assert.equal(parsed.find(f=>f.key==='tags').kind,'triStateMultiSelect');
  const {source,calls}=fixture({failLabels:true});await assert.rejects(source.getFilters(),e=>e.code==='timeout');await Promise.all([source.getFilters(),source.getFilters()]);await source.getFilters();assert.equal(calls.length,2);await source.getFilters({refresh:true});assert.equal(calls.length,3);
  await source.search({searchTerm:' Имя ',page:2,selectedFilters:{sort:['averageRating','asc'],genre:['include:fantasy','exclude:drama'],tags:['exclude:magic'],yearMin:['2020'],averageRatingMin:['9,2'],strictLabelEqual:['true']}});
  const u=new URL(calls.at(-1).url);assert.equal(u.searchParams.get('search'),'Имя');assert.deepEqual(JSON.parse(u.searchParams.get('labelsInclude')),[genreId]);assert.deepEqual(JSON.parse(u.searchParams.get('labelsExclude')),[excludedId,tagId]);assert.equal(u.searchParams.get('sort'),'averageRating');assert.equal(u.searchParams.get('orderBy'),'asc');assert.equal(u.searchParams.get('averageRatingMin'),'9.2');assert.equal(u.searchParams.get('strictLabelEqual'),'true');
});
test('PureManga page normalization selects the encrypted full original and preserves signing query parameters',()=>{
  const pages=parsePages({pages:[{index:1,image:'https://static.inuko.me/2.jpg'},{index:0,image:pageUrl}]});assert.equal(pages.length,2);assert.equal(pages[0].imageUrl,pageUrl.replace('-saaa-','-xaaa-'));assert.equal(pages[1].index,1);assert.equal(normalizeImageUrl('https://other.example/a.jpg'),'https://other.example/a.jpg');
  for(const value of [{pages:[{index:0}]},{pages:[{index:0,image:'javascript:bad'}]},{pages:null},{pages:[{index:-1,image:pageUrl}]}])assert.throws(()=>parsePages(value),e=>e.code==='parse_error');
});
test('PureManga rejects invalid or foreign title/chapter pairs before making a request',async()=>{
  const {source,calls}=fixture();await assert.rejects(source.getPages({mangaId:'/content/demo',chapterId:`/content/other/${uuid}`}),e=>e.code==='parse_error');await assert.rejects(source.getPages({mangaId:'/content/demo',chapterId:'../bad'}),e=>e.code==='parse_error');assert.equal(calls.length,0);
});
test('PureManga recommendations read only the similar section, remove duplicates and terminate without extra requests',async()=>{
  const {source,calls}=fixture();const r=await source.getRecommendations({mangaId:'/content/demo'});assert.deepEqual(r.items.map(i=>i.id),['/content/other']);assert.equal(r.hasNextPage,false);await source.getRecommendations({mangaId:'/content/demo',page:2});assert.equal(calls.length,1);
});
test('PureManga custom mirror applies to web requests and referer while its API/CDN stay independent',async()=>{
  const {source,calls}=fixture({mirror:'https://mirror.example'});await source.getRecommendations({mangaId:'/content/demo'});await source.getPopular();await source.getDetails({mangaId:'/content/demo'});assert.equal(calls[0].url,'https://mirror.example/content/demo');assert.equal(new URL(calls[1].url).origin,'https://mirror.example');assert.equal(new URL(calls[2].url).origin,'https://api.inuko.me');assert.equal(calls[2].headers.Referer,'https://mirror.example/');
});

test('PureManga exposes every website age rating and sends multiple selections as one JSON array',async()=>{
  const age=parseFilters(labels).find(f=>f.key==='contentStatus');assert.equal(age.label,'Возрастной рейтинг');assert.deepEqual(age.options.map(o=>o.value),['SAFE','UNSAFE','EROTIC','PORNOGRAPHIC']);
  const {source,calls}=fixture();await source.search({selectedFilters:{contentStatus:['EROTIC','PORNOGRAPHIC','EROTIC']}});
  const u=new URL(calls[0].url);assert.deepEqual(u.searchParams.getAll('contentStatus'),['["EROTIC","PORNOGRAPHIC"]']);assert.equal(calls.length,1);
});

test('PureManga retains filters on every subsequent page and returns only the requested page',async()=>{
  const {source,calls}=fixture({catalogPages:{0:[card],1:[{...card,path:'/content/next',image:{...card.image,alt:'Следующий'}}],2:[]}});
  const selectedFilters={contentStatus:['EROTIC'],status:['ONGOING'],sort:['createdAt','asc'],yearMin:['2020']};
  const results=[];for(const page of [1,2,3])results.push(await source.search({page,selectedFilters}));
  assert.deepEqual(results.map(items=>items.map(i=>i.id)),[['/content/demo'],['/content/next'],[]]);assert.equal(calls.length,3);
  for(const [index,call] of calls.entries()){const u=new URL(call.url);assert.equal(u.searchParams.get('page'),String(index));assert.equal(u.searchParams.get('contentStatus'),'["EROTIC"]');assert.equal(u.searchParams.get('status'),'["ONGOING"]');assert.equal(u.searchParams.get('yearMin'),'2020');assert.equal(u.searchParams.get('orderBy'),'asc');}
});

test('PureManga converts existing slug label selections to website UUIDs and validates filter values',()=>{
  const q=catalogQuery({selectedFilters:{genre:['include:fantasy'],tags:[`exclude:${tagId}`]}},undefined,labels);assert.deepEqual(JSON.parse(q.labelsInclude),[genreId]);assert.deepEqual(JSON.parse(q.labelsExclude),[tagId]);
  for(const selectedFilters of [{contentStatus:['INVALID']},{genre:['unknown']},{ratingMin:['unused'],yearMin:['NaN']},{sort:['invalid']},{averageRatingMin:['11']}])assert.throws(()=>catalogQuery({selectedFilters}),e=>e.code==='parse_error');
});

test('PureManga catalog uses full original covers, retains rating and year, and deduplicates cards',()=>{
  const item={...card,image:{...card.image,src:'https://static.inuko.me/book/id/cover/full.jpeg?width=320&type=jpeg&sig=keep'}};
  const result=parseListing([item,item]);assert.equal(result.length,1);assert.equal(result[0].coverUrl,'https://static.inuko.me/book/id/cover/full.jpeg?sig=keep');assert.equal(result[0].rating,9.4);assert.equal(result[0].releaseYear,'2024');assert.throws(()=>parseListing([{...item,image:{alt:'Missing image'}}]),e=>e.code==='parse_error');
});

test('PureManga never treats a login or unexpected page as an empty filtered catalog',async()=>{
  const {source}=fixture({catalogHeading:'Вход в аккаунт'});await assert.rejects(source.search({selectedFilters:{contentStatus:['EROTIC']}}),e=>e.code==='parse_error');
});
