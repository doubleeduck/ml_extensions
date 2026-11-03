import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceDefinitions} from '../src/definitions.mjs';
import {catalogQuery,largestBranch,normalizeImageUrl,parseChapters,parseManga,parsePages} from '../src/sources/puremanga_parser.mjs';

const uuid='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
const book={id:'book-uuid',slug:'demo',name:{ru:'Название',en:'Title'},poster:'https://static.inuko.me/book/full.webp',description:'Описание',status:'ONGOING',type:'COMIC',year:2024,averageRating:9.4,
  labels:[{slug:'fantasy',name:'Фэнтези',kind:'GENRE'},{slug:'magic',name:'Магия',kind:'TAG'}],relations:[{type:'AUTHOR',publisher:{name:'Writer'}},{type:'ARTIST',publisher:{name:'Artist'}}]};
const rows=[{id:uuid,number:1,volume:1,branchId:'main',name:'Начало',createdAt:'2026-10-27T00:00:00Z'},{id:second,number:1.5,volume:1,branchId:'main',title:'Бонус'}];
const pageUrl=`https://static.inuko.me/chapters/${uuid}/aaaaaaaa-aaaa-saaa-aaaa-aaaaaaaaaaaa.webp?sig=keep`;
const genreId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',tagId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',excludedId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const labels=[{...book.labels[0],id:genreId},{...book.labels[1],id:tagId},{slug:'drama',name:'Драма',kind:'GENRE',id:excludedId}];
test('PureManga belongs to the standard package with a new ID and retains SSO and the page decoder',()=>{
  const d=sourceDefinitions().find(d=>d.id==='ru.puremanga');assert.equal(d.isNsfw,false);assert.equal(d.metadataOnly,false);assert.equal(d.network.origins.some(url=>url.includes('api.inuko.me')),false);assert.deepEqual(d.auth.rules.cookieAll,['__otaku_session']);assert.ok(d.auth.cookieOrigins.includes('https://sso.inuko.me'));assert.ok(d.auth.cookieOrigins.includes('https://inuko.me'));assert.equal(d.network.transportProfile,'host.platform.v1');assert.equal(d.media.transform.algorithm,'xor');assert.equal(d.media.transform.marker,'x');
});
test('PureManga metadata retains original cover, authors, genre/tag labels and release data',()=>{
  const d=parseManga(book);assert.equal(d.id,'/content/demo');assert.equal(d.coverUrl,book.poster);assert.equal(d.author,'Writer');assert.equal(d.artist,'Artist');assert.deepEqual(d.tags,['Фэнтези','Магия']);assert.equal(d.releaseYear,'2024');
});
test('PureManga never mixes alternative chapter branches or lets duplicates alter branch selection',()=>{
  const alternatives=[...rows,{...rows[0]},{...rows[0],id:'alternate',branchId:'other'}];assert.deepEqual(largestBranch(alternatives).map(c=>c.id),[uuid,second]);assert.deepEqual(parseChapters(alternatives,'/content/demo').map(c=>c.id),[`/content/demo/${second}`,`/content/demo/${uuid}`]);assert.match(parseChapters(rows,'/content/demo')[0].title,/Том 1\. Глава 1\.5: Бонус/u);
});
test('PureManga page normalization selects the encrypted full original and preserves signing query parameters',()=>{
  const pages=parsePages({pages:[{index:1,image:'https://static.inuko.me/2.jpg'},{index:0,image:pageUrl}]});assert.equal(pages.length,2);assert.equal(pages[0].imageUrl,pageUrl.replace('-saaa-','-xaaa-'));assert.equal(pages[1].index,1);assert.equal(normalizeImageUrl('https://other.example/a.jpg'),'https://other.example/a.jpg');
  for(const value of [{pages:[{index:0}]},{pages:[{index:0,image:'javascript:bad'}]},{pages:null},{pages:[{index:-1,image:pageUrl}]}])assert.throws(()=>parsePages(value),e=>e.code==='parse_error');
});
test('PureManga converts existing slug label selections to website UUIDs and validates filter values',()=>{
  const q=catalogQuery({selectedFilters:{genre:['include:fantasy'],tags:[`exclude:${tagId}`]}},undefined,labels);assert.deepEqual(JSON.parse(q.labelsInclude),[genreId]);assert.deepEqual(JSON.parse(q.labelsExclude),[tagId]);
  for(const selectedFilters of [{contentStatus:['INVALID']},{genre:['unknown']},{ratingMin:['unused'],yearMin:['NaN']},{sort:['invalid']},{averageRatingMin:['11']}])assert.throws(()=>catalogQuery({selectedFilters}),e=>e.code==='parse_error');
});
