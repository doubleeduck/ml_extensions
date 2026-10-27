import test from 'node:test';
import assert from 'node:assert/strict';
import createAstraManga from '../src/sources/astramanga.mjs';
import {sourceDefinitions} from '../src/definitions.mjs';
import {catalogQuery,numericId,parseChapters,parseFilters,parseManga,parsePages,parseTitleData} from '../src/sources/astramanga_parser.mjs';

const base='https://astramanga.org',api='https://api.astramanga.org';
const book={id:123,name:'Название',slug:'slug',cover_image:'titles/123/cover.jpg',cover_versions:{high:'titles/123/high.webp'},secondary_name:'Title',description:'Описание',
  genres:[{id:1,name:'Фэнтези'}],tags:[{id:2,name:'Магия'}],creators:[{type:'author',name:'Автор'},{type:'artist',name:'Художник'}],status:'ongoing',type:'manhwa',year:2024,rating:9.2,age_limit:1};
const titleData={manga:book,chapters:[{id:100,number:1,volume_number:1,name:'Глава 1',published_at:'2026-10-27T00:00:00Z'},{id:101,number:1.5,volume_number:1,name:'Бонус'}]};
const script=data=>`self.__next_f.push(${JSON.stringify([1,'7:'+JSON.stringify(data)+'\n'])});`;
const titleScripts=[script({initialData:titleData})],filterScripts=[script({initialFilters:{genres:[],tags:[]},genres:book.genres,tags:book.tags})];
function fixture({mirror=base,failTitle=false,failFilters=false}={}) {
  const calls=[];let failedTitle=false,failedFilters=false;
  const source=createAstraManga({baseUrl:mirror,parameters:{apiBaseUrl:api},http:{request:async req=>{
    calls.push(req);const url=new URL(req.url);
    if(url.pathname==='/catalog' && failFilters&&!failedFilters){failedFilters=true;throw Object.assign(Error('blocked'),{code:'challenge_required'});}
    if(url.pathname==='/manga/123' && failTitle&&!failedTitle){failedTitle=true;throw Object.assign(Error('offline'),{code:'offline'});}
    let body=url.origin===new URL(mirror).origin ? url.pathname==='/catalog'?'filters':'title' : {success:true,data:{titles:[book]}};
    if(url.pathname.endsWith('/pages'))body={success:true,data:{pages:[{page_number:2,image_url:'https://img.astramanga.org/2.webp?keep=yes'},{page_number:1,image_url:'https://img.astramanga.org/1.webp'}]}};
    if(url.pathname.endsWith('/relations'))body={data:[{related_title:book},{related_title:{...book,id:124,name:'Связанное'}}]};
    if(url.pathname.endsWith('/similar'))body={data:[{...book,id:124},{...book,id:125,name:'Похожее'}]};
    return {status:200,url:req.url,body};
  }},html:{extract:async body=>body==='filters'?filterScripts:titleScripts}});
  return {source,calls};
}
test('AstraManga declares non-adult reading, exact cookie auth, own branding and platform transport',()=>{
  const d=sourceDefinitions().find(d=>d.id==='ru.astramanga');assert.equal(d.isNsfw,false);assert.equal(d.metadataOnly,false);
  assert.deepEqual(d.auth.rules.cookieAll,['access_token']);assert.ok(d.auth.cookieOrigins.includes(api));assert.equal(d.network.transportProfile,'host.platform.v1');assert.equal(d.branding.icon,'assets/source_logos/astramanga.png');
  assert.ok(d.features.recommendations&&d.features.auth&&d.supportsCustomBaseUrl);
});
test('AstraManga metadata uses full preview, named creators, both labels and the actual 16+/18+ enum',()=>{
  const d=parseManga(book,base);assert.equal(d.id,'123');assert.equal(d.coverUrl,`${base}/media/titles/123/high.webp`);assert.equal(d.author,'Автор');assert.equal(d.artist,'Художник');assert.deepEqual(d.tags,['Фэнтези','Магия']);assert.equal(d.ageRating,'16+');assert.equal(parseManga({...book,age_limit:2},base).ageRating,'18+');
});
test('AstraManga parses the server-selected chapter branch and preserves fractional chapters',()=>{
  const data=parseTitleData(titleScripts);assert.deepEqual(parseChapters(data).map(c=>c.id),['101','100']);assert.match(parseChapters(data)[0].title,/1\.5: Бонус/u);
  assert.equal(parseChapters({chapters:[]}).length,0);assert.throws(()=>parseTitleData([script({initialData:{manga:book}})]),e=>e.code==='parse_error');
});
test('AstraManga shares one in-flight title read between details and chapters and retries failures',async()=>{
  const {source,calls}=fixture({failTitle:true});await assert.rejects(source.getDetails({mangaId:'123'}),e=>e.code==='offline');
  const [d,c]=await Promise.all([source.getDetails({mangaId:'123'}),source.getChapters({mangaId:'123'})]);assert.equal(d.id,'123');assert.equal(c.length,2);assert.equal(calls.length,2);
});
test('AstraManga filter data ignores empty selections and includes genres, tags and ranges',()=>{
  const f=parseFilters(filterScripts);assert.equal(f.find(f=>f.key==='genres').kind,'triStateMultiSelect');assert.equal(f.find(f=>f.key==='tags').options[0].value,'2');assert.ok(f.some(f=>f.key==='chapter_count_to'));
});
test('AstraManga filter refresh coalesces reads and does not retain a failed load',async()=>{
  const {source,calls}=fixture({failFilters:true});await assert.rejects(source.getFilters(),e=>e.code==='challenge_required');
  await Promise.all([source.getFilters(),source.getFilters()]);assert.equal(calls.length,2);await source.getFilters();assert.equal(calls.length,2);await source.getFilters({refresh:true});assert.equal(calls.length,3);
});
test('AstraManga search serializes include/exclude labels, ranges, strict match, direction and pagination',()=>{
  const q=catalogQuery({page:2,searchTerm:' Тайтл ',selectedFilters:{sort:['name','asc'],genres:['include:1','exclude:2'],tags:['include:3'],types:['manhwa'],status:['ongoing'],rating_from:['9,5'],strict_filtering:['true']}});
  assert.deepEqual(q,{page:2,size:24,sort:'name',q:'Тайтл',types:['manhwa'],status:['ongoing'],genres:['1'],exclude_genres:['2'],tags:['3'],rating_from:9.5,strict_filtering:true});
  for(const query of [{sort:['unknown']},{genres:['exclude:../']},{year_from:['NaN']},{rating_to:['11']}])assert.throws(()=>catalogQuery({selectedFilters:query}),e=>e.code==='parse_error');
});
test('AstraManga popular and latest requests never inherit each other sorting',async()=>{
  const {source,calls}=fixture();await Promise.all([source.getPopular({page:2}),source.getLatest()]);assert.equal(new URL(calls[0].url).searchParams.get('sort'),'-popularity');assert.equal(new URL(calls[1].url).searchParams.get('sort'),'-updated_at');assert.equal(new URL(calls[0].url).searchParams.get('page'),'2');
});
test('AstraManga recommendations combine related and similar blocks, remove self and duplicates, and terminate',async()=>{
  const {source,calls}=fixture();const r=await source.getRecommendations({mangaId:'123'});assert.deepEqual(r.items.map(i=>i.id),['124','125']);assert.equal(r.hasNextPage,false);assert.deepEqual((await source.getRecommendations({mangaId:'123',page:2})).items,[]);assert.equal(calls.length,2);
});
test('AstraManga pages preserve every full URL in server page order and reject partial malformed results',()=>{
  assert.deepEqual(parsePages({data:{pages:[{page_number:2,image_url:'https://img.astramanga.org/2?sig=keep'},{page_number:1,image_url:'https://img.astramanga.org/1'}]}}).map(p=>p.imageUrl),['https://img.astramanga.org/1','https://img.astramanga.org/2?sig=keep']);
  assert.throws(()=>parsePages({data:{pages:[]}}),e=>e.code==='chapter_unavailable');assert.throws(()=>parsePages({data:{pages:[{}]}}),e=>e.code==='parse_error');
  assert.throws(()=>parsePages({data:{total:2,pages:[{page_number:1,image_url:'https://img.astramanga.org/1'}]}}),e=>e.code==='chapter_unavailable');
});
test('AstraManga custom mirror is used for HTML and referer without rewriting its independent API',async()=>{
  const {source,calls}=fixture({mirror:'https://mirror.example'});await source.getDetails({mangaId:'123'});await source.getPopular();assert.equal(calls[0].url,'https://mirror.example/manga/123');assert.equal(new URL(calls[1].url).origin,api);assert.equal(calls[1].headers.Referer,'https://mirror.example/');
  for(const id of ['../x','https://elsewhere/123','0','123/456'])assert.throws(()=>numericId(id),e=>e.code==='parse_error');
});
