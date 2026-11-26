import test from 'node:test';
import assert from 'node:assert/strict';
import createLibGroup from '../src/engines/libgroup.mjs';
import {parseFilters} from '../src/engines/libgroup_parser.mjs';

// The live API serializes sparse PHP arrays as objects, e.g. after removing
// site 5 without reindexing the remaining IDs. Object keys are not site IDs.
const constants = {
  types:[{id:1,label:'Манга',site_ids:[1,4,2]}],
  scanlateStatus:[{id:1,label:'Продолжается',site_ids:{0:0,1:1,2:2,3:3,4:4,6:7}}],
  genres:[{id:10,name:'Shared',site_ids:[1,'2',4]},{id:11,name:'Other site',site_ids:{4:7}}],
  tags:[{id:20,name:'Manga tag',site_ids:{2:'1'}},{id:21,name:'Hentai tag',site_ids:{1:'4'}},
    {id:22,name:'Yaoi tag',site_ids:{0:'2'}}],
  imageServers:[{id:'compress',url:'https://images.example',site_ids:{0:1,2:4,4:2}}],
};

test('filters accept array and sparse-object site_ids without mixing sites or object keys', () => {
  for (const [siteId,tagId] of [[1,'20'],[2,'22'],[4,'21']]) {
    const filters = parseFilters(constants,siteId);
    const values = key => filters.find(filter => filter.key === key).options.map(option => option.value);
    assert.deepEqual(values('types'),['1']);
    assert.deepEqual(values('scanlate_status'),['1']);
    assert.deepEqual(values('genres'),['10']);
    assert.deepEqual(values('tags'),[tagId]);
  }
});

test('missing or invalid site lists do not expose options or crash the filter list', () => {
  const genres = [null,undefined,[],{},'1,4',4].map((site_ids,id) => ({id,name:'Invalid site list',site_ids}));
  const filters = parseFilters({genres},1);
  assert.deepEqual(filters.map(filter => filter.key),['sort','bookmarks','require_chapters']);
});

for (const siteId of [1,2,4]) {
  test(`LibGroup site ${siteId} loads and refreshes filters and resolves images with sparse site IDs`,async () => {
    let constantsCalls = 0;
    const source = createLibGroup({parameters:{siteId:String(siteId)},baseUrl:'https://source.example',
      settings:{get:async () => ({})},http:{request:async request => {
        const url = new URL(request.url);
        if (url.pathname === '/api/constants') {
          constantsCalls++;
          return {body:{data:constants}};
        }
        assert.ok(url.pathname.endsWith('/chapter'));
        return {body:{data:{pages:[{slug:'1',url:'/chapter/1.jpg'}]}}};
      }}});
    for (let read = 0; read < 2; read++) {
      const filters = await source.getFilters();
      assert.equal(filters.find(filter => filter.key === 'scanlate_status').options[0].label,'Продолжается');
    }
    assert.equal(constantsCalls,1);
    await source.getFilters({refresh:true});
    assert.equal(constantsCalls,2);
    assert.deepEqual(await source.getPages({mangaId:'demo',chapterId:'1|1'}),
      [{index:0,imageUrl:'https://images.example/chapter/1.jpg'}]);
    assert.equal(constantsCalls,2);
  });
}
