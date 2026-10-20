import {recent} from '../core/recent.mjs';
import {parseError, record, string} from '../core/data.mjs';
import {finiteNumber, requireArray, requireRecord, requireText, urlWithQuery} from '../core/http.mjs';
import {decodeChapterId, needsTitlePreview, parseAccess, parseCatalogManga, parseChapterEntries, parseDetails,
  parseFilters, searchParameters, unavailable} from './libgroup_parser.mjs';

const fallbackDomains = ['https://api.cdnlibs.org','https://api2.mangalib.me','https://hapi.hentaicdn.org','https://api.imglib.info'];
const constantFields = ['genres','tags','types','scanlateStatus','status','format','ageRestriction','imageServers'];
const detailFields = ['background','eng_name','otherNames','summary','releaseDate','type_id','caution','views','close_view','rate_avg','rate',
  'genres','tags','teams','user','franchise','authors','publisher','userRating','moderated','metadata','metadata.count',
  'metadata.close_comments','manga_status_id','chap_count','status_id','artists','format','ageRestriction'];
export default function createLibGroup(ctx) {
  const siteId = Number(ctx.parameters.siteId), origin = new URL(ctx.baseUrl).origin;
  if (![1,2,4].includes(siteId)) throw new Error('Invalid LibGroup site configuration');
  const constantsCache = new Map(), serverCache = new Map(), probeCache = new Map(), probes = new Map();
  const dataList = value => requireArray(requireRecord(value).data,'LibGroup data');
  const dataMap = value => requireRecord(requireRecord(value).data,'LibGroup data');
  const trimDomain = domain => domain.trim().replace(/\/+$/u,'');
  async function settings() {
    return {imageServer:'compress',titleLanguage:'eng',chapterMode:'ms_mixing',showAlternativeBranchSource:false,
      apiDomain:'https://api2.mangalib.me',...record(await ctx.settings.get('source'))};
  }
  const headers = () => ({Accept:'application/json, text/plain, */*',Origin:origin,Referer:`${origin}/`,'Site-Id':String(siteId)});
  async function json(path, query, config, allowNotFound = false) {
    const domains = [...new Set([config.apiDomain,...fallbackDomains].map(trimDomain).filter(Boolean))];
    let last, onlyNotFound = true;
    for (const domain of domains) {
      try {
        const response = await ctx.http.request({method:'GET',url:urlWithQuery(`/api${path}`,domain,query),responseType:'json',headers:headers()});
        const body = requireRecord(response.body,'LibGroup response');
        if (allowNotFound && record(record(body.data).toast).message === 'Not Found') continue;
        return body;
      } catch (error) {
        const body = record(error.body ?? error.response?.body), value = record(body.data ?? body);
        const access = parseAccess(value);
        if (access.type !== 'available') throw unavailable(access);
        const status = error.httpStatus ?? error.status ?? error.response?.status;
        if (!error.code && !status) throw error;
        onlyNotFound &&= status === 404;
        // Do not retry authentication, rate limits, cancellation or a parser
        // failure against every mirror. Host cancellation covers child IO.
        if (!['network','offline','timeout','not_found'].includes(error.code) && ![404,500,502,503,504].includes(status)) throw error;
        last = error;
      }
    }
    if (allowNotFound && onlyNotFound) return null;
    throw last ?? parseError('LibGroup API mirrors did not return a valid response.');
  }
  async function constants(config, refresh = false) {
    const key = config.apiDomain;
    if (refresh) constantsCache.delete(key);
    if (constantsCache.has(key)) return constantsCache.get(key);
    const value = dataMap(await json('/constants',{'fields[]':constantFields},config));
    // Config changes cannot accumulate unlimited caches in a long-lived worker.
    if (constantsCache.size >= 8) constantsCache.delete(constantsCache.keys().next().value);
    constantsCache.set(key,value); return value;
  }
  async function catalog(page, query, config) {
    return dataList(await json('/manga',{'site_id[]':[siteId],page:Math.max(1,page),...query},config)).map(item => parseCatalogManga(item,config));
  }
  async function bySlug(id, config) {
    const index = id.indexOf('--'), token = (index < 0 ? id : id.slice(index+2)).trim();
    const normalized = token.replace(/[_-]/gu,' ').replace(/\s+/gu,' ').trim();
    for (const term of [...new Set([token,normalized])].filter(Boolean)) {
      const items = dataList(await json('/manga',{'site_id[]':[siteId],q:term},config));
      const item = items.find(value => requireRecord(value).slug_url === id);
      if (item) return item;
    }
    throw Object.assign(new Error('LibGroup title could not be found'),{code:'title_not_found'});
  }
  async function availableServers(config) {
    const map = new Map();
    for (const server of dataList({data:(await constants(config)).imageServers})) {
      const item = requireRecord(server,'image server');
      if (requireArray(item.site_ids,'image server sites').some(value => Number(value) === siteId)) {
        map.set(item.id == null ? '' : String(item.id),requireText(item.url,'image server url'));
      }
    }
    return map;
  }
  function configuredServer(config, servers) {
    const key = `${config.apiDomain}|${config.imageServer}`;
    if (serverCache.has(key)) return serverCache.get(key);
    const server = (config.imageServer === 'auto' ? null : servers.get(config.imageServer)) ??
      servers.get('compress') ?? servers.get('main') ?? servers.get('secondary');
    if (!server) throw parseError('LibGroup did not expose an image server for this site.');
    if (serverCache.size >= 32) serverCache.delete(serverCache.keys().next().value);
    serverCache.set(key,server); return server;
  }
  const normalizePath = path => path.startsWith('//') ? path.slice(1) : path;
  async function readableImage(url) {
    try {
      const response = await ctx.http.request({method:'HEAD',url,responseType:'text',timeoutMs:6000,
        headers:{Accept:'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',Origin:origin,Referer:`${origin}/`}});
      const rawSize = response.headers['content-length'];
      const size = rawSize == null || rawSize === '' ? NaN : Number(rawSize);
      return response.status >= 200 && response.status < 300 && (!Number.isFinite(size) || size > 600);
    } catch (error) {
      if (['cancelled','auth_session_changed'].includes(error.code)) throw error;
      if (['network','timeout','not_found','auth_required','challenge_required','access_denied'].includes(error.code) || error.status) return false;
      throw error;
    }
  }
  async function resolvePageUrl(raw, config, servers) {
    if (/^https?:\/\//u.test(raw)) return raw;
    const path = normalizePath(raw);
    if (config.imageServer !== 'auto') return configuredServer(config,servers)+path;
    const slash = path.lastIndexOf('/'), bucket = slash <= 0 ? path : path.slice(0,slash), key = `${config.apiDomain}|${bucket}`;
    if (probeCache.has(key)) return probeCache.get(key)+path;
    if (!probes.has(key)) probes.set(key,(async () => {
      for (const id of ['main','secondary','compress']) {
        const server = servers.get(id);
        if (server && await readableImage(server+path)) {
          if (probeCache.size >= 128) probeCache.delete(probeCache.keys().next().value);
          probeCache.set(key,server); return server;
        }
      }
      return configuredServer(config,servers);
    })().finally(() => probes.delete(key)));
    return await probes.get(key)+path;
  }
  const related = recent(async key => {
    const {id,config}=JSON.parse(key), seen=new Set([id]);
    return dataList(await json(`/manga/${encodeURIComponent(id)}/similar`,{},config)).map(value => requireRecord(requireRecord(value).media))
      .filter(media => media.site == null || Number(media.site) === siteId).map(media => parseCatalogManga(media,config))
      .filter(item => !seen.has(item.id) && seen.add(item.id));
  });
  return {
    async getFilters({refresh = false} = {}) { const config = await settings(); return parseFilters(await constants(config,refresh),siteId); },
    async getPopular({page = 1} = {}) { return catalog(page,{sort_by:'views'},await settings()); },
    async getLatest({page = 1} = {}) {
      const config = await settings(), items = dataList(await json('/latest-updates',{page:Math.max(1,page)},config));
      return items.length ? items.map(item => parseCatalogManga(item,config)) : catalog(page,{sort_by:'last_chapter_at'},config);
    },
    async search(query) {
      return catalog(query.page,query.searchTerm.trim() || Object.keys(query.selectedFilters ?? {}).length ? searchParameters(query) : {sort_by:'views'},await settings());
    },
    async getDetails({mangaId}) {
      const config = await settings(), payload = await json(`/manga/${encodeURIComponent(mangaId)}`,{'fields[]':detailFields},config,true);
      const details = payload == null || record(payload.data).toast ? null : dataMap(payload);
      const preview = !details || needsTitlePreview(details,config) ? await bySlug(mangaId,config) : null;
      return parseDetails({preview,details,settings:config});
    },
    async getChapters({mangaId}) {
      const config = await settings();
      return dataList(await json(`/manga/${encodeURIComponent(mangaId)}/chapters`,{},config)).flatMap(value => parseChapterEntries(value,config)).reverse();
    },
    async getPages({mangaId,chapterId}) {
      const query = decodeChapterId(chapterId), config = await settings();
      const data = dataMap(await json(`/manga/${encodeURIComponent(mangaId)}/chapter`,query,config)), access = parseAccess(data);
      if (access.type !== 'available') throw unavailable(access);
      const servers = await availableServers(config);
      const items = await Promise.all(requireArray(data.pages,'chapter.pages').map(async raw => {
        const item = requireRecord(raw,'page'), order = finiteNumber(item.slug);
        return {order,imageUrl:await resolvePageUrl(requireText(item.url,'page.url'),config,servers)};
      }));
      return items.sort((left,right) => left.order-right.order).map((item,index) => ({index,imageUrl:item.imageUrl}));
    },
    async getRecommendations({mangaId,page = 1}) {
      const config = await settings(), normalized = Math.max(1,page);
      const all = await related(JSON.stringify({id:mangaId,config}));
      return {page:normalized,hasNextPage:normalized*20 < all.length,items:all.slice((normalized-1)*20,normalized*20)};
    },
  };
}
