import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {registrations} from '../src/definitions.mjs';

test('bundle contains only its reachable runtime modules and registered source icons', async () => {
  const root=new URL('../',import.meta.url), reachable=new Set();
  async function visit(relative) {
    if(reachable.has(relative))return;
    assert.ok(relative.startsWith('src/') && relative.endsWith('.mjs'));
    reachable.add(relative);
    const code=await readFile(new URL(relative,root),'utf8');
    for(const match of code.matchAll(/\bfrom\s*['"](\.[^'"]+)['"]/gu))
      await visit(path.posix.normalize(path.posix.join(path.posix.dirname(relative),match[1])));
  }
  async function list(relative) {
    const files=[];
    for(const entry of await readdir(new URL(relative+'/',root),{withFileTypes:true})) {
      const name=relative+'/'+entry.name;
      if(entry.isDirectory())files.push(...await list(name));else files.push(name);
    }
    return files;
  }
  await visit('src/index.mjs');
  assert.deepEqual((await list('src')).filter(name=>name!=='src/definitions.mjs').sort(),[...reachable].sort());
  for(const source of registrations)assert.ok(reachable.has('src/'+source._module),source.id);
  assert.deepEqual((await list('assets/source_logos')).sort(),[...new Set(registrations.map(source=>source.branding.icon))].sort());
});
