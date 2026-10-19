import test from 'node:test';
import assert from 'node:assert/strict';
import createIMHentai,{buildFilters,searchUrl,listingUrl,parseListing,parseDetails,parsePages} from '../src/sources/imhentai.mjs';
const base = 'https://imhentai.xxx';
for (const edition of ['all','en','ru']) {
  test(`IMHentai ${edition}: defaults, cleared languages, alternate and all languages`, () => {
    const filters = buildFilters(edition); assert.equal(filters.length,10);
    const language = filters.find(value => value.key === 'language');
    assert.deepEqual(language.defaultValues,edition === 'all' ? ['en','jp','es','fr','kr','de','ru'] : [edition]);
    assert.equal(searchUrl(base,edition,{selectedFilters:{language:[]}}),null);
    assert.equal(new URL(searchUrl(base,edition,{selectedFilters:{language:['jp']}})).pathname,'/language/japanese/');
    const all = new URL(searchUrl(base,edition,{selectedFilters:{language:['en','jp','es','fr','kr','de','ru']}}));
    if (edition === 'all') assert.equal(all.pathname,'/');
    else for (const {value} of language.options) assert.equal(all.searchParams.get(value),'1');
  });
  test(`IMHentai ${edition}: full alias and advanced exclusions are encoded exactly once`, () => {
    const url = new URL(searchUrl(base,edition,{page:2,searchTerm:'ignored by advanced endpoint',selectedFilters:{artists:['jairou | xil, -other artist'],tags:['a b'],language:['en','ru'],category:['d'],sort:['downloaded']}}));
    assert.equal(url.pathname,'/advsearch/'); assert.equal(url.searchParams.get('key'),'+tag:"a b" +artist:"jairou | xil" -artist:"other artist"');
    assert.equal(url.searchParams.get('page'),'2'); assert.equal(url.searchParams.get('m'),'0'); assert.equal(url.searchParams.get('d'),'1');
    assert.equal(url.searchParams.get('en'),'1'); assert.equal(url.searchParams.get('ru'),'1'); assert.equal(url.searchParams.get('jp'),'0');
    assert.equal(url.searchParams.get('dl'),'1'); assert.equal(url.searchParams.get('lt'),'0'); assert.ok(!url.href.includes('%252B'));
  });
}
test('IMHentai simple search delimiters, speechless/random and edition listings', () => {
  assert.equal(listingUrl(base,'ru',{popular:true,page:2}),`${base}/language/russian/popular/?page=2`);
  assert.equal(new URL(searchUrl(base,'all',{searchTerm:'one two, three'})).searchParams.get('key'),'one two,three');
  assert.equal(searchUrl(base,'en',{page:3,selectedFilters:{speechless:['true'],sort:['popular']}}),`${base}/language/speechless/popular/?page=3`);
  assert.equal(searchUrl(base,'ru',{selectedFilters:{random:['true'],language:[]}}),`${base}/random/`);
});
test('IMHentai metadata, language flags and signed reader page-map reconstruction', () => {
  const listing = parseListing([{link:{href:'/gallery/123/',title:'A\n B'},cover:{lazy:'/a.jpg',src:'data:image/png;base64,xx'},flag:{src:'/ru.png'},type:'Manga'},{link:null}],base);
  assert.equal(listing[0].id,'123'); assert.equal(listing[0].title,'A\n B'); assert.equal(listing[0].languageFlagUrl,`${base}/ru.png`);
  const details = parseDetails({root:{title:'Title',subtitle:'Other',cover:null,rows:[{label:'Artists:',values:['jairou | xil']},{label:'Category:',values:['Manga']},{label:'Tags:',values:['tag']}]},pageCount:'3'},'123',base);
  assert.equal(details.artist,'jairou | xil'); assert.equal(details.author,'jairou | xil'); assert.equal(details.description,'Other\n\nPages: 3\n\nCategory: Manga');
  assert.deepEqual(parsePages({image:'//cdn.imhentai.xxx/a/1.jpg',dir:'dir',token:'token',scripts:[`var g_th = $.parseJSON('{"3":"w,0","1":"j,0","2":"p,0"}');`]},base),[
    {index:0,imageUrl:'https://cdn.imhentai.xxx/dir/token/1.jpg'}, {index:1,imageUrl:'https://cdn.imhentai.xxx/dir/token/2.png'}, {index:2,imageUrl:'https://cdn.imhentai.xxx/dir/token/3.webp'}]);
  assert.throws(() => parsePages({image:'/a',dir:'d',token:'t',scripts:[]},base));
});
test('IMHentai cleared languages and later recommendation pages issue no HTTP; overload is not empty success', async () => {
  let requests = 0;
  const source = createIMHentai({sourceId:'ru.imhentai',baseUrl:base,settings:{get:async () => null},http:{request:async () => {requests++;return {body:'Overload... Please use the advanced search'};}}});
  assert.deepEqual(await source.search({selectedFilters:{language:[]}}),[]);
  assert.deepEqual(await source.getRecommendations({mangaId:'123',page:2}),{items:[],page:2,hasNextPage:false});
  assert.equal(requests,0);
  await assert.rejects(source.getLatest(),error => error.code === 'rate_limited');
});
