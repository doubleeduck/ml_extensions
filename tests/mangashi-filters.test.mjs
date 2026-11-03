import test from 'node:test';
import assert from 'node:assert/strict';
import {searchUrl,normalizeId as shiId} from '../src/sources/mangashi.mjs';
test('MangaShi stable title/chapter IDs and repeated tag filters', () => {
  assert.equal(shiId('/manga/a/glava-1.5',true),'/manga/a/glava-1.5/'); assert.equal(shiId('/manga/a/other/',true),null);
  const url = new URL(searchUrl({selectedFilters:{tags:['include:a','include:b','exclude:c'],chapters_min:[' 10 ']}}));
  assert.deepEqual(url.searchParams.getAll('tag'),['a','b']); assert.deepEqual(url.searchParams.getAll('exclude_tag'),['c']); assert.equal(url.searchParams.get('chapters_min'),'10');
});
