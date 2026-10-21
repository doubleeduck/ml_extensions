import test from 'node:test';
import assert from 'node:assert/strict';
import createMangaShi,{parseDetails} from '../src/sources/mangashi.mjs';

const options = {tags:[{value:'action',parent:{span:'Боевик'}}],years:[{value:'2021',label:'2021'}]};
const card = {href:'/manga/demo/',title:'Demo',image:{src:'/cover.webp'},type:'Манга',badges:[]};
function context(extract) {
  const calls=[];
  return {calls,http:{request:async request=>{calls.push(request);return {url:request.url,body:request.url};}},
    html:{extract:async(body,projection)=>extract(new URL(body),projection)}};
}
test('MangaShi warms options from the first catalog and uses HTMX cards on subsequent listings', async()=>{
  const ctx=context((url,projection)=>{
    if(projection.fields.options) return {items:[card],options};
    assert.ok(projection.fields.items);return {items:[card]};
  });
  const source=createMangaShi(ctx);
  await source.getPopular();const filters=await source.getFilters();
  assert.equal(filters.find(f=>f.key==='tags').options[0].value,'action');
  assert.equal(ctx.calls.length,1);assert.equal(ctx.calls[0].headers['HX-Request'],undefined);
  await source.getPopular({page:2});await source.getLatest();
  await source.search({page:3,selectedFilters:{tags:['include:action','exclude:horror']}});
  assert.ok(ctx.calls.slice(1).every(r=>r.headers['HX-Request']==='true'));
  const query=new URL(ctx.calls.at(-1).url).searchParams;
  assert.equal(query.get('page'),'3');assert.deepEqual(query.getAll('tag'),['action']);assert.deepEqual(query.getAll('exclude_tag'),['horror']);
});
test('MangaShi treats empty option lists as loaded and refreshes them only explicitly', async()=>{
  const ctx=context((url,projection)=>projection.fields.items ? {items:[]} : {tags:[],years:[]});
  const source=createMangaShi(ctx);await source.getFilters();await source.getFilters();
  assert.equal(ctx.calls.length,1);
  await source.getPopular();assert.equal(ctx.calls[1].headers['HX-Request'],'true');
  await source.getFilters({refresh:true});assert.equal(ctx.calls.length,3);
  assert.equal(ctx.calls[2].headers['HX-Request'],undefined);
});
test('MangaShi narrow metadata keeps creators, alternate titles, year and description',()=>{
  const details=parseDetails({title:'Demo',hero:{description:'Summary',badges:['Манга','• Завершён']},tags:['#Боевик'],metadata:[
    {label:'Автор:',value:'Writer'},{label:'Художник:',value:'Artist'},{label:'Год:',value:'2021'},{label:'Другие названия:',value:'A / B'},
  ]},'/manga/demo/');
  assert.equal(details.author,'Writer');assert.equal(details.artist,'Artist');assert.equal(details.releaseYear,'2021');
  assert.equal(details.description,'Summary');assert.equal(details.secondaryTitle,'A, B');assert.equal(details.status,'completed');
});
test('MangaShi shares title parsing and caches the completed chapter list across paired reads',async()=>{
  let extractions=0;
  const chapter=(number)=>({href:`/manga/demo/glava-${number}/`,title:`Глава ${number}`,text:'01.10.2026'});
  const ctx=context((url,projection)=>{
    extractions++;
    if(url.pathname.endsWith('/chapters/')) return {items:[chapter(1)],next:null};
    assert.equal(projection.fields.details.fields.metadata.fields.children,undefined);
    assert.equal(projection.fields.chapters.fields.items.ascend,1);
    return {details:{title:'Demo',hero:{badges:[]},tags:[],metadata:[]},related:null,
      chapters:{items:[chapter(2)],next:'/manga/demo/chapters/?page=2'}};
  });
  const source=createMangaShi(ctx);
  await source.getDetails({mangaId:'/manga/demo/'});
  assert.deepEqual((await source.getChapters({mangaId:'/manga/demo/'})).map(c=>c.number),[2,1]);
  await source.getRecommendations({mangaId:'/manga/demo/'});await source.getChapters({mangaId:'/manga/demo/'});
  assert.equal(ctx.calls.length,2);assert.equal(extractions,2);
  assert.equal(ctx.calls[1].headers['HX-Request'],'true');
});
test('MangaShi rejects looping pagination and retries a failed chapter fragment',async()=>{
  let fail=true;
  const ctx=context((url)=>{
    if(url.pathname.endsWith('/chapters/')) { if(fail){fail=false;throw Object.assign(Error('offline'),{code:'network'});}return {items:[],next:null};}
    return {chapters:{items:[],next:'/manga/demo/chapters/?page=2'}};
  });
  const source=createMangaShi(ctx);
  await assert.rejects(source.getChapters({mangaId:'/manga/demo/'}),{code:'network'});
  assert.deepEqual(await source.getChapters({mangaId:'/manga/demo/'}),[]);assert.equal(ctx.calls.length,3);
  const loop=createMangaShi(context(()=>({chapters:{items:[],next:'/manga/demo/'}})));
  await assert.rejects(loop.getChapters({mangaId:'/manga/demo/'}),error=>error.code==='parse_error');
});
