import test from 'node:test';
import assert from 'node:assert/strict';
import createPururin,{buildFilters,pageRange,normalizePath,parseListing,parseDetails} from '../src/sources/pururin.mjs';
test('Pururin selectable taxonomy IDs are unique and legacy page-range conventions stay stable', () => {
  const filters = buildFilters(), types = filters.find(item => item.key === 'types'); assert.equal(filters.length,13);
  assert.equal(new Set(types.options.map(item => item.value)).size,types.options.length);
  for (const [input,expected] of [['',[1,9999]],['<20',[1,21]],['<=40',[1,40]],['>20',[21,9999]],['>=20',[20,9999]],['25',[25,25]],['=>2',[2,9999]],['99999',[9999,9999]]]) assert.deepEqual(pageRange(input),expected);
  assert.equal(normalizePath('https://pururin.me/gallery/a?q=1'),'/gallery/a/');
});
test('Pururin cards deduplicate stable paths and details exclude content/ratings description rows', () => {
  assert.equal(parseListing([{href:'/gallery/a',title:'A',image:{lazy:'/a.jpg'}},{href:'/gallery/a/',title:'B'}]).length,1);
  const details = parseDetails({title:'A',authors:['Group'],artists:[],tags:['Tag'],rows:[{cells:['Content','Tag'],links:['Tag']},{cells:['Pages','2'],links:[]}]},'/gallery/a');
  assert.equal(details.id,'/gallery/a/'); assert.equal(details.author,'Group'); assert.equal(details.artist,'Group'); assert.equal(details.description,'Pages: 2');
});
test('Pururin tag resolution uses own form POST and retains included/excluded JSON values', async () => {
  const calls = []; const source = createPururin({http:{request:async input => {calls.push(input); return {body:input.method === 'POST' ? '[{"id":10,"name":"sample"}]' : 'html'};}},html:{extract:async () => []}});
  await source.search({searchTerm:'name',selectedFilters:{tags:['sample, -sample'],types:['13004']}});
  assert.equal(calls[0].body,'text=sample'); assert.equal(calls[0].headers.Referer,'https://pururin.me/tags/content/');
  const query = new URL(calls.at(-1).url).searchParams;
  assert.deepEqual(JSON.parse(query.get('included_tags')),[{id:10,name:'sample'}]);
  assert.ok(JSON.parse(query.get('excluded_tags')).some(value => value.id === 10));
});
