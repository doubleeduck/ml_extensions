import test from 'node:test';
import assert from 'node:assert/strict';
import createSenkuro,{buildFilters,filterVariables,mapManga,mapChapters} from '../src/engines/senkuro.mjs';
const title = (id = '1') => ({id,slug:`slug-${id}`,titles:[{lang:'EN',content:'English'},{lang:'RU',content:'Русский'}],cover:{original:{url:'https://cdn.senkuro.me/a.jpg'}}});

test('latest feed sends the same order variables as an explicit latest-upload sort', async () => {
  for (const [sourceId,baseUrl] of [['ru.senkuro','https://senkuro.me'],['ru.nsfw.senkognito','https://senkognito.com']]) {
    const calls = [], source = createSenkuro({sourceId,baseUrl,http:{request:async request => {
      calls.push(request); return {body:{data:{mangas:{edges:[{node:title()}],pageInfo:{hasNextPage:false}}}}};
    }}});
    await source.getLatest();
    await source.search({selectedFilters:{sort:['LAST_CHAPTER_AT','desc']}});
    assert.equal(calls[0].body.variables.orderField,'LAST_CHAPTER_AT');
    assert.equal(calls[0].body.variables.orderDirection,'DESC');
    assert.deepEqual(calls[0].body,calls[1].body);
    assert.equal(calls[0].url,sourceId === 'ru.senkuro' ? 'https://api.senkuro.me/graphql' : 'https://api.senkognito.com/graphql');
  }
});
test('Senkuro variants retain dynamic label visibility and range/sort filter API spelling', () => {
  const labels = [{rootId:'TEFCRUw6NQ',slug:'action',depth:1,titles:[{lang:'EN',content:'Action'}]},{rootId:'TEFCRUw6Mg',slug:'adult',depth:1,titles:[{lang:'EN',content:'Adult'}]}];
  assert.equal(buildFilters(labels,true).length,13); assert.equal(buildFilters(labels,false).length,14);
  assert.deepEqual(filterVariables({'translationStatus':['include:FINISHED'],'chapters.min':['100'],'chapters.max':['20'],'releasedYear.min':['2026'],'releasedYear.max':['2000'],sort:['score','asc']},true),{
    translitionStatus:{include:['FINISHED']},label:{exclude:['hentai']},chapters:{start:20,end:100},releasedOn:{start:'2000-01-01',end:'2026-01-01'},orderField:'SCORE',orderDirection:'ASC'});
});
test('Senkuro composite manga/chapter IDs, localized titles, staff and teams remain unchanged', () => {
  const details = mapManga({...title(),originalName:{content:'Original'},alternativeNames:[{content:'Other'}],type:'MANGA',rating:'GENERAL',status:'ONGOING',translationStatus:'IN_PROGRESS',formats:['WEB'],labels:[],
    localizations:[{lang:'RU',description:'Summary'}],mainStaff:[{roles:['STORY','ART'],person:{name:'A'}}]},{details:true});
  assert.equal(details.id,'1,,slug-1'); assert.equal(details.title,'Русский'); assert.equal(details.secondaryTitle,'English'); assert.equal(details.author,'A'); assert.equal(details.artist,'A');
  assert.equal(mapChapters({teams:[{id:'t',name:'Team'}],chapters:[{id:'c',slug:'chapter',number:'1.5',volume:'1',teamIds:['t'],createdAt:'2020-01-02T00:00:00Z'}]},details.id)[0].id,'1,,slug-1,,c,,chapter');
});
test('Senkuro cursor fan-out is scoped per source instance and context; GraphQL errors cannot look like empty success', async () => {
  const calls = [], source = createSenkuro({sourceId:'ru.senkuro',baseUrl:'https://senkuro.me',http:{request:async input => {calls.push(input);
    const after = input.body.variables.after; return {body:{data:{mangas:{edges:[{node:title()}],pageInfo:{hasNextPage:true,endCursor:`cursor${after == null ? 1 : Number(after.slice(6))+1}`}}}}};}}});
  assert.equal((await source.getPopular({page:2})).length,1); assert.equal(calls.length,2); assert.equal(calls[1].body.variables.after,'cursor1');
  await source.getPopular({page:3}); assert.equal(calls.length,3); assert.equal(calls[2].body.variables.after,'cursor2');
  const failed = createSenkuro({sourceId:'ru.nsfw.senkognito',baseUrl:'https://senkognito.com',http:{request:async () => ({body:{errors:[{message:'private arbitrary text'}]}})}});
  await assert.rejects(failed.getDetails({mangaId:'1,,slug'}),error => error.code === 'invalid_response' && !error.message.includes('private'));
});

test('Senkuro overlapping pagination shares cursor requests, remembers the end and resets cursors on refresh', async () => {
  let generation = 'old'; const calls = [];
  const source = createSenkuro({sourceId:'ru.senkuro',baseUrl:'https://senkuro.me',http:{request:async input => {
    const after = input.body.variables.after; calls.push(after);
    await new Promise(resolve => setImmediate(resolve));
    const page = after == null ? 1 : Number(after.split('-')[1]);
    return {body:{data:{mangas:{edges:[{node:title(String(page))}],pageInfo:{hasNextPage:page < 3,endCursor:`${generation}-${page+1}`}}}}};
  }}});
  const [second,third,duplicate] = await Promise.all([source.getPopular({page:2}),source.getPopular({page:3}),source.getPopular({page:3})]);
  assert.equal(second[0].id,'2,,slug-2'); assert.equal(third[0].id,'3,,slug-3'); assert.deepEqual(third,duplicate);
  assert.deepEqual(calls,[null,'old-2','old-3']);
  assert.deepEqual(await source.getPopular({page:4}),[]); assert.equal(calls.length,3);
  generation = 'new';
  await source.getPopular(); await source.getPopular({page:2});
  assert.deepEqual(calls.slice(3),[null,'new-2']);
});

test('Senkuro filter calls share work and retry taxonomy after a transient failure', async () => {
  let calls = 0;
  const source = createSenkuro({sourceId:'ru.senkuro',baseUrl:'https://senkuro.me',http:{request:async () => {
    calls++; await new Promise(resolve => setImmediate(resolve));
    if (calls === 1) throw Object.assign(Error('offline'),{code:'network'});
    return {body:{data:{allLabels:[{rootId:'TEFCRUw6NQ',slug:'action',depth:1,titles:[{lang:'RU',content:'Action'}]}]}}};
  }}});
  const fallback = await Promise.all([source.getFilters(),source.getFilters()]);
  assert.equal(calls,1); assert.deepEqual(fallback[0],fallback[1]);
  const filters = await source.getFilters();
  assert.equal(calls,2); assert.ok(filters.some(filter => filter.options?.some(option => option.value === 'action')));
  await source.getFilters(); assert.equal(calls,2);
});
