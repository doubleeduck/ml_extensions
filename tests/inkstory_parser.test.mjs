import assert from 'node:assert/strict';
import test from 'node:test';
import {isValidChapterId, normalizeImageUrl, parseCatalog, parseChapters, parseFilters, parsePages} from '../src/sources/inkstory_parser.mjs';

test('InkStory preserves existing manga/chapter IDs, aliases and metadata', () => {
  const book = {slug:'demo', name:{ru:'Демо',en:'Demo'}, poster:'https://static.inuko.me/cover.jpg',
    labels:[{slug:'action',name:'Боевик',kind:'GENRE'}]};
  const [manga] = parseCatalog([{book}]);
  assert.equal(manga.id, '/content/demo');
  assert.equal(manga.title, 'Демо');
  assert.equal(manga.secondaryTitle, 'Demo');
  assert.deepEqual(manga.tags, ['Боевик']);
  assert.equal(manga.artist, null);
  assert.equal(parseChapters([{id:'extra',number:1.5}], manga.id)[0].id, '/content/demo/extra');
});
test('two equal 50-chapter branches produce 50 chapters and deterministic choice', () => {
  const payload = Array.from({length:50}, (_,index) => [
    {id:`b${index+1}`,number:index+1,branchId:'b'}, {id:`a${index+1}`,number:index+1,branchId:'a'}]).flat();
  const chapters = parseChapters(payload, '/content/demo');
  assert.equal(chapters.length, 50);
  assert.ok(chapters.every(item => item.id.startsWith('/content/demo/a')));
  assert.deepEqual(new Set(parseChapters([...payload].reverse(), '/content/demo').map(item => item.id)),
    new Set(chapters.map(item => item.id)));
});
test('duplicate rows do not change branch ranking or merge unassigned chapters', () => {
  const chapters = parseChapters([
    {id:'a',number:1,branchId:'a'}, {id:'a',number:1,branchId:'a'}, {id:'a',number:1,branchId:'a'},
    {id:'b1',number:1,branchId:'b'}, {id:'b2',number:2,branchId:'b'}, {id:'unknown',number:3}], '/content/demo');
  assert.deepEqual(chapters.map(item => item.id), ['/content/demo/b1','/content/demo/b2']);
});
test('retains fractional chapters and precise access/date defaults', () => {
  const chapters = parseChapters([{id:'id',number:1.5,createdAt:'2026-09-01T12:00:00Z'}], '/content/demo');
  assert.equal(chapters[0].number, 1.5);
  assert.equal(chapters[0].title, 'Глава 1.5');
  assert.equal(chapters[0].uploadedAt, '2026-09-01T12:00:00.000Z');
  assert.equal(chapters[0].access.type, 'available');
  assert.deepEqual(parseChapters([], '/content/demo'), []);
});
test('invalid chapter rows are errors rather than empty successful results', () => {
  for (const row of [{number:1}, {id:'x'}, {id:'x',number:NaN}]) {
    assert.throws(() => parseChapters([row], '/content/demo'), {code:'parse_error'});
  }
});
test('pages retain index ordering and image transformation', () => {
  const url = 'https://static.inuko.me/pages/aaaaaaaa-aaaa-saaa-aaaa-aaaaaaaaaaaa.webp';
  assert.equal(normalizeImageUrl(url), url.replace('-saaa-', '-xaaa-'));
  assert.deepEqual(parsePages({pages:[{index:1,image:'https://img.example/2.webp'}, {index:0,image:url}]}),
    [{index:0,imageUrl:normalizeImageUrl(url)}, {index:1,imageUrl:'https://img.example/2.webp'}]);
});
test('filters preserve keys, order, options and tri-state category', () => {
  const filters = parseFilters([{slug:'action',name:'Боевик',kind:'GENRE'}]);
  assert.equal(filters[0].key, 'sort');
  assert.equal(filters[1].kind, 'triStateMultiSelect');
  assert.equal(filters[1].options[0].value, 'action');
  assert.equal(filters.at(-1).key, 'yearMax');
  assert.equal(filters.length, 13);
});
test('reader chapter IDs use the existing UUID suffix contract', () => {
  assert.ok(isValidChapterId('/content/demo/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'));
  assert.ok(!isValidChapterId('/content/demo/not-an-id'));
});
