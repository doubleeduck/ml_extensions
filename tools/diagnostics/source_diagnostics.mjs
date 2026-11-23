import {AsyncLocalStorage} from 'node:async_hooks';
import {extractHtml} from './html_projection.mjs';

const browserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const failure = (code,message,extra = {}) => Object.assign(Error(message),{code,...extra});
const blockedBy = code => ['auth_required','access_denied','challenge_required','chapter_unavailable'].includes(code);
export function safeUrl(input) {
  try {
    const url = new URL(input); url.username = ''; url.password = ''; url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/token|secret|password|authorization|cookie|^(?:code|state|key)$/iu.test(key)) url.searchParams.set(key,'REDACTED');
    return url.href;
  } catch {return '[invalid URL]';}
}
export function allowsUrl(input, origins = [], allowSubdomains = false) {
  try {
    if (String(input).length > 8192 || /[\x00-\x20\x7f\\]/u.test(String(input))) return false;
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return false;
    return origins.some(origin => {
      const allowed = new URL(origin);
      return url.protocol === allowed.protocol && url.port === allowed.port &&
        (url.hostname === allowed.hostname || allowSubdomains && url.hostname.endsWith('.'+allowed.hostname));
    });
  } catch {return false;}
}
async function readBody(response, limit) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(), parts = [];
  let size = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      if ((size += value.length) > limit) throw failure('resource_limit','Response exceeds the host body limit');
      parts.push(value);
    }
  } finally {await reader.cancel().catch(() => {});}
  return Buffer.concat(parts,size);
}
function decodeBody(bytes, type) {
  const charset = type?.match(/charset\s*=\s*["']?([^;\s"']+)/iu)?.[1] ?? 'utf-8';
  try {return new TextDecoder(charset).decode(bytes);}
  catch {throw failure('parse_error','Unsupported response encoding');}
}

/** Exercises the real local factory with an anonymous, bounded HTTP/HTML host.
 * Permission mismatches are reported rather than blocked, so the report can
 * identify a newly introduced API/CDN origin. No manifest is changed. */
export async function diagnoseSource({definition,createSource,options = {},fetchImpl = fetch,onProgress = () => {}}) {
  const started = Date.now(), scope = new AsyncLocalStorage();
  const baseUrl = options.baseUrl ?? definition.baseUrl;
  const report = {schemaVersion:1,source:{id:definition.id,name:definition.name,baseUrl:safeUrl(baseUrl),metadataOnly:!!definition.metadataOnly},
    startedAt:new Date(started).toISOString(),status:'ok',checks:[],findings:[],requests:[],media:[],
    limitations:'Anonymous Node HTTP checks only. Browser challenges, login, native TLS and all filter combinations require separate checks. Redirects can reveal a new domain; an unannounced replacement cannot be discovered reliably.'};
  const seenFindings = new Set(), seenMedia = new Set(), mediaCandidates = [];
  const find = (severity,code,message,url) => {
    const clean = url ? safeUrl(url) : undefined, key = JSON.stringify([code,message,clean]);
    if (!seenFindings.has(key)) {seenFindings.add(key);report.findings.push({severity,code,message,...(clean ? {url:clean} : {})});}
  };
  const network = definition.network ?? {}, allowSubdomains = network.allowSubdomains === true;
  function observeUrl(url,kind,imageProbe = false) {
    const origins = kind === 'image' ? network.imageOrigins : [...(network.origins ?? []),...(imageProbe ? network.imageOrigins ?? [] : [])];
    if (!allowsUrl(url,origins,allowSubdomains)) {
      let origin;try {origin = new URL(url).origin;} catch {origin = '[invalid URL]';}
      find('error',kind === 'image' ? 'missing_image_origin' : 'missing_http_origin',
        `The app will reject this URL. Check network.${kind === 'image' ? 'imageOrigins' : 'origins'}${imageProbe ? ' or network.imageOrigins (HEAD probe)' : ''} for ${origin}.`,url);
    }
  }
  async function request(input,{kind = 'http'} = {}) {
    let method = input.method ?? 'GET';
    const url = new URL(input.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw failure('permission_denied','Only HTTPS URLs without credentials are supported');
    if (!['GET','POST','HEAD'].includes(method)) throw failure('permission_denied','Unsupported diagnostic HTTP method');
    const row = {method,url:safeUrl(url),check:scope.getStore()?.name ?? 'setup'}, tick = Date.now();
    report.requests.push(row);
    const deadline = Math.min(input.timeoutMs ?? 10000,options.timeoutMs ?? 10000);
    const signals = [AbortSignal.timeout(deadline)];
    if (scope.getStore()?.signal) signals.push(scope.getStore().signal);
    const signal = AbortSignal.any(signals);
    const headers = new Headers({'User-Agent':browserAgent,...input.headers});
    // The diagnostic session is anonymous, including across redirects.
    for (const key of ['Cookie','Authorization','Proxy-Authorization']) headers.delete(key);
    const cookies = (network.cookieDefaults ?? []).filter(cookie => allowsUrl(url,[cookie.origin],allowSubdomains));
    if (cookies.length) headers.set('Cookie',cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '));
    let body;
    if (input.body != null) {
      body = typeof input.body === 'string' ? input.body : JSON.stringify(input.body);
      if (typeof input.body !== 'string' && !headers.has('Content-Type')) headers.set('Content-Type','application/json');
    }
    try {
      observeUrl(url,kind,method === 'HEAD');
      if (kind === 'http' && network.methods && !network.methods.includes(method)) find('error','missing_http_method',`The manifest does not allow ${method}.`,url);
      let target = url;
      for (let redirects = 0;;redirects++) {
        signal.throwIfAborted();
        const response = await fetchImpl(target.href,{method,headers,body,redirect:'manual',signal});
        row.status = response.status;
        const location = response.headers.get('location');
        if ([301,302,303,307,308].includes(response.status) && location) {
          await response.body?.cancel();
          if (redirects >= 5) throw failure('network','Too many redirects');
          const next = new URL(location,target);
          if (next.protocol !== 'https:' || next.username || next.password) throw failure('permission_denied','Redirect target must use HTTPS without credentials');
          find('info','redirect',`HTTP ${response.status}: ${safeUrl(target)} → ${safeUrl(next)}`,target);
          if (target.origin !== next.origin) {headers.delete('Cookie');headers.delete('Authorization');}
          if (response.status === 303 || (response.status === 301 || response.status === 302) && method === 'POST') {
            // Preserve a read-only source POST on 307/308, as fetch does.
            method = method === 'HEAD' ? 'HEAD' : 'GET';
            body = undefined;headers.delete('Content-Type');
          }
          target = next;
          observeUrl(target,kind,method === 'HEAD');
          row.responseUrl = safeUrl(target);
          continue;
        }
        row.contentType = response.headers.get('content-type') ?? '';
        const bytes = method === 'HEAD' ? new Uint8Array() : await readBody(response,input.responseType === 'bytes' ? 1024*1024 : 4*1024*1024);
        if (method === 'HEAD') await response.body?.cancel();
        const text = input.responseType === 'bytes' ? null : decodeBody(bytes,row.contentType);
        let data = text;
        if (input.responseType === 'json' && text) {
          try {data = JSON.parse(text);} catch {
            if (response.ok) throw failure(/cf-chl|just a moment|challenge-platform/iu.test(text) ? 'challenge_required' : 'parse_error','Expected JSON but received a non-JSON response');
          }
        } else if (input.responseType === 'bytes') data = [...bytes];
        if (!response.ok) throw failure(response.headers.get('cf-mitigated') === 'challenge' ? 'challenge_required' :
          ({401:'auth_required',403:'access_denied',404:'not_found',429:'rate_limited'}[response.status] ?? 'http_error'),
          `HTTP ${response.status}`,{httpStatus:response.status,status:response.status,body:data});
        if (typeof text === 'string' && /cf-chl|<title>\s*just a moment|challenge-platform/iu.test(text))
          throw failure('challenge_required','Browser challenge returned instead of source content');
        return {status:response.status,url:target.href,headers:Object.fromEntries(response.headers),body:data};
      }
    } catch (error) {
      const code = scope.getStore()?.signal.aborted ? 'cancelled' : signal.aborted ? 'timeout' : error.code ?? 'network';
      row.code = code;
      if (!error.code || signal.aborted) throw failure(code,code === 'cancelled' ? 'Diagnostic operation ended' : signal.aborted ? `HTTP deadline exceeded (${deadline} ms)` : 'HTTP transport failed',{
        cause:error,httpStatus:row.status});
      throw error;
    } finally {row.elapsedMs = Date.now()-tick;}
  }
  const settings = new Map(Object.entries(options.settings ?? {}));
  const defaults = Object.fromEntries((definition.settings?.fields ?? []).map(field => [field.key,field.default]));
  settings.set('source',{...defaults,...settings.get('source')});
  const ctx = {sourceId:definition.id,baseUrl,parameters:definition.parameters ?? {},
    http:{request},html:{extract:async (body,projection) => extractHtml(body,projection)},
    settings:{get:async key => settings.get(key) ?? null,set:async (key,value) => {settings.set(key,value);}},
    auth:{status:async () => ({authorized:false,revision:0}),getSession:async ({url}) => ({authorized:false,revision:0,origin:new URL(url).origin,headers:{},cookieHeader:''})},
    log:{info:() => {}}};
  let source;
  function images(items) {
    for (const item of items) for (const [key,kind] of [['coverUrl','cover'],['languageFlagUrl','flag'],['imageUrl','page']]) {
      const url = item?.[key];
      if (!url || seenMedia.has(url)) continue;
      seenMedia.add(url);observeUrl(url,'image');mediaCandidates.push({kind,url});report.media.push({kind,url:safeUrl(url)});
    }
  }
  function list(data,label,fields = []) {
    if (!Array.isArray(data)) throw failure('invalid_response',`${label} must return an array`);
    for (const item of data) if (!item || typeof item !== 'object' || fields.some(key => typeof item[key] !== 'string' || !item[key].trim()))
      throw failure('invalid_response',`${label} contains an item with a missing ${fields.join('/')}`);
    images(data);
    return data;
  }
  async function check(name,fn,{empty = false,advisory = false} = {}) {
    const tick = Date.now(), controller = new AbortController();
    let timer;
    const row = {name,status:'passed'};report.checks.push(row);
    try {
      const result = await Promise.race([
        scope.run({name,signal:controller.signal},fn),
        new Promise((_,reject) => {timer = setTimeout(() => {controller.abort();reject(failure('timeout','Operation deadline exceeded'));},options.operationTimeoutMs ?? 30000);}),
      ]);
      if (Array.isArray(result)) {
        row.count = result.length;
        if (empty && !result.length) {row.status = 'warning';row.message = 'No entries returned; inspect the parser or anonymous access requirements.';}
      }
      return result;
    } catch (error) {
      row.code = error.code ?? 'runtime_error';
      row.status = advisory || blockedBy(row.code) || name.startsWith('image:') && [405,501].includes(error.httpStatus) ? 'warning' : 'failed';
      const detail = String(error.message ?? '').replace(/https?:\/\/[^\s"'<>]+/gu,safeUrl).slice(0,400);
      row.message = `${row.code}${error.httpStatus ? ` (HTTP ${error.httpStatus})` : ''}${detail ? `: ${detail}` : ''}`;
      find(row.status === 'failed' ? 'error' : 'warning',row.code,
        blockedBy(row.code) ? `${name}: anonymous access is blocked or this chapter is restricted. Check login/browser verification in the app.` :
          `${name} failed. Check the HTTP trace, current website endpoints and parser contract.`);
      return undefined;
    } finally {
      clearTimeout(timer);controller.abort();row.elapsedMs = Date.now()-tick;onProgress({...row});
    }
  }
  const skip = (name,message) => {const row = {name,status:'skipped',message};report.checks.push(row);onProgress(row);};
  await check('factory',async () => {
    const instance = createSource(ctx);
    const mapping = {browse:'getPopular',latest:'getLatest',search:'search',filters:'getFilters',recommendations:'getRecommendations'};
    const required = ['getDetails',...(definition.metadataOnly ? [] : ['getChapters','getPages']),
      ...(definition.capabilities ?? []).flatMap(capability => mapping[capability] ? [mapping[capability]] : [])];
    if (!instance || typeof instance !== 'object' || required.some(method => typeof instance[method] !== 'function'))
      throw failure('invalid_response','Factory must provide the declared source methods');
    source = instance;
  });
  if (source) {
    if (options.checkWebsite !== false) await check('website',() => request({url:baseUrl,method:'GET',responseType:'text'}),{advisory:true});
    const can = method => typeof source[method] === 'function';
    if (can('getFilters')) await check('filters',async () => list(await source.getFilters({}),'Filters',['key','kind','label']));
    let titles = [];
    const pages = options.pages ?? 2;
    if (can('getPopular')) for (let page = 1; page <= pages; page++) {
      const items = await check(`popular:${page}`,async () => list(await source.getPopular({page}),'Catalog',['id','title']),{empty:page === 1});
      if (!items?.length) break;
      if (page > 1 && items.every(item => titles.some(previous => previous.id === item.id))) find('warning','repeated_catalog_page',`Catalog page ${page} contains only titles already returned on previous pages.`);
      titles.push(...items);
    }
    if (can('getLatest')) {
      const items = await check('latest',async () => list(await source.getLatest({page:1}),'Latest',['id','title']),{empty:true});
      if (!titles.length) titles = items ?? [];
    }
    if (can('search') && (options.search != null || titles.length || Object.keys(options.filters ?? {}).length))
      await check('search',async () => list(await source.search({searchTerm:options.search ?? titles[0]?.title ?? '',page:1,selectedFilters:options.filters ?? {}}),'Search',['id','title']));
    const mangaId = options.mangaId ?? titles[0]?.id;
    if (!mangaId) skip('details/chapters/pages','No title available; supply --manga with a known title ID.');
    else {
      if (can('getDetails')) await check('details',async () => {
        const result = await source.getDetails({mangaId});list([result],'Details',['id','title']);return [result];
      });
      if (can('getRecommendations')) await check('recommendations',async () => {
        const result = await source.getRecommendations({mangaId,page:1});
        return list(result?.items,'Recommendations',['id','title']);
      });
      if (definition.metadataOnly) skip('chapters/pages','Metadata-only source; no reader operations expected.');
      else {
        const chapters = can('getChapters') ? await check('chapters',async () => list(await source.getChapters({mangaId}),'Chapters',['id','title']),{empty:true}) : undefined;
        const chapter = options.chapterId ?? chapters?.find(item => !item.access || item.access.type === 'available')?.id;
        if (chapter && can('getPages')) await check('pages',async () => list(await source.getPages({mangaId,chapterId:chapter}),'Pages',['imageUrl']),{empty:true});
        else skip('pages','No available chapter; supply --chapter or check source authorization.');
      }
    }
    // One HEAD per media origin/kind, capped globally. Never download page images.
    const sampled = new Set();
    for (const media of mediaCandidates) {
      let key;try {key = new URL(media.url).origin+'|'+media.kind;} catch {continue;}
      if (sampled.has(key) || sampled.size >= (options.imageSamples ?? 3)) continue;
      sampled.add(key);
      await check(`image:${sampled.size}:${media.kind}`,async () => {
        const result = await request({url:media.url,method:'HEAD',responseType:'text',headers:{
          Accept:'image/avif,image/webp,image/*,*/*;q=0.8',Referer:(definition.media?.refererOrigin ?? new URL(baseUrl).origin)+'/',
          ...(definition.media?.sendOrigin ? {Origin:definition.media.refererOrigin ?? new URL(baseUrl).origin} : {}),
        }},{kind:'image'});
        if (!result.headers['content-type']?.toLowerCase().startsWith('image/')) find('warning','unexpected_image_type','Image endpoint did not report an image MIME type.',media.url);
      },{advisory:true});
    }
  }
  for (const row of report.requests) if (row.code || row.status >= 400)
    find('warning',row.code ?? 'http_error',`HTTP attempt failed during ${row.check}; the source may have recovered using a fallback.`,row.url);
  report.status = report.findings.some(value => value.severity === 'error') || report.checks.some(value => value.status === 'failed') ? 'error' :
    report.findings.some(value => value.severity === 'warning') || report.checks.some(value => value.status === 'warning') ? 'warning' : 'ok';
  report.elapsedMs = Date.now()-started;
  return report;
}

export function markdownReport(report) {
  const cell = value => String(value ?? '').replaceAll('|','\\|').replace(/[\r\n]+/gu,' ');
  return [`# Source diagnostics: ${report.source.name}`,``,
    `- Source: \`${report.source.id}\``, `- URL: ${report.source.baseUrl}`,`- Result: **${report.status}**`,
    `- Started: ${report.startedAt}`,`- Duration: ${(report.elapsedMs/1000).toFixed(1)} s`,
    '', '## Findings','',...(report.findings.length ? report.findings.map(row => `- **${row.severity} / ${row.code}**: ${row.message}${row.url ? ` (${row.url})` : ''}`) : ['No issues detected in the sampled operations.']),
    '', '## Checks','', '| Check | Result | Items | Time (ms) | Notes |','| --- | --- | --- | --- | --- |',
    ...report.checks.map(row => `| ${[row.name,row.status,row.count,row.elapsedMs,row.message].map(cell).join(' | ')} |`),
    '', '## HTTP trace','', '| Check | Method | Status | Time (ms) | URL | Result |','| --- | --- | --- | --- | --- | --- |',
    ...report.requests.map(row => `| ${[row.check,row.method,row.status,row.elapsedMs,row.url,row.code ?? row.responseUrl].map(cell).join(' | ')} |`),
    '', '## Observed images','',...report.media.map(row => `- ${row.kind}: ${row.url}`),
    '', '## Limits','',report.limitations,''].join('\n');
}
