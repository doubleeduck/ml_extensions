import test from 'node:test';
import assert from 'node:assert/strict';
import createWeebCentral,{buildFilters,searchUrl,seriesId,chapterId,parseCatalog,parseDetails,parseChapters} from '../src/sources/weebcentral.mjs';
import {sourceDefinitions} from '../src/definitions.mjs';

const row = (name,value,links = []) => ({labels:[name],text:`${name} ${value}`,links,items:[]});
const card = id => ({main:{href:`/series/${id}`,text:id},source:'/cover/small/one.webp 1x',tags:['Action','Action'],rows:[row('Status:','Complete'),row('Type:','Manga')]});
test('WeebCentral preserves all filter keys/options and repeated creator/status/type/tag values', () => {
  const filters = buildFilters(); assert.equal(filters.length,8); assert.equal(filters.find(item => item.key === 'tag').options.length,38);
  const url = new URL(searchUrl({page:2,searchTerm:'One-Piece: (test)!',selectedFilters:{author:[' HAROLD Sakuishi ','A B'],sort:['Alphabet','asc'],status:['Complete','Ongoing'],type:['Manga','Manhwa'],tag:['include:Action','exclude:Adult','include:']}}));
  assert.equal(url.pathname,'/search/data'); assert.equal(url.searchParams.get('offset'),'32'); assert.equal(url.searchParams.get('text'),'One Piece test');
  assert.equal(url.searchParams.get('order'),'Ascending'); assert.deepEqual(url.searchParams.getAll('author'),['HAROLD Sakuishi','A B']);
  assert.deepEqual(url.searchParams.getAll('included_status'),['Complete','Ongoing']); assert.deepEqual(url.searchParams.getAll('included_type'),['Manga','Manhwa']);
  assert.deepEqual(url.searchParams.getAll('included_tag'),['Action']); assert.deepEqual(url.searchParams.getAll('excluded_tag'),['Adult']);
  assert.equal(new URL(searchUrl({},'Popularity')).searchParams.get('sort'),'Popularity');
});
test('WeebCentral IDs, larger picture srcset covers and duplicate cards keep legacy semantics', () => {
  assert.equal(seriesId('https://weebcentral.com/series/ABC/title'),'ABC'); assert.equal(chapterId('/chapters/CH-1/images'),'CH-1');
  const items = parseCatalog([card('A'),card('A'),card('B')]); assert.deepEqual(items.map(item => item.id),['A','B']);
  assert.equal(items[0].coverUrl,'https://weebcentral.com/cover/normal/one.webp'); assert.deepEqual(items[0].tags,['Action']); assert.equal(items[0].status,'completed');
});
test('WeebCentral ignores metadata wrappers with multiple labels instead of combining authors and tags', () => {
  const data = {sections:[{source:'/cover/small/a.webp',rows:[{labels:['Author(s):','Tag(s):'],text:'all metadata',links:['WRONG'],items:[]},
    row('Author(s):','Author',['Author']),row('Tags:','Action',['Action']),row('Adult content:','Yes')]},
  {heading:'Title',rows:[row('Description:','Text'),{...row('Associated Name(s):','Other'),items:['Other']},{...row('Related Series(s):','Related'),items:['Related']}]}]};
  const manga = parseDetails(data,'A','https://weebcentral.com/series/canonical');
  assert.equal(manga.id,'canonical'); assert.equal(manga.author,'Author'); assert.equal(manga.artist,'Author'); assert.deepEqual(manga.tags,['Action']);
  assert.equal(manga.ageRating,'18+'); assert.equal(manga.secondaryTitle,'Other'); assert.equal(manga.description,'Text\n\nAssociated Name(s):\n- Other\n\nRelated Series(s):\n- Related');
});
test('WeebCentral chapter IDs retain /chapters/ prefix, fractional numbers and UTC dates', () => {
  const chapters = parseChapters([{href:'/chapters/ABC',title:'Chapter 2.5',date:'2020-01-02T03:04:05Z'}]);
  assert.equal(chapters[0].id,'/chapters/ABC'); assert.equal(chapters[0].number,2.5); assert.equal(chapters[0].uploadedAt,'2020-01-02T03:04:05.000Z');
  assert.deepEqual(parseChapters([]),[]);
});
test('WeebCentral reader/recommendation pagination does not request nonexistent extra pages', async () => {
  let requests = 0;
  const source = createWeebCentral({http:{request:async input => {requests++;assert.ok(input.url.includes('reading_style=long_strip'));return {url:input.url,body:'html'};}},html:{extract:async () => ['https://hot.planeptune.us/1.png','/2.png']}});
  assert.deepEqual(await source.getRecommendations({mangaId:'A',page:2}),{items:[],page:2,hasNextPage:false}); assert.equal(requests,0);
  assert.deepEqual(await source.getPages({chapterId:'/chapters/ABC'}),[{index:0,imageUrl:'https://hot.planeptune.us/1.png'},{index:1,imageUrl:'https://weebcentral.com/2.png'}]);
  await assert.rejects(source.getPages({chapterId:'/bad/'}),error => error.code === 'parse_error');
});
test('WeebCentral grants the image host used by Kurotsuki no Yaergnacht chapters', async () => {
  const definition = sourceDefinitions().find(source => source.id === 'en.weebcentral');
  const imageUrl = 'https://scans.lastation.us/manga/kurotsuki-no-yaergnacht/0001-001.png';
  let requests = 0;
  const source = createWeebCentral({http:{request:async input => {
    requests++;
    assert.equal(new URL(input.url).pathname,'/chapters/01KK1PHEG6RT59JN9196S0Z8AC/images');
    return {url:input.url,body:'chapter images'};
  }},html:{extract:async (_html,projection) => {
    assert.equal(projection.selector,'section[x-data*=scroll] img, section[x-data~=scroll] img');
    return [imageUrl];
  }}});
  const pages = await source.getPages({chapterId:'/chapters/01KK1PHEG6RT59JN9196S0Z8AC'});
  assert.deepEqual(pages,[{index:0,imageUrl}]);
  assert.ok(definition.network.imageOrigins.includes(new URL(pages[0].imageUrl).origin));
  assert.ok(definition.network.imageOrigins.includes('https://planeptune.us'));
  assert.equal(definition.media.refererOrigin,'https://weebcentral.com');
  assert.equal(requests,1);
});
