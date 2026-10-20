import test from 'node:test';
import assert from 'node:assert/strict';
import {recent,recentRequest} from '../src/core/recent.mjs';

test('paired reads share in-flight work and expire after completion, with bounded LRU storage', async () => {
  let clock = 0, calls = 0, release;
  const load = recent(async key => {calls++; if (key === 'pending') await new Promise(resolve => {release = resolve;}); return key;},
    {ttlMs:100,limit:2,now:() => clock});
  const first = load('pending'), second = load('pending');
  await Promise.resolve(); assert.equal(calls,1); assert.equal(first,second);
  clock = 500; assert.equal(load('pending'),first); release(); await first;
  clock = 599; assert.equal(await load('pending'),'pending'); assert.equal(calls,1);
  clock = 601; const expired = load('pending'); await Promise.resolve(); release(); await expired;
  assert.equal(calls,2);
  await load('b'); await load('c');
  const evicted = load('pending'); await Promise.resolve(); release(); await evicted;
  assert.equal(calls,5);
});

test('failed title loads are retried and factory caches never share state', async () => {
  let calls = 0;
  const fetch = async () => {calls++; if (calls < 2) throw Object.assign(Error('offline'),{code:'network'}); return {body:'page'};};
  const a = recentRequest(fetch), b = recentRequest(fetch), request = {url:'https://example.org/title',method:'GET',responseType:'text'};
  await assert.rejects(a(request),{code:'network'});
  await a(request); await a({...request}); assert.equal(calls,2);
  await b(request); assert.equal(calls,3);
  await a({...request,headers:{'HX-Request':'true'}}); assert.equal(calls,4);
  await a({...request,method:'POST'}); await a({...request,method:'POST'}); assert.equal(calls,6);
  assert.throws(() => recent(fetch,{limit:0}),TypeError);
});

test('taxonomy cache accepts 128 entries and rejects unbounded configurations', async () => {
  let calls=0; const lookup=recent(async key=>{calls++;return key;},{limit:128});
  for(let i=0;i<128;i++) await lookup(i);
  await lookup(0); assert.equal(calls,128);
  await lookup(128); await lookup(1); assert.equal(calls,130);
  assert.throws(()=>recent(()=>null,{limit:129}),TypeError);
});
