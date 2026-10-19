import test from 'node:test';
import assert from 'node:assert/strict';
import createSenkuro,{buildFilters,filterVariables,mapManga,mapChapters} from '../src/engines/senkuro.mjs';
const title = (id = '1') => ({id,slug:`slug-${id}`,titles:[{lang:'EN',content:'English'},{lang:'RU',content:'Русский'}],cover:{original:{url:'https://cdn.senkuro.me/a.jpg'}}});
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
    const after = input.body.variables.after; return {body:{data:{mangas:{edges:[{node:title()}],pageInfo:{hasNextPage:true,endCursor:after == null ? 'cursor1' : 'cursor2'}}}}};}}});
  assert.equal((await source.getPopular({page:2})).length,1); assert.equal(calls.length,2); assert.equal(calls[1].body.variables.after,'cursor1');
  await source.getPopular({page:3}); assert.equal(calls.length,3); assert.equal(calls[2].body.variables.after,'cursor2');
  const failed = createSenkuro({sourceId:'ru.senkognito',baseUrl:'https://senkognito.com',http:{request:async () => ({body:{errors:[{message:'private arbitrary text'}]}})}});
  await assert.rejects(failed.getDetails({mangaId:'1,,slug'}),error => error.code === 'invalid_response' && !error.message.includes('private'));
});
