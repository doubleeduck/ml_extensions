import test from 'node:test';
import assert from 'node:assert/strict';
import createMangaFox,{buildFilters,directoryUrl,searchUrl,mangaId,chapterPath,parseListing,parseDetails,parseChapters,chapterDate} from '../src/sources/mangafox.mjs';

const row = (id,title = 'Title') => ({link:{href:`/manga/${id}/`,text:title},image:{original:'/cover.jpg'},authors:['Author','Author']});
test('MangaFox keeps 11 legacy filter keys, 37 genres and explicit empty defaults', () => {
  const filters = buildFilters();
  assert.equal(filters.length,11); assert.equal(filters.find(filter => filter.key === 'genre').options.length,37);
  assert.ok(filters.every(filter => filter.defaultValues.length === 0));
  assert.equal(filters.find(filter => filter.key === 'rating').options[0].value,'');
});
test('MangaFox URLs retain separate directory/latest and advanced creator/tri-state filters', () => {
  assert.equal(directoryUrl(1),'https://fanfox.net/directory/'); assert.equal(directoryUrl(2,true),'https://fanfox.net/directory/2.html?latest');
  const url = new URL(searchUrl({page:3,searchTerm:' Title ',selectedFilters:{type:['2'],st:['0'],author:['A & B'],artist:['C'],
    author_method:['bw'],released:['2020'],rating:['0'],genre:['include:1','include:2','exclude:7']}}));
  assert.equal(url.searchParams.get('title'),'Title'); assert.equal(url.searchParams.get('name'),'Title');
  assert.equal(url.searchParams.get('page'),'3'); assert.equal(url.searchParams.has('st'),false);
  assert.equal(url.searchParams.get('author'),'A & B'); assert.equal(url.searchParams.get('author_method'),'bw');
  assert.equal(url.searchParams.get('artist_method'),'cw'); assert.equal(url.searchParams.get('rating'),'0');
  assert.equal(url.searchParams.get('released_method'),'eq'); assert.equal(url.searchParams.get('genres'),'1,2'); assert.equal(url.searchParams.get('nogenres'),'7');
});
test('MangaFox opaque slugs/chapter paths and listing priority remain stable', () => {
  assert.equal(mangaId('https://fanfox.net/manga/one_piece/?x=1'),'one_piece');
  assert.equal(chapterPath('https://m.fanfox.net/manga/one_piece/v01/c001.5/1.html?x=1'),'/manga/one_piece/v01/c001.5/1.html');
  assert.equal(chapterPath('/not-a-chapter'),null);
  const parsed = parseListing({one:[row('one','First')],four:[row('one','Duplicate'),row('two')]});
  assert.deepEqual(parsed.map(item => item.id),['one','two']); assert.equal(parsed[0].title,'First');
  assert.equal(parsed[0].author,'Author'); assert.equal(parsed[0].coverUrl,'https://fanfox.net/cover.jpg');
  assert.deepEqual(parseListing({one:[row('one')],four:[row('two')]},{search:true}).map(item => item.id),['two']);
});
test('MangaFox details include row metadata, aliases, lazy cover and unique tags', () => {
  const parsed = parseDetails({info:{title:'Title',authors:['A'],tags:['Action','Action'],status:'Completed',rows:[
    {text:'Artist: B',links:['B']},{text:'Other names: Other',links:[]},{text:'Released: 2020',links:[]}]},cover:{lazy:'/cover.jpg'},full:' Long\n text '},'old','https://fanfox.net/manga/canonical/');
  assert.equal(parsed.id,'canonical'); assert.equal(parsed.artist,'B'); assert.equal(parsed.secondaryTitle,'Other');
  assert.equal(parsed.releaseYear,'2020'); assert.equal(parsed.status,'completed'); assert.equal(parsed.description,'Long text'); assert.deepEqual(parsed.tags,['Action']);
});
test('MangaFox chapter order and IDs are unchanged; empty list is an error', () => {
  const chapters = parseChapters([{href:'/manga/title/c001.5/1.html',title:'Ch. 1.5',date:'Jan 2, 2020'},
    {href:'/manga/title/c001.5/1.html',title:'Duplicate'},{href:'/manga/title/c001/1.html',title:'Chapter 1',date:'not a date'}]);
  assert.deepEqual(chapters.map(chapter => chapter.number),[1.5,1]); assert.equal(chapters[1].uploadedAt,null);
  assert.equal(chapterDate('yesterday',new Date(2020,0,3)),new Date(2020,0,2).toISOString());
  assert.throws(() => parseChapters([]),error => error.code === 'parse_error');
});
test('MangaFox reader requests mobile roll HTML without a JS Cookie header or discarded page', async () => {
  const requests = [];
  const source = createMangaFox({http:{request:async input => {requests.push(input);return {url:input.url,body:'html'};}},
    html:{extract:async () => [{original:'/first.jpg'},{src:'//cdn.fanfox.net/second.jpg'},{src:'/mobile/images/MF-Loading.gif'}]}});
  const pages = await source.getPages({mangaId:'title',chapterId:'/manga/title/c1/1.html'});
  assert.deepEqual(pages,[{index:0,imageUrl:'https://m.fanfox.net/first.jpg'},{index:1,imageUrl:'https://cdn.fanfox.net/second.jpg'}]);
  assert.equal(requests[0].url,'https://m.fanfox.net/roll_manga/title/c1/1.html'); assert.equal(requests[0].userAgentProfile,'mobileSafari');
  assert.equal(requests[0].headers.Referer,'https://m.fanfox.net/'); assert.equal(requests[0].headers.Cookie,undefined);
  await assert.rejects(source.getPages({chapterId:'invalid'}),error => error.code === 'parse_error');
});
