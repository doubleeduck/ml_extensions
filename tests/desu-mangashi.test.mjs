import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogUrl,normalizeId,parseApiChapters,parseApiPages} from '../src/sources/desu.mjs';
import {searchUrl,normalizeId as shiId} from '../src/sources/mangashi.mjs';
test('Desu stable IDs, API chapters and unusual negative genre syntax stay compatible', () => {
  assert.equal(normalizeId('/manga/a.123'),'/manga/a.123/'); assert.equal(normalizeId('/other/'),null);
  const url = new URL(catalogUrl('https://desu.uno',{page:2,selectedFilters:{genres:['include:1-action','exclude:2-drama'],types:['manga'],sort:['updated']}}));
  assert.equal(url.searchParams.get('genres'),'1-action,2-!drama'); assert.equal(url.searchParams.has('order_by'),false);
  assert.equal(parseApiChapters({chapters:[{id:1,number:'1,5',volume:'1',title:'Title'}]})[0].title,'Volume 1. Chapter 1,5 - Title');
  assert.deepEqual(parseApiPages({chapter:{pages:[{url:'/1.jpg'}]}},'https://desu.uno'),[{index:0,imageUrl:'https://desu.uno/1.jpg'}]);
});
test('MangaShi stable title/chapter IDs and repeated tag filters', () => {
  assert.equal(shiId('/manga/a/glava-1.5',true),'/manga/a/glava-1.5/'); assert.equal(shiId('/manga/a/other/',true),null);
  const url = new URL(searchUrl({selectedFilters:{tags:['include:a','include:b','exclude:c'],chapters_min:[' 10 ']}}));
  assert.deepEqual(url.searchParams.getAll('tag'),['a','b']); assert.deepEqual(url.searchParams.getAll('exclude_tag'),['c']); assert.equal(url.searchParams.get('chapters_min'),'10');
});
