import test from 'node:test';
import assert from 'node:assert/strict';
import {assignedJson,flightData,flightValues,jsonAt} from '../src/core/script_json.mjs';

test('script data reader balances nested arrays and quoted braces without executing trailing code',()=>{
  globalThis.__scriptExecuted=false;
  assert.deepEqual(assignedJson(['window.__DATA__={"text":"a } \\\" [","nested":[{"n":1}]}; globalThis.__scriptExecuted=true;'],'__DATA__'),{text:'a } \" [',nested:[{n:1}]});
  assert.equal(globalThis.__scriptExecuted,false);delete globalThis.__scriptExecuted;
});
test('script data reader rejects non-JSON, malformed, deep and missing data without echoing response contents',()=>{
  for(const input of ['{secret:"private-value"}','{"secret":"private-value"','{]','['.repeat(130)+']'.repeat(130)])
    assert.throws(()=>jsonAt(input,0),error=>error.code==='parse_error'&&!error.message.includes('private-value'));
  assert.throws(()=>assignedJson(['const other={}'],'__DATA__'),error=>error.code==='parse_error');
});
test('Next flight chunks can split objects and Unicode across pushes; references remain data',()=>{
  const text='7:'+JSON.stringify({initialData:{manga:{name:'Тайтл'},branches:'$5:path',chapters:[]}})+'\n';
  const scripts=[`self.__next_f.push(${JSON.stringify([1,text.slice(0,25)])});`,`self.__next_f.push(${JSON.stringify([1,text.slice(25)])});`];
  assert.equal(flightData(scripts),text);
  assert.deepEqual(flightValues(flightData(scripts),'initialData'),[{manga:{name:'Тайтл'},branches:'$5:path',chapters:[]}]);
  assert.throws(()=>flightData(['other();']),error=>error.code==='parse_error');
});
