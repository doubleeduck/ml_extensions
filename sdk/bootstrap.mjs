import URL from 'core-js-pure/actual/url/index.js';
import URLSearchParams from 'core-js-pure/actual/url-search-params/index.js';
import {Utf8TextEncoder, Utf8TextDecoder} from './utf8.mjs';

// Built into the host, not downloaded from an extension. All security decisions
// (source binding, origins, credentials, limits, cancellation) remain native/host.
const bridge = globalThis.__mlHost;
const operationId = globalThis.__mlOperationId;
const define = (name,value) => Object.defineProperty(globalThis,name,{value,writable:false,configurable:false});
define('URL',URL); define('URLSearchParams',URLSearchParams);
define('TextEncoder',Utf8TextEncoder); define('TextDecoder',Utf8TextDecoder);
function freeze(value) {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
function failure(error) {
  const allowed = new Set(['unsupported','parse_error','invalid_response','network','offline','timeout','cancelled','auth_required',
    'challenge_required','access_denied','auth_session_changed','not_found','title_not_found','chapter_not_found','chapter_unavailable',
    'permission_denied','incompatible_api','rate_limited','resource_limit','runtime_crashed','source_unavailable']);
  const result = {code:allowed.has(error?.code) ? error.code : 'parse_error',
    phase:['http','html','settings','auth','parse','javascript','runtime','ipc','startup'].includes(error?.phase) ? error.phase : 'parse',
    message:typeof error?.message === 'string' ? error.message.slice(0,1024) : 'Source failed'};
  if (Number.isInteger(error?.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599) result.httpStatus = error.httpStatus;
  if (Number.isInteger(error?.retryAfterSeconds) && error.retryAfterSeconds >= 0 && error.retryAfterSeconds <= 86400) result.retryAfterSeconds = error.retryAfterSeconds;
  if (result.code === 'chapter_unavailable' && error?.access != null) {
    try { validateWire(error.access); result.access = error.access; }
    catch { result.code = 'invalid_response'; }
  }
  return result;
}
function validateWire(value, seen = new Set(), depth = 0) {
  if (depth > 32 || value === undefined || typeof value === 'number' && !Number.isFinite(value) ||
      !['object','string','number','boolean'].includes(typeof value)) {
    throw Object.assign(new Error('Non-JSON source result'),{code:'invalid_response'});
  }
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value) || !Array.isArray(value) && ![null,Object.prototype].includes(Object.getPrototypeOf(value))) {
    throw Object.assign(new Error('Cyclic or non-data source result'),{code:'invalid_response'});
  }
  seen.add(value);
  for (const child of Object.values(value)) validateWire(child,seen,depth+1);
  seen.delete(value);
}
let instance, definition, initialized = false;
const operations = new Set();
const methodCapability = {getPopular:'browse',getLatest:'latest',search:'search',getFilters:'filters',getRecommendations:'recommendations'};
const methods = ['getFilters','getPopular','getLatest','search','getDetails','getChapters','getPages','getRecommendations'];
function call(kind,payload) {
  if (!operations.has(operationId())) throw Object.assign(new Error('Host API unavailable outside an active request'),{code:'permission_denied'});
  return bridge(kind,payload);
}
define('__mlInitialize',async config => {
  if (initialized) throw new Error('Source context is already initialized');
  initialized = true; definition = freeze(config.definition);
  const context = freeze({sourceId:definition.id,baseUrl:definition.baseUrl,parameters:definition.parameters ?? {},
    http:{request:input => call('http',input)},
    html:{extract:(body,query) => call('html',{body,query})},
    settings:{get:key => call('settings.get',{key}),set:(key,value) => call('settings.set',{key,value})},
    auth:{status:() => call('auth.status',{}),getSession:input => call('auth.session',input)},
    log:{info:(event,fields = {}) => { void call('log',{event,fields}).catch(() => {}); }},
  });
  try {
    // Imports/factory run without an operation: even well-formed host API calls are
    // disallowed during the offline installation/startup contract probe.
    const imported = await import(config.entrypoint);
    if (typeof imported.default !== 'function') throw new Error('Missing source factory export');
    instance = imported.default(context);
    if (!instance || typeof instance !== 'object' || typeof instance.then === 'function') throw new Error('Source factory must return a synchronous instance');
    const required = ['getDetails','getChapters','getPages',
      ...Object.entries(methodCapability).filter(([,cap]) => definition.capabilities.includes(cap)).map(([method]) => method)];
    for (const method of required) if (typeof instance[method] !== 'function') throw new Error(`Missing source method ${method}`);
    await bridge('ready',{ok:true,methods:methods.filter(method => typeof instance[method] === 'function')});
  } catch (error) { instance = undefined; await bridge('ready',{ok:false,error:failure(error)}); }
});
define('__mlInvoke',async (requestId,method,args) => {
  if (!instance || operations.size >= 5 || operations.has(requestId) || operationId() !== requestId ||
      !Number.isSafeInteger(requestId) || requestId < 1) throw new Error('Invalid source invocation');
  operations.add(requestId);
  let result;
  try {
    if (!methods.includes(method) || typeof instance[method] !== 'function' ||
        methodCapability[method] && !definition.capabilities.includes(methodCapability[method])) {
      throw Object.assign(new Error('Source method is unsupported'),{code:'unsupported'});
    }
    const value = await instance[method](freeze(args));
    validateWire(value);
    result = {requestId,ok:true,value};
  } catch (error) { result = {requestId,ok:false,error:failure(error)}; }
  finally { operations.delete(requestId); }
  // Revoke SDK access before publishing the terminal event. Detached jobs retain
  // their native operation identity and can never borrow another invocation.
  await bridge('result',result);
});
define('__mlCancel',requestId => { operations.delete(requestId); });
