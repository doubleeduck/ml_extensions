import {build} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..',import.meta.url));
const check = process.argv.includes('--check');
const output = resolve(process.argv.slice(2).find(arg => arg !== '--check') ?? resolve(root,'dist/host-bootstrap.js'));
const result = await build({absWorkingDir:root,entryPoints:['sdk/bootstrap.mjs'],bundle:true,
  platform:'neutral',format:'iife',target:'es2022',write:false,metafile:true,legalComments:'inline',
  mainFields:['module','main'],conditions:['browser','default'],charset:'utf8',minify:false});
if (Object.values(result.metafile.outputs).some(file => file.imports.length)) throw new Error('Host SDK must not retain runtime imports');
const license = await readFile(resolve(root,'node_modules/core-js-pure/LICENSE'),'utf8');
const content = `/* Host SDK: core-js-pure 3.50.0 (MIT).\n${license.replaceAll('*/','* /')}\n*/\n${result.outputFiles[0].text}`;
if (check) {
  if (await readFile(output,'utf8') !== content) throw new Error('Host SDK asset is stale; rebuild before publishing the app');
} else {
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,content);
}
console.log(`Host SDK ${check ? 'verified' : 'built'}: ${output} (${result.outputFiles[0].contents.length} bytes); no external imports`);
