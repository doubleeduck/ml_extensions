import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFilters,searchUrl,coverUrl,normalizeId,parsePages} from '../src/engines/chan.mjs';
test('Chan preserves every static filter and the unusual path-based sort/status syntax', () => {
  assert.equal(buildFilters()[2].options.length,55); assert.equal(buildFilters(true)[0].options.length,189);
  const base = 'https://im.manga-chan.me';
  const query = {page:2,selectedFilters:{sort:['date','asc'],status:['ongoing'],genres:['include:боевик','exclude:драма']}};
  const url = new URL(searchUrl(base,query)); assert.equal(decodeURI(url.pathname),'/tags/ongoing/боевик+-драма/'); assert.equal(url.searchParams.get('offset'),'20'); assert.equal(url.searchParams.has('status'),false);
  assert.equal(new URL(searchUrl(base,{selectedFilters:{sort:['name','asc']}})).pathname,'/manga/new&n=abcdesc');
});
test('H-chan upgrades thumbnails, selects full covers and preserves reader query IDs', () => {
  const base = 'https://x2.h-chan.me';
  assert.equal(coverUrl({src:'/manganew_thumbs/a.jpg',original:'/manganew/a.jpg'},base,true),`${base}/manganew/a.jpg`);
  assert.equal(coverUrl({src:'/small.jpg',parent:{href:'/full.jpg'}},base,true),`${base}/full.jpg`);
  assert.equal(normalizeId('/online/123-a.html?key=x',base,{hchan:true,chapter:true}),'/online/123-a.html?key=x');
  assert.equal(normalizeId('/other/a.html',base,{hchan:true}),null);
  assert.deepEqual(parsePages(String.raw`var fullimg = ['https:\/\/cdn.example.org\/1.jpg'];`,base,true),[{index:0,imageUrl:'https://cdn.example.org/1.jpg'}]);
});
