import test from 'node:test';
import assert from 'node:assert/strict';
import createInkStory from '../src/sources/inkstory.mjs';
import createPureManga from '../src/sources/puremanga.mjs';
import {sourceDefinitions} from '../src/definitions.mjs';

const chapterId='11111111-1111-4111-8111-111111111111';
const genreId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',tagId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const labels=[{id:genreId,slug:'fantasy',name:'Фэнтези',kind:'GENRE'},{id:tagId,slug:'magic',name:'Магия',kind:'TAG'}];
const book={id:'book-id',slug:'demo',name:{ru:'Название',en:'Title'},poster:'https://static.inuko.me/book/full.jpeg',description:'Fixture',chaptersCount:1,readingRestriction:'NONE',labels};
const rows=[{id:chapterId,number:1,volume:1,branchId:'main'}];
const markup=data=>`<script>$_TSR.router=($R=>$R[0]=${JSON.stringify(data)})($R["tsr"]);</script>`;
function fixture(create,{baseUrl='https://source.example',failBook=false,failCatalog=false,restricted=false,authorized=false,expired=false,login=false,empty=false}={}){
 const calls=[];let bookFailed=false,catalogFailed=false;
 const source=create({baseUrl,auth:{async status(){return {authorized};}},http:{async request(input){
  calls.push(input);const url=new URL(input.url);let data;
  if(url.pathname==='/content/demo/chapters'){
   if(failBook&&!bookFailed){bookFailed=true;throw Object.assign(Error('timeout'),{code:'timeout'});}
   data={book:{...book,readingRestriction:restricted?'AUTHORIZED_ONLY':'NONE'},chapters:restricted&&(!authorized||expired)?[]:rows};
  }else if(url.pathname==='/content/demo/'+chapterId)data={book:{...book,readingRestriction:restricted?'AUTHORIZED_ONLY':'NONE'},pages:restricted&&(!authorized||expired)?[]:[{index:0,image:'https://static.inuko.me/chapters/aaaaaaaa-aaaa-saaa-aaaa-aaaaaaaaaaaa.webp?sig=keep'}]};
  else if(url.pathname==='/content/demo')data={relatedBooks:[book,{...book,slug:'other'}, {...book,slug:'other'}]};
  else if(url.pathname==='/content'){
   if(failCatalog&&!catalogFailed){catalogFailed=true;throw Object.assign(Error('timeout'),{code:'timeout'});}
   data={books:empty?[]:[book],labels,total:80};
  }else throw Error('Unexpected path '+url.pathname);
  return {status:200,url:input.url,body:login?'<html>Login</html>':markup(data)};
 }},html:{async extract(body){return {scripts:[...body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1])};}}});
 return {source,calls};
}
for(const [name,create] of [['InkStory',createInkStory],['PureManga',createPureManga]]){
 test(`${name}: details and all chapters share one SSR load and retain title/chapter IDs`,async()=>{
  const {source,calls}=fixture(create);const [details,chapters]=await Promise.all([source.getDetails({mangaId:'/content/demo'}),source.getChapters({mangaId:'/content/demo'})]);
  assert.equal(details.id,'/content/demo');assert.equal(details.title,'Название');assert.deepEqual(chapters.map(row=>row.id),['/content/demo/'+chapterId]);
  await source.getDetails({mangaId:'/content/demo'});await source.getChapters({mangaId:'/content/demo'});assert.equal(calls.length,1);assert.equal(new URL(calls[0].url).pathname,'/content/demo/chapters');
 });
 test(`${name}: failed title requests retry and never leak caches into another source context`,async()=>{
  const {source,calls}=fixture(create,{failBook:true});await assert.rejects(source.getDetails({mangaId:'/content/demo'}),{code:'timeout'});
  await Promise.all([source.getDetails({mangaId:'/content/demo'}),source.getChapters({mangaId:'/content/demo'})]);assert.equal(calls.length,2);
  const other=fixture(create);await other.source.getDetails({mangaId:'/content/demo'});assert.equal(other.calls.length,1);
 });
 test(`${name}: popular and filters share in-flight catalog work but manual catalog refresh stays fresh`,async()=>{
  const {source,calls}=fixture(create);const [popular,filters]=await Promise.all([source.getPopular(),source.getFilters()]);
  assert.equal(calls.length,1);assert.equal(popular.length,1);assert.ok(Array.isArray(popular));assert.ok(filters.find(row=>row.key==='tags'));
  await source.getPopular();assert.equal(calls.length,2);await source.getFilters();assert.equal(calls.length,2);
 });
 test(`${name}: latest explicitly uses update sorting and preserves zero-based pagination`,async()=>{
  const {source,calls}=fixture(create);const result=await source.getLatest({page:3,selectedFilters:{sort:['averageRating','asc']}});
  const query=new URL(calls[0].url).searchParams;assert.equal(query.get('sort'),'latestChapterAt');assert.equal(query.get('orderBy'),'desc');assert.equal(query.get('page'),'2');assert.equal(result.length,1);
 });
 test(`${name}: tag and genre selections resolve to UUID arrays with ranges and sort direction on each page`,async()=>{
  const {source,calls}=fixture(create);await source.getFilters();
  const selectedFilters={genre:['include:fantasy'],tags:['exclude:magic'],status:['ONGOING'],contentStatus:['UNSAFE'],yearMin:['2020'],averageRatingMin:['9,2'],strictLabelEqual:['true'],sort:['averageRating','asc']};
  for(const page of [1,2])await source.search({page,searchTerm:' Demo ',selectedFilters});
  assert.equal(calls.length,3);
  for(const [index,input] of calls.slice(1).entries()){
   const q=new URL(input.url).searchParams;assert.deepEqual(JSON.parse(q.get('labelsInclude')),[genreId]);assert.deepEqual(JSON.parse(q.get('labelsExclude')),[tagId]);
   assert.deepEqual(JSON.parse(q.get('contentStatus')),['UNSAFE']);assert.equal(q.get('page'),String(index));assert.equal(q.get('search'),'Demo');assert.equal(q.get('sort'),'averageRating');assert.equal(q.get('orderBy'),'asc');assert.equal(q.get('averageRatingMin'),'9.2');
  }
 });
 test(`${name}: taxonomy failures retry, concurrent loads coalesce, refresh requests new data`,async()=>{
  const {source,calls}=fixture(create,{failCatalog:true});await assert.rejects(source.getFilters(),{code:'timeout'});await Promise.all([source.getFilters(),source.getFilters()]);assert.equal(calls.length,2);await source.getFilters({refresh:true});assert.equal(calls.length,3);
 });
 test(`${name}: reading uses full original pages and validates chapter membership before HTTP`,async()=>{
  const {source,calls}=fixture(create);await assert.rejects(source.getPages({mangaId:'/content/demo',chapterId:'/content/other/'+chapterId}),{code:'parse_error'});assert.equal(calls.length,0);
  const pages=await source.getPages({mangaId:'/content/demo',chapterId:'/content/demo/'+chapterId});assert.equal(pages.length,1);assert.match(pages[0].imageUrl,/-xaaa-/);assert.ok(pages[0].imageUrl.endsWith('?sig=keep'));assert.equal(calls.length,1);
 });
 test(`${name}: restricted titles retain metadata and require login instead of reporting empty chapters`,async()=>{
  const {source}=fixture(create,{restricted:true});assert.equal((await source.getDetails({mangaId:'/content/demo'})).title,'Название');
  await assert.rejects(source.getChapters({mangaId:'/content/demo'}),{code:'auth_required'});await assert.rejects(source.getPages({mangaId:'/content/demo',chapterId:'/content/demo/'+chapterId}),{code:'auth_required'});
  const logged=fixture(create,{restricted:true,authorized:true});assert.equal((await logged.source.getChapters({mangaId:'/content/demo'})).length,1);
  const expired=fixture(create,{restricted:true,authorized:true,expired:true});
  await assert.rejects(expired.source.getChapters({mangaId:'/content/demo'}),{code:'auth_required'});
  await assert.rejects(expired.source.getPages({mangaId:'/content/demo',chapterId:'/content/demo/'+chapterId}),{code:'auth_required'});
 });
 test(`${name}: recommendations exclude self/duplicates and stop without extra HTTP`,async()=>{
  const {source,calls}=fixture(create);const result=await source.getRecommendations({mangaId:'/content/demo'});assert.deepEqual(result.items.map(row=>row.id),['/content/other']);
  assert.deepEqual((await source.getRecommendations({mangaId:'/content/demo',page:2})).items,[]);assert.equal(calls.length,1);
 });
 test(`${name}: empty pages stop even with stale totals; login HTML is never an empty catalog`,async()=>{
  const empty=fixture(create,{empty:true});assert.deepEqual(await empty.source.getPopular(),[]);
  const login=fixture(create,{login:true});await assert.rejects(login.source.getPopular(),{code:'parse_error'});
 });
 test(`${name}: custom base applies to every request and no legacy public API is called`,async()=>{
  const {source,calls}=fixture(create,{baseUrl:'https://mirror.example'});await source.getPopular();await source.getDetails({mangaId:'/content/demo'});await source.getPages({mangaId:'/content/demo',chapterId:'/content/demo/'+chapterId});
  assert.ok(calls.every(input=>new URL(input.url).origin==='https://mirror.example'&&input.headers.Referer==='https://mirror.example/'));
 });
}
test('both registrations scope SSO cookies to their own source and preserve original image decoding',()=>{
 for(const id of ['ru.inkstory','ru.puremanga']){
  const source=sourceDefinitions().find(source=>source.id===id);assert.ok(source.capabilities.includes('account'));assert.deepEqual(source.auth.rules.cookieAll,['__otaku_session']);assert.ok(source.auth.cookieOrigins.includes('https://sso.inuko.me'));assert.equal(source.media.transform.algorithm,'xor');assert.equal(source.media.transform.marker,'x');
 }
});
