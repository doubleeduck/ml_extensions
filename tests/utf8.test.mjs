import test from 'node:test';
import assert from 'node:assert/strict';
import {Utf8TextEncoder as Encoder, Utf8TextDecoder as Decoder} from '../sdk/utf8.mjs';

test('UTF-8 encoder matches web API for ASCII, Cyrillic, supplementary and lone surrogates', () => {
  for (const text of ['','abc','Привет','日本語 😀','\ud800abc\udc00','\u0000\ufeff','\udbff\udfff']) {
    assert.deepEqual(new Encoder().encode(text),new TextEncoder().encode(text));
    for (let size = 0; size < 16; size++) {
      const own = new Uint8Array(size), standard = new Uint8Array(size);
      assert.deepEqual(new Encoder().encodeInto(text,own),new TextEncoder().encodeInto(text,standard));
      assert.deepEqual(own,standard);
    }
  }
});
test('UTF-8 decoder matches replacement, BOM and streaming semantics', () => {
  const vectors = [[0xc0,0x80],[0xe0,0x80,0x80],[0xed,0xa0,0x80],[0xf4,0x90,0x80,0x80],
    [0xe2,0x82],[0xe2,0x82,0x61],[0xef,0xbb,0xbf,0x61],[0xf0,0x9f,0x98,0x80],[0xff,0x61]];
  for (const vector of vectors) for (const ignoreBOM of [false,true]) {
    const bytes = Uint8Array.from(vector);
    assert.equal(new Decoder('utf8',{ignoreBOM}).decode(bytes),new TextDecoder('utf8',{ignoreBOM}).decode(bytes));
    for (let split = 0; split <= bytes.length; split++) {
      const own = new Decoder('utf8',{ignoreBOM}), standard = new TextDecoder('utf8',{ignoreBOM});
      assert.equal(own.decode(bytes.slice(0,split),{stream:true})+own.decode(bytes.slice(split)),
        standard.decode(bytes.slice(0,split),{stream:true})+standard.decode(bytes.slice(split)));
    }
  }
});
test('fatal decoding and unsupported encodings fail explicitly', () => {
  assert.throws(() => new Decoder('shift_jis'),RangeError);
  assert.throws(() => new Decoder('utf-8',{fatal:true}).decode(Uint8Array.from([0xff])),TypeError);
  assert.equal(new Decoder().decode(new DataView(Uint8Array.from([65]).buffer)),'A');
});
