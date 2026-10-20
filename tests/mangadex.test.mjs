import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import createMangaDex, {buildFilters, parseChapter, parseManga, searchParameters} from '../src/engines/mangadex.mjs';
import {tagGroups} from '../src/engines/mangadex_tags.mjs';
import {sourceDefinitions} from '../src/definitions.mjs';

test('both installed MangaDex variants advertise their implemented recommendations and preserve IDs', () => {
  const sources = sourceDefinitions().filter(source => source.id.endsWith('.mangadex'));
  assert.deepEqual(sources.map(source => source.id),['ru.mangadex','en.mangadex']);
  for (const source of sources) {
    assert.equal(source.features.recommendations,true);
    assert.ok(source.capabilities.includes('recommendations'));
    assert.ok(source.network.origins.includes('https://api.mangadex.org'));
    assert.equal(source.parameters.translatedLanguage,source.language);
  }
});

const item = (id = 'manga-opaque') => ({id,attributes:{title:{en:'English',ru:'Русское имя',ja:'日本語'},
  altTitles:[{en:'English'},{ja:'日本語'}],description:{en:'Description',ru:'Описание'},year:2025,status:'ongoing',
  publicationDemographic:'shounen',contentRating:'safe',tags:[{attributes:{name:{en:'Action',ru:'Боевик'}}}]},
  relationships:[{type:'cover_art',attributes:{fileName:'cover.png'}},
    {type:'author',attributes:{name:'AUTHOR'}},{type:'author',attributes:{name:'author'}},
    {type:'artist',attributes:{name:'Artist'}}]});
const chapter = (id, overrides = {}) => ({id,attributes:{volume:'2',chapter:'10.5',title:'Side story',pages:3,
  publishAt:'2025-04-15T12:00:00+03:00',...overrides}});
function context(handler, language = 'ru') {
  return {parameters:{translatedLanguage:language},http:{request:async request => ({body:await handler(new URL(request.url),request)})}};
}

test('localized metadata, tags, cover, creators and opaque IDs match the Dart contract', () => {
  const ru = parseManga(item(),'ru'), en = parseManga(item(),'en');
  assert.equal(ru.id,'manga-opaque'); assert.equal(ru.title,'Русское имя');
  assert.equal(ru.secondaryTitle,'English'); assert.equal(en.secondaryTitle,'日本語');
  assert.equal(ru.description,'Описание'); assert.equal(en.description,'Description');
  assert.equal(ru.author,'AUTHOR'); assert.equal(ru.artist,'Artist');
  assert.equal(ru.coverUrl,'https://uploads.mangadex.org/covers/manga-opaque/cover.png');
  assert.deepEqual(ru.tags,['Боевик']); assert.equal(ru.releaseYear,'2025');
  assert.equal(en.rating,null);
});
test('fractional chapter ID, title and timestamp survive the port', () => {
  const value = parseChapter(chapter('chapter-opaque'));
  assert.equal(value.id,'chapter-opaque'); assert.equal(value.number,10.5);
  assert.equal(value.title,'Vol. 2 Ch. 10.5 - Side story');
  assert.equal(value.uploadedAt,'2025-04-15T09:00:00.000Z');
  assert.equal(parseChapter(chapter('id',{chapter:0,title:null,volume:null})).title,'Ch. 0');
});
test('all static tag IDs and group keys match the independent compatibility fixture', () => {
  const {ids} = JSON.parse(readFileSync(new URL('./fixtures/mangadex-tags.json',import.meta.url),'utf8'));
  assert.deepEqual(tagGroups.flatMap(group => group.tags.map(tag => tag[0])),ids);
  assert.deepEqual(tagGroups.map(group => group.key),['content','format','genre','theme']);
  assert.equal(buildFilters().length,12);
});
test('search keeps array parameters, Chinese aliases and tri-state tag modes', () => {
  const query = searchParameters({searchTerm:'  a  b ',page:3,selectedFilters:{original_language:['zh'],
    has_available_chapters:['true'],content_rating:['erotica'],sort:['rating','asc'],
    genre:['include:one','exclude:two'],included_tags_mode:['OR']}},'ru');
  assert.equal(query.offset,40); assert.equal(query.title,'a b');
  assert.deepEqual(query['originalLanguage[]'],['zh','zh-hk']);
  assert.deepEqual(query['availableTranslatedLanguage[]'],['ru']);
  assert.deepEqual(query['contentRating[]'],['erotica']);
  assert.deepEqual(query['includedTags[]'],['one']); assert.equal(query.includedTagsMode,'OR');
  assert.deepEqual(query['excludedTags[]'],['two']); assert.equal(query.excludedTagsMode,'OR');
  assert.equal(query['order[rating]'],'asc');
});
test('language variants have separate contexts and preserve popular defaults', async () => {
  const languages = [];
  const handler = url => {
    languages.push(url.searchParams.get('availableTranslatedLanguage[]'));
    assert.deepEqual(url.searchParams.getAll('contentRating[]'),['safe','suggestive']);
    return {data:[item()]};
  };
  const ru = createMangaDex(context(handler,'ru')), en = createMangaDex(context(handler,'en'));
  assert.equal((await ru.getPopular())[0].title,'Русское имя');
  assert.equal((await en.getPopular())[0].title,'English');
  assert.deepEqual(languages,['ru','en']);
});
test('latest deduplicates chapter relationships but restores API chapter order', async () => {
  const source = createMangaDex(context(url => url.pathname === '/chapter' ?
    {data:['b','a','b'].map(id => ({relationships:[{type:'manga',id}]}))} : {data:[item('a'),item('b')]}));
  assert.deepEqual((await source.getLatest()).map(item => item.id),['b','a']);
});
test('chapter feed pagination skips external/empty chapters and cannot loop', async () => {
  const offsets = [];
  const source = createMangaDex(context(url => {
    const offset = Number(url.searchParams.get('offset')); offsets.push(offset);
    assert.equal(url.searchParams.get('translatedLanguage[]'),'ru');
    return offset === 0 ? {data:[chapter('1'),chapter('external',{externalUrl:'https://other.org'}),chapter('empty',{pages:0})],limit:3,offset:0,total:4} :
      {data:[chapter('2')],limit:3,offset:3,total:4};
  }));
  assert.deepEqual((await source.getChapters({mangaId:'id'})).map(item => item.id),['1','2']);
  assert.deepEqual(offsets,[0,3]);
  const stuck = createMangaDex(context(() => ({data:[chapter('1')],limit:0,offset:0,total:100})));
  await assert.rejects(stuck.getChapters({mangaId:'id'}),/did not advance/u);
});
test('at-home pages remain in response order, no replacement CDN is invented', async () => {
  const source = createMangaDex(context(url => {
    assert.equal(url.pathname,'/at-home/server/chapter-id');
    assert.equal(url.searchParams.get('forcePort443'),'true');
    return {baseUrl:'https://node.mangadex.org',chapter:{hash:'hash',data:['2.png','1.png']}};
  }));
  assert.deepEqual(await source.getPages({chapterId:'chapter-id'}),[
    {index:0,imageUrl:'https://node.mangadex.org/data/hash/2.png'},
    {index:1,imageUrl:'https://node.mangadex.org/data/hash/1.png'},
  ]);
});
test('recommendations exclude self, deduplicate and retain recommendation order', async () => {
  const source = createMangaDex(context(url => url.pathname.endsWith('/recommendation') ?
    {data:[{relationships:['self','b','a','b'].map(id => ({type:'manga',id}))}]} : {data:[item('a'),item('b')]}));
  const result = await source.getRecommendations({mangaId:'self'});
  assert.deepEqual(result.items.map(item => item.id),['b','a']);
  assert.equal(result.hasNextPage,false);
});
test('malformed responses and HTTP failures are errors, not successful empty lists', async () => {
  await assert.rejects(createMangaDex(context(() => ({unexpected:[]}))).getPopular(),error => error.code === 'parse_error');
  await assert.rejects(createMangaDex(context(() => { throw new Error('network'); })).search({searchTerm:'12345678-1234-1234-1234-123456789012'}),/network/u);
  assert.throws(() => parseManga({id:'id',attributes:{}}),error => error.code === 'parse_error');
});

test('MangaDex recommendation pages reuse relation IDs but preserve distinct page metadata', async () => {
  let relations=0;
  const source=createMangaDex(context(url=>{
    if(url.pathname.endsWith('/recommendation')) {relations++;return {data:[{relationships:Array.from({length:25},(_,i)=>({type:'manga',id:'r'+i}))}]};}
    return {data:url.searchParams.getAll('ids[]').reverse().map(id=>item(id))};
  }));
  const first=await source.getRecommendations({mangaId:'self'}), second=await source.getRecommendations({mangaId:'self',page:2});
  assert.equal(relations,1);assert.equal(first.items.length,20);assert.equal(first.hasNextPage,true);
  assert.deepEqual(second.items.map(x=>x.id),['r20','r21','r22','r23','r24']);assert.equal(second.hasNextPage,false);
});

test('invalid relation lists are not cached as a successful response', async () => {
  let calls=0; const source=createMangaDex(context(()=>++calls===1 ? {} : {data:[]}));
  await assert.rejects(source.getRecommendations({mangaId:'self'}),error=>error.code==='parse_error');
  assert.deepEqual((await source.getRecommendations({mangaId:'self'})).items,[]);assert.equal(calls,2);
});
