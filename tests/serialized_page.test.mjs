import test from 'node:test';
import assert from 'node:assert/strict';
import {serializedPage} from '../src/core/serialized_page.mjs';

test('SSR reader resolves shared objects, numeric keys, escapes and booleans without executing code',()=>{
  globalThis.__ssrExecuted=false;
  const script=String.raw`$_TSR.router=($R=>$R[0]={book:$R[1]={id:"one",name:$R[2]={ru:"Тайтл \"книга\"",en:"A\x20book"},links:$R[3]={1:"https://example.org"},enabled:!0,locked:!1,nothing:void 0},books:$R[4]=[$R[1],$R[1]]})($R["tsr"]);globalThis.__ssrExecuted=true;`;
  const data=serializedPage([script]);
  assert.equal(data.first('book').name.en,'A book');assert.equal(data.first('book').name.ru,'Тайтл "книга"');
  assert.equal(data.first('book').links[1],'https://example.org');assert.equal(data.first('book').enabled,true);assert.equal(data.first('book').locked,false);
  const books=data.first('books');assert.equal(books[0],books[1]);assert.equal(books[0],data.first('book'));
  assert.equal(globalThis.__ssrExecuted,false);delete globalThis.__ssrExecuted;
});

test('SSR field indexing ignores property-looking strings and cannot change object prototypes',()=>{
  const data=serializedPage([String.raw`$_TSR.router=($R=>$R[0]={text:"book:$R[999]={fake:1}",book:$R[1]={slug:"demo",__proto__:{polluted:true}}})($R["tsr"]);`]);
  const book=data.first('book');assert.equal(book.slug,'demo');assert.equal(Object.getPrototypeOf(book),null);assert.equal({}.polluted,undefined);
});

test('SSR reader rejects code, cycles, missing references and pathological nesting',()=>{
  for(const value of ['(()=>{throw Error("private")})()','new Date()','$R[55]','$R[1]','['.repeat(110)+'0'+']'.repeat(110)]){
    assert.throws(()=>serializedPage([`$_TSR.router=($R=>$R[0]={book:$R[1]=${value}})($R["tsr"]);`]).first('book'),e=>e.code==='parse_error'&&!e.message.includes('private'));
  }
  assert.throws(()=>serializedPage(['<html>Login</html>']),e=>e.code==='parse_error');
  assert.throws(()=>serializedPage(['$_TSR.router={books:[]}']).first('book'),e=>e.code==='parse_error');
});
