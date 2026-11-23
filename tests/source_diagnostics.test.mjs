import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {diagnoseSource,allowsUrl,markdownReport,safeUrl} from '../tools/diagnostics/source_diagnostics.mjs';
import {extractHtml} from '../tools/diagnostics/html_projection.mjs';

const definition = {id:'test.source',name:'Fixture',baseUrl:'https://site.example',parameters:{site:'1'},
  network:{origins:['https://site.example'],imageOrigins:['https://images.example'],allowSubdomains:true,methods:['GET','POST','HEAD']}};
const title = {id:'title-1',title:'Example',coverUrl:'https://images.example/cover.jpg'};
const options = {checkWebsite:false,pages:1,imageSamples:0};
const json = (body,status = 200,headers = {}) => new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...headers}});
const factory = ctx => ({
  getPopular:async ({page}) => (await ctx.http.request({method:'GET',url:`${ctx.baseUrl}/catalog?page=${page}`,responseType:'json'})).body,
  getDetails:async ({mangaId}) => ({...title,id:mangaId}),
  getChapters:async () => [{id:'chapter-1',title:'Chapter 1'}],
  getPages:async () => [{index:0,imageUrl:'https://images.example/page.jpg'}],
});
async function run(overrides = {}) {
  return diagnoseSource({definition,createSource:factory,options,fetchImpl:async () => json([title]),...overrides});
}

test('origin matching respects HTTPS, ports, subdomain boundaries and credentials', () => {
  assert.equal(allowsUrl('https://img.cdn.example/a',['https://cdn.example'],true),true);
  for (const url of ['https://evilcdn.example/a','https://cdn.example.evil/a','http://cdn.example/a',
    'https://cdn.example:8443/a','https://user:pass@cdn.example/a','https://cdn.example/a#fragment','https://cdn.example/with space','not a URL'])
    assert.equal(allowsUrl(url,['https://cdn.example'],true),false,url);
  assert.equal(allowsUrl('https://img.cdn.example/a',['https://cdn.example']),false);
});

test('real source methods run with their parameters and settings defaults', async () => {
  let selected;
  const report = await run({definition:{...definition,settings:{fields:[{key:'apiDomain',default:'https://site.example'}]}},
    createSource:ctx => {
      assert.deepEqual(ctx.parameters,{site:'1'});
      return {...factory(ctx),getFilters:async () => [{key:'tag',kind:'multiSelect',label:'Tags'}],
        search:async query => {selected = query;assert.deepEqual(await ctx.settings.get('source'),{apiDomain:'https://override.example'});return [];}};
    },options:{...options,settings:{source:{apiDomain:'https://override.example'}},filters:{tag:['action']}}});
  assert.equal(report.status,'ok');assert.equal(report.checks.find(row => row.name === 'pages').count,1);
  assert.deepEqual(selected,{searchTerm:'Example',page:1,selectedFilters:{tag:['action']}});
});

test('new cover, flag and reader origins are detected even without downloading images', async () => {
  const report = await run({fetchImpl:async () => json([{...title,coverUrl:'https://new-cover.example/a',languageFlagUrl:'https://new-flags.example/en.svg'}]),
    createSource:ctx => ({...factory(ctx),getPages:async () => [{index:0,imageUrl:'https://new-reader.example/p'}]})});
  assert.equal(report.status,'error');
  assert.equal(report.findings.filter(row => row.code === 'missing_image_origin').length,3);
  assert.ok(report.findings.some(row => row.message.includes('network.imageOrigins')));
  assert.ok(!report.requests.some(row => row.method === 'HEAD'));
});

test('source-owned HEAD probes may use image grants without an HTTP origin grant', async () => {
  const report = await run({createSource:ctx => ({...factory(ctx),getPages:async () => {
    await ctx.http.request({method:'HEAD',url:'https://images.example/page.jpg',responseType:'text'});
    return [{index:0,imageUrl:'https://images.example/page.jpg'}];
  }}),fetchImpl:async (url,input) => input.method === 'HEAD' ? new Response(null,{status:200}) : json([title])});
  assert.equal(report.status,'ok');assert.equal(report.findings.length,0);
});

test('HTTP redirects identify undeclared replacement domains and keep exercising the parser', async () => {
  const calls = [];
  const report = await run({fetchImpl:async (url,input) => {
    calls.push({url,method:input.method});
    return new URL(url).host === 'site.example' ? new Response(null,{status:301,headers:{Location:'https://new-site.example/catalog'}}) : json([title]);
  }});
  assert.equal(report.checks.find(row => row.name === 'popular:1').status,'passed');
  assert.ok(report.findings.some(row => row.code === 'missing_http_origin' && row.url.includes('new-site.example')));
  assert.ok(report.findings.some(row => row.code === 'redirect'));
  assert.equal(calls.length,2);
});

test('redirected POST follows GET semantics and never sends cookies to a different origin', async () => {
  const calls = [];
  const report = await run({definition:{...definition,network:{...definition.network,cookieDefaults:[{origin:'https://site.example',name:'view',value:'pc'}]}},
    createSource:ctx => ({...factory(ctx),getPopular:async () => (await ctx.http.request({method:'POST',url:ctx.baseUrl+'/catalog',responseType:'json',
      body:{query:'manga'},headers:{Cookie:'private=value',Authorization:'Bearer private'}})).body}),
    fetchImpl:async (url,input) => {
      calls.push({url,method:input.method,body:input.body,cookie:input.headers.get('Cookie'),auth:input.headers.get('Authorization')});
      return calls.length === 1 ? new Response(null,{status:302,headers:{Location:'https://other.example/catalog'}}) : json([title]);
    }});
  assert.equal(report.checks.find(row => row.name === 'popular:1').status,'passed');
  assert.equal(calls[0].cookie,'view=pc');assert.equal(calls[0].auth,null);
  assert.equal(calls[1].cookie,null);assert.equal(calls[1].method,'GET');assert.equal(calls[1].body,undefined);
});

test('HTML browser challenges and anonymous access failures are warnings, not broken-parser diagnoses', async () => {
  for (const response of [new Response('<html><title>Just a moment...</title></html>',{status:200}),
    new Response('Challenge',{status:403,headers:{'cf-mitigated':'challenge'}}),new Response('Login',{status:401})]) {
    const report = await run({fetchImpl:async () => response.clone()});
    assert.equal(report.status,'warning');
    assert.equal(report.checks.find(row => row.name === 'popular:1').status,'warning');
    assert.ok(report.findings.some(row => ['challenge_required','auth_required'].includes(row.code)));
  }
});

test('transient failed attempts remain visible when the source recovers with a fallback', async () => {
  const report = await run({createSource:ctx => ({...factory(ctx),getPopular:async () => {
    try {await ctx.http.request({url:ctx.baseUrl+'/offline',method:'GET',responseType:'json'});} catch {}
    return factory(ctx).getPopular({page:1});
  }}),fetchImpl:async url => url.includes('/offline') ? json({message:'Unavailable'},502) : json([title])});
  assert.equal(report.checks.find(row => row.name === 'popular:1').status,'passed');
  assert.ok(report.requests.some(row => row.status === 502));
  assert.equal(report.status,'warning');
});

test('unknown methods and malformed DTOs fail explicitly instead of claiming success', async () => {
  for (const createSource of [() => ({getDetails:async () => title}),ctx => ({...factory(ctx),getPopular:async () => [{id:'missing-title'}]})]) {
    const report = await run({createSource});assert.equal(report.status,'error');
    assert.ok(report.findings.some(row => row.code === 'invalid_response'));
  }
});

test('metadata sources skip chapter reads and still check recommendations and cover grants', async () => {
  let read = false;
  const report = await run({definition:{...definition,metadataOnly:true},
    createSource:ctx => ({...factory(ctx),getChapters:async () => {read = true;return [];},
      getRecommendations:async () => ({items:[{...title,coverUrl:'https://new-cdn.example/a'}],page:1,hasNextPage:false})})});
  assert.equal(read,false);assert.ok(report.checks.some(row => row.name === 'chapters/pages' && row.status === 'skipped'));
  assert.ok(report.findings.some(row => row.code === 'missing_image_origin'));
});

test('second page repetition is reported and missing titles explain how to continue', async () => {
  const repeated = await run({options:{...options,pages:2}});
  assert.ok(repeated.findings.some(row => row.code === 'repeated_catalog_page'));
  const empty = await run({fetchImpl:async () => json([])});
  assert.equal(empty.checks.find(row => row.name === 'popular:1').status,'warning');
  assert.ok(empty.checks.some(row => row.status === 'skipped' && row.message.includes('--manga')));
});

test('media probes use HEAD, stay bounded and preserve signed URLs only in memory', async () => {
  const calls = [];
  const signed = 'https://images.example/cover.jpg?token=private';
  const report = await run({options:{...options,imageSamples:1},fetchImpl:async (url,input) => {
    calls.push({url,method:input.method});
    return input.method === 'HEAD' ? new Response(null,{status:200,headers:{'Content-Type':'image/jpeg'}}) : json([{...title,coverUrl:signed}]);
  }});
  assert.equal(calls.filter(row => row.method === 'HEAD').length,1);
  assert.ok(calls.some(row => row.url === signed && row.method === 'HEAD'));
  assert.ok(!JSON.stringify(report).includes('private'));
});

test('HEAD-not-supported does not prove a broken image and malformed URLs cannot crash reporting', async () => {
  const report = await run({options:{...options,imageSamples:2},fetchImpl:async (url,input) => input.method === 'HEAD' ?
    new Response(null,{status:405}) : json([{...title,coverUrl:'bad-url'}])});
  assert.equal(report.status,'error');assert.ok(report.findings.some(row => row.code === 'missing_image_origin'));
  assert.equal(report.checks.find(row => row.name.startsWith('image:')).status,'warning');
});

test('request/operation deadlines abort pending IO and still produce a report', async () => {
  const report = await run({options:{...options,timeoutMs:100,operationTimeoutMs:10},
    fetchImpl:async (url,{signal}) => new Promise((resolve,reject) => signal.addEventListener('abort',() => reject(signal.reason),{once:true}))});
  assert.equal(report.status,'error');assert.equal(report.checks.find(row => row.name === 'popular:1').code,'timeout');
  assert.equal(report.requests[0].code,'cancelled');
  assert.ok(report.elapsedMs < 1000);
});

test('body limits stop oversized server responses and retain HTTP error status for failover', async () => {
  const oversized = await run({fetchImpl:async () => new Response('x'.repeat(4*1024*1024+1))});
  assert.ok(oversized.findings.some(row => row.code === 'resource_limit'));
  const failed = await run({fetchImpl:async () => new Response('<html>Bad gateway</html>',{status:502})});
  assert.equal(failed.requests[0].status,502);assert.equal(failed.requests[0].code,'http_error');
});

test('Markdown report exposes checks, trace and limitations; URLs redact credentials', async () => {
  assert.equal(safeUrl('https://user:pass@site.example/a?code=private&state=private&tag=ok#private'),
    'https://site.example/a?code=REDACTED&state=REDACTED&tag=ok');
  const markdown = markdownReport(await run());
  for (const text of ['Source diagnostics','HTTP trace','Observed images','Browser challenges','popular:1']) assert.ok(markdown.includes(text));
});

test('HTML projections handle nested fields, inherited URLs, exclusions and direct children', () => {
  const body = '<main><article><a href="/title">  A\n title <b>badge</b></a><div><a href="/nested">nested</a></div><p>Next</p></article></main>';
  const result = extractHtml(body,{baseUrl:'https://site.example/path/',selector:'article',fields:{
    links:{selector:'a',directChildren:true,all:true,fields:{url:{attr:'href',absoluteUrl:true},title:{text:true,exclude:'b'}}},
    tag:{selector:'p',tagName:true},predicate:{selector:'p',containsText:['next']},
    whitespace:{selector:'a',text:true,normalizeWhitespace:false},
  }});
  assert.deepEqual(result.links,[{url:'https://site.example/title',title:'A title'}]);
  assert.equal(result.tag,'p');assert.equal(result.predicate,true);assert.equal(result.whitespace,'A\n title badge');
});

test('HTML traversal follows element siblings and required fields fail clearly', () => {
  const body = '<div><h2> Author </h2>\n<!-- comment --><p><a>Alice</a></p></div>';
  assert.equal(extractHtml(body,{selector:'h2',textEquals:'Author',nextSibling:true,text:true}),'Alice');
  assert.equal(extractHtml(body,{selector:'a',ascend:1,html:true}),'<a>Alice</a>');
  assert.throws(() => extractHtml(body,{selector:'.missing',text:true,required:true}),/Required/);
  assert.throws(() => extractHtml(body,{selector:'a',text:true,attr:'href'}),/one output mode/);
});

test('CLI lists real source IDs, validates arguments and never needs network for help', () => {
  const script = fileURLToPath(new URL('../tools/diagnose_source.mjs',import.meta.url));
  const list = spawnSync(process.execPath,[script,'--list'],{encoding:'utf8'});
  assert.equal(list.status,0,list.stderr);assert.match(list.stdout,/https:\/\//u);
  const invalid = spawnSync(process.execPath,[script,'does.not.exist'],{encoding:'utf8'});
  assert.equal(invalid.status,2);assert.match(invalid.stderr,/Unknown source/u);
});
