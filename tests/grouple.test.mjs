import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFilters,searchParameters} from '../src/engines/grouple-filters.mjs';
import {parseCatalog,parseChapters,parseReader} from '../src/engines/grouple.mjs';
test('GroupLe API filters, repeated tri-state IDs, special status names and year bounds', () => {
  const filters = parseFilters({scripts:[`window.__FILTERS.sortType={"RATING":"Popular"};window.__FILTERS.years={min:1900,max:2026};window.__FILTERS.genre={"1":"Action"};`],rows:[]},[['4','Tag']]);
  assert.deepEqual(filters.map(value => value.key),['sortType','genre','tags','years:min','years:max']);
  const params = searchParameters({page:3,searchTerm:'name',selectedFilters:{sortType:['RATING'],genre:['include:1','exclude:2'],productionStatus:['include:ongoing'],searchFilters:['exclude:x'],'years:min':['2000'],'years:max':['invalid']}});
  assert.deepEqual(params,{offset:['100'],q:['name'],sortType:['RATING'],includeElementIds:['1'],excludeElementIds:['2'],includeProductionStatuses:['ongoing'],excludeSearchFilter:['x'],years:['2000,']});
});
test('GroupLe IDs remain stable paths, ReadManga selected translator only affects matching rows', () => {
  const root = {title:'Title',selected:{id:'tr-123',name:'Chosen'},rows:[{link:{href:'/title/v1/c1?d=temporary',title:'Title Глава 1.5 новое',scanlator:'Team (Переводчик)',translations:'[{"personId":123}]'},fallback:'',number:'15',dates:[]}]};
  const item = parseChapters(root,'https://a.zazaza.me',{readManga:true})[0]; assert.equal(item.id,'/title/v1/c1'); assert.equal(item.number,1.5); assert.equal(item.title,'Глава 1.5 - Chosen');
  assert.equal(parseChapters(root,'https://a.zazaza.me')[0].title,'Глава 1.5 - Team');
  assert.throws(() => parseChapters({rows:[]},'https://a.zazaza.me',{requiresAuthorization:true}),error => error.code === 'auth_required');
  assert.equal(parseCatalog({list:[{elementId:{linkName:'title'},name:'Title',picUrl:'/cover.jpg'}]},'https://a.zazaza.me')[0].id,'title');
});
test('GroupLe reader parses both init markers, static hosts, one-way signatures and resh aliases without evaluating JS', () => {
  assert.deepEqual(parseReader(`rm_h.readerDoInit([['ignored','',"/static/1.jpg"],['path/','https://resh.example/',"2.jpg"],['path/','https://one-way.work/',"3.jpg?sig=x"]]);`,'https://a.zazaza.me'),[
    {index:0,imageUrl:'https://a.zazaza.me/static/1.jpg'},{index:1,imageUrl:'https://h.example/path/2.jpg'},{index:2,imageUrl:'https://one-way.work/path/3.jpg'}]);
  assert.deepEqual(parseReader('alert("do not execute")','https://a.zazaza.me'),[]);
});
