import {parseArgs} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {sourceDefinitions} from '../src/definitions.mjs';
import createSource from '../src/index.mjs';
import {diagnoseSource,markdownReport} from './diagnostics/source_diagnostics.mjs';

const help = `Usage: npm run diagnose -- <source-id> [options]
  --list                 List registered IDs
  --base-url URL         Test a suspected replacement base URL
  --pages N              Catalog pages to sample (1..5, default 2)
  --manga ID             Title ID for details/chapters (default first catalog item)
  --chapter ID           Chapter ID for reader checks
  --search TEXT          Search query (default first title)
  --filter KEY=VALUE     Selected filter; repeat for multiple values
  --settings FILE        Anonymous settings namespaces as JSON
  --timeout N            Per-request deadline in ms (1000..30000, default 10000)
  --output FILE          Save Markdown or, with .json suffix, JSON report
  --help                 Show help
No package builds, website JavaScript, login or source edits are performed.`;

try {
  const {values,positionals} = parseArgs({allowPositionals:true,options:{list:{type:'boolean'},help:{type:'boolean'},
    'base-url':{type:'string'},pages:{type:'string'},manga:{type:'string'},chapter:{type:'string'},search:{type:'string'},
    filter:{type:'string',multiple:true},settings:{type:'string'},timeout:{type:'string'},output:{type:'string'}}});
  const definitions = sourceDefinitions();
  if (values.help) console.log(help);
  else if (values.list) console.log(definitions.map(source => `${source.id}\t${source.name}\t${source.baseUrl}`).join('\n'));
  else {
    if (positionals.length !== 1) throw Error(help);
    const definition = definitions.find(source => source.id === positionals[0]);
    if (!definition) throw Error(`Unknown source ${positionals[0]}. Use --list to see IDs.`);
    const pages = Number(values.pages ?? 2), timeoutMs = Number(values.timeout ?? 10000);
    if (!Number.isInteger(pages) || pages < 1 || pages > 5) throw Error('--pages must be an integer from 1 to 5');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) throw Error('--timeout must be 1000..30000 ms');
    if (values['base-url']) {
      const url = new URL(values['base-url']);
      if (url.protocol !== 'https:' || url.username || url.password) throw Error('--base-url must use HTTPS without credentials');
    }
    const filters = {};
    for (const value of values.filter ?? []) {
      const split = value.indexOf('=');if (split < 1 || split === value.length-1) throw Error('--filter requires KEY=VALUE');
      (filters[value.slice(0,split)] ??= []).push(value.slice(split+1));
    }
    const settings = values.settings ? JSON.parse(await readFile(resolve(values.settings),'utf8')) : {};
    if (!settings || Array.isArray(settings) || typeof settings !== 'object') throw Error('--settings must contain a JSON object of namespaces');
    console.log(`Checking ${definition.name} (${definition.id}) anonymously…`);
    const report = await diagnoseSource({definition,createSource,options:{baseUrl:values['base-url'],pages,timeoutMs,
      mangaId:values.manga,chapterId:values.chapter,search:values.search,filters,settings},
      onProgress:row => console.log(`${row.status.padEnd(7)} ${row.name}${row.count == null ? '' : `: ${row.count} items`}${row.message ? ` — ${row.message}` : ''}`)});
    console.log(`\nResult: ${report.status}. ${report.requests.length} HTTP requests, ${report.findings.length} findings.`);
    for (const row of report.findings) console.log(`[${row.severity}/${row.code}] ${row.message}${row.url ? ` ${row.url}` : ''}`);
    if (values.output) {
      const output = resolve(values.output);
      await mkdir(dirname(output),{recursive:true});
      await writeFile(output,output.toLowerCase().endsWith('.json') ? JSON.stringify(report,null,2)+'\n' : markdownReport(report));
      console.log(`Report: ${output}`);
    }
    process.exitCode = report.status === 'error' ? 1 : 0;
  }
} catch (error) {console.error(error.message);process.exitCode = 2;}
