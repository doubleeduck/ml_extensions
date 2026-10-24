import {recent} from '../core/recent.mjs';
import {parseError,record,string} from '../core/data.mjs';
import {requireArray,requireRecord,urlWithQuery} from '../core/http.mjs';
import {buildFilters,numericId,parseCatalog,parseChapter,parseFilterOptions,parseManga,parsePages,searchParameters,titleId} from './remanga_parser.mjs';

export default function createRemanga(ctx) {
  const base = new URL(ctx.baseUrl).origin, api = ctx.parameters.apiBaseUrl;
  let filters = null, settings = null;
  const options = () => settings ??= ctx.settings.get('source').then(record,error => {settings = null; throw error;});
  async function request(url,responseType = 'json') {
    const response = await ctx.http.request({method:'GET',url,responseType,userAgentProfile:'browser',headers:{
      Accept:responseType === 'json' ? 'application/json' : 'text/html,application/xhtml+xml',Origin:base,Referer:`${base}/`,
    }});
    return response.body;
  }
  const json = (path,query) => request(urlWithQuery(path,api,query));
  const title = recent(id => json(`/api/v2/titles/${encodeURIComponent(titleId(id))}/`));
  function ended(error,page) {
    return page > 1 && error.httpStatus === 404 && /invalid page/iu.test(String(record(error.body).detail ?? ''));
  }
  async function catalog(query) {
    try {return parseCatalog(await json('/api/v2/search/catalog/',query),base).items;}
    catch (error) {if (ended(error,query.page)) return []; throw error;}
  }
  const chapters = recent(async id => {
    const [data,config] = await Promise.all([title(id),options()]), info = requireRecord(data,'ReManga title');
    if (record(info.meta).is_forbidden_by_country === true) throw Object.assign(Error('ReManga has restricted this title in the current country.'),{code:'chapter_unavailable',phase:'parse'});
    const branches = requireArray(info.branches,'ReManga branches'), all = config.branchMode === 'all';
    const selected = all ? branches : branches.slice(0,1);
    if (selected.length > 32) throw Object.assign(Error('ReManga branch work limit.'),{code:'resource_limit',phase:'pagination'});
    const lists = await Promise.all(selected.map(async branch => {
      const branchId = numericId(requireRecord(branch,'ReManga branch').id,'branch'), result = [], seen = new Set();
      for (let page=1;page<=200;page++) {
        const data = requireRecord(await json('/api/v2/titles/chapters/',{branch_id:branchId,ordering:'-index',page,count:50}),'ReManga chapter list');
        const rows = requireArray(data.results,'ReManga chapter results'); let added = 0;
        for (const raw of rows) {const item = parseChapter(raw,{withPublisher:all}); if (!seen.has(item.id)) {seen.add(item.id);result.push(item);added++;}}
        if (data.next == null) return result;
        if (Number(data.next) !== page+1 || !added) throw parseError('ReManga chapter pagination did not advance.');
      }
      throw Object.assign(Error('ReManga chapter work limit.'),{code:'resource_limit',phase:'pagination'});
    }));
    const seen = new Set(); return lists.flat().filter(item => !seen.has(item.id) && seen.add(item.id));
  });
  return {
    async getFilters({refresh = false} = {}) {
      if (refresh) filters = null;
      if (filters == null) {
        const pending = (async () => {
          const body = await request(`${base}/catalog`,'text');
          if (typeof body !== 'string' || !body.trim()) throw parseError('ReManga catalog is empty.');
          const scripts = await ctx.html.extract(body,{baseUrl:`${base}/catalog`,selector:'script:not([src])',all:true,text:true,normalizeWhitespace:false});
          return buildFilters(parseFilterOptions(scripts));
        })();
        filters = pending;
        pending.catch(() => {if (filters === pending) filters = null;});
      }
      return filters;
    },
    async getPopular({page = 1} = {}) {return catalog(searchParameters({page},'score'));},
    async getLatest({page = 1} = {}) {return catalog(searchParameters({page},'chapter_date'));},
    async search(query) {return catalog(searchParameters(query));},
    async getDetails({mangaId}) {
      const data = requireRecord(await title(titleId(mangaId)),'ReManga details');
      const description = string(data.description) ? await ctx.html.extract(data.description,{selector:'body',text:true}) : null;
      return parseManga(data,base,{description:string(description)});
    },
    async getChapters({mangaId}) {return chapters(titleId(mangaId));},
    async getPages({chapterId}) {
      const [data,config] = await Promise.all([json(`/api/v2/titles/chapters/${numericId(chapterId)}/`),options()]);
      return parsePages(data,config);
    },
    async getRecommendations({mangaId,page = 1}) {
      const normalized = Math.max(1,page);
      try {
        const data = parseCatalog(await json(`/api/v2/titles/${encodeURIComponent(titleId(mangaId))}/similar/`,{page:normalized,count:20}),base,{related:true});
        return {...data,items:data.items.filter(item => item.id !== mangaId),page:normalized};
      } catch (error) {if (ended(error,normalized)) return {items:[],page:normalized,hasNextPage:false}; throw error;}
    },
  };
}
