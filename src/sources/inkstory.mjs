import {manga, normalizeText, parseError, record, records} from '../core/data.mjs';
import {isValidChapterId, parseCatalog, parseChapters, parseFilters, parseManga, parsePages} from './inkstory_parser.mjs';

// One factory invocation per source context; never shared with another source.
export default function createInkStory(ctx) {
  let cachedFilters = null;
  async function base() {
    const settings = record(await ctx.settings.get('network'));
    return settings.customBaseUrl ?? ctx.baseUrl;
  }
  function apiUrl(path, query = {}) {
    const url = new URL(path, 'https://api.inuko.me/v2/');
    for (const [key, values] of Object.entries(query)) {
      for (const value of Array.isArray(values) ? values : [values]) url.searchParams.append(key, String(value));
    }
    return url.href;
  }
  async function json(path, query) {
    const response = await ctx.http.request({method:'GET', url:apiUrl(path, query), responseType:'json',
      userAgentProfile:'senkuro', headers:{Accept:'application/json, text/plain, */*', 'X-Service-Name':'inkstory'}});
    return response.body;
  }
  function mangaPath(id) {
    let path;
    try { path = new URL(id, ctx.baseUrl).pathname; } catch { throw parseError('InkStory manga id is invalid.'); }
    if (!/^\/content\/[^/]+$/u.test(path)) throw parseError('InkStory manga id is invalid.');
    return path;
  }
  async function catalog({page = 1, sort = 'viewsCount,desc', search = '', filters = {}} = {}) {
    await base();
    const order = filters.sort ?? [];
    const query = {serviceName:'inkstory', page:Math.max(0, page-1), size:30,
      sort:order.length ? `${order[0]},${order.length > 1 && order[1] === 'asc' ? 'asc' : 'desc'}` : sort};
    if (search.trim()) query.search = search.trim();
    for (const key of ['status','country','contentStatus','formats']) {
      if (filters[key]?.length) query[key] = filters[key];
    }
    for (const value of filters.genre ?? []) {
      if (value.startsWith('exclude:')) (query.labelsExclude ??= []).push(value.slice(8));
      else if (value.startsWith('include:')) (query.labelsInclude ??= []).push(value.slice(8));
    }
    if (filters.strictLabelEqual?.includes('true')) query.strictLabelEqual = 'true';
    const ranges = {chaptersCountMin:[0,100000,true], chaptersCountMax:[0,100000,true],
      averageRatingMin:[0,10,false], averageRatingMax:[0,10,false], yearMin:[1900,2100,true], yearMax:[1900,2100,true]};
    for (const [key, [min,max,integer]] of Object.entries(ranges)) {
      const raw = filters[key]?.[0]?.trim().replaceAll(',', '.');
      if (!raw) continue;
      const value = Number(raw);
      if (Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value))) query[key] = String(value);
    }
    return parseCatalog(await json('books', query));
  }
  return {
    async getFilters({refresh = false} = {}) {
      if (!refresh && cachedFilters !== null) return cachedFilters;
      cachedFilters = parseFilters(await json('labels'));
      return cachedFilters;
    },
    async getPopular({page = 1} = {}) { return catalog({page}); },
    async getLatest({page = 1} = {}) {
      await base();
      return parseCatalog(await json('chapter-update-feed', {serviceName:'inkstory', onlyBorderChapters:'true', page:Math.max(0,page-1), size:30}));
    },
    async search({searchTerm = '', page = 1, selectedFilters = {}}) {
      return catalog({page, search:searchTerm, filters:selectedFilters});
    },
    async getDetails({mangaId}) {
      await base();
      const path = mangaPath(mangaId);
      return parseManga(record(await json(`books/${path.split('/').at(-1)}`)));
    },
    async getChapters({mangaId}) {
      const path = mangaPath(mangaId);
      const details = record(await json(`books/${path.split('/').at(-1)}`));
      if (typeof details.id !== 'string') throw parseError('InkStory book id is missing.');
      return parseChapters(await json('chapters', {bookId:details.id, moderationStatus:'APPROVED'}), path);
    },
    async getPages({mangaId, chapterId}) {
      mangaPath(mangaId);
      if (!isValidChapterId(chapterId)) throw parseError('InkStory chapter id is invalid.');
      return parsePages(await json(`chapters/${chapterId.split('/').at(-1)}`));
    },
    async getRecommendations({mangaId, page = 1}) {
      const currentPage = Math.max(1, page);
      if (currentPage > 1) return {items:[],page:currentPage,hasNextPage:false};
      const baseUrl = await base(), path = mangaPath(mangaId);
      const response = await ctx.http.request({method:'GET', url:new URL(path, baseUrl).href, responseType:'text',
        userAgentProfile:'browser', headers:{Accept:'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', Referer:new URL('/',baseUrl).href}});
      if (typeof response.body !== 'string' || !response.body.trim()) throw parseError('InkStory returned an empty page.');
      const projection = await ctx.html.extract(response.body, {
        baseUrl:response.url, selector:'h2', textEquals:'Похожее', ascend:2, nextSibling:true,
        fields:{items:{selector:'a[href^="/content/"]',all:true,fields:{
          path:{attr:'href'},text:{text:true},image:{selector:'img',fields:{
            alt:{attr:'alt'},src:{attr:'src',absoluteUrl:true}}}}}},
      });
      const seen = new Set([path]), items = [];
      for (const item of records(record(projection).items)) {
        if (typeof item.path !== 'string' || !/^\/content\/[^/]+$/u.test(item.path) || !item.image || seen.has(item.path)) continue;
        seen.add(item.path);
        const image = record(item.image), title = normalizeText(image.alt ?? item.text);
        if (title) items.push(manga({id:item.path,title,coverUrl:image.src ?? null}));
      }
      return {items,page:currentPage,hasNextPage:false};
    },
  };
}
