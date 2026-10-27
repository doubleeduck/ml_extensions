import {record} from '../core/data.mjs';
import {requireArray,urlWithQuery} from '../core/http.mjs';
import {recent} from '../core/recent.mjs';
import {catalogQuery,numericId,parseCatalog,parseChapters,parseFilters,parseManga,parsePages,parseTitleData,responseData} from './astramanga_parser.mjs';

export default function createAstraManga(ctx) {
  const base = new URL(ctx.baseUrl).origin, api = ctx.parameters.apiBaseUrl;
  async function request(url,responseType='json') {
    return ctx.http.request({method:'GET',url,responseType,userAgentProfile:'browser',headers:{Accept:responseType === 'json' ? 'application/json' : 'text/html',Referer:`${base}/`,Origin:base}});
  }
  const json = async (path,query) => (await request(urlWithQuery(path,api,query))).body;
  async function scripts(url) {
    const response = await request(url,'text');
    return requireArray(await ctx.html.extract(response.body,{selector:'script:not([src])',all:true,text:true,normalizeWhitespace:false}),'AstraManga page scripts');
  }
  const title = recent(async id=>{
    const data=parseTitleData(await scripts(`${base}/manga/${numericId(id)}`));
    if (numericId(data.manga.id) !== id) throw Object.assign(Error('AstraManga returned another title.'),{code:'parse_error',phase:'parse'});
    return data;
  });
  let filters = null;
  return {
    async getFilters({refresh=false}={}) {
      if (refresh) filters = null;
      if (filters == null) {
        const pending = scripts(`${base}/catalog`).then(parseFilters);
        filters = pending;
        pending.catch(()=>{if (filters === pending) filters = null;});
      }
      return filters;
    },
    async getPopular(query={}) {return parseCatalog(await json('/api/v1/search',catalogQuery(query,'popularity')),base);},
    async getLatest(query={}) {return parseCatalog(await json('/api/v1/search',catalogQuery(query,'updated_at')),base);},
    async search(query) {return parseCatalog(await json('/api/v1/search',catalogQuery(query)),base);},
    async getDetails({mangaId}) {return parseManga((await title(numericId(mangaId))).manga,base);},
    async getChapters({mangaId}) {return parseChapters(await title(numericId(mangaId)));},
    async getPages({chapterId}) {return parsePages(await json(`/api/v1/chapters/${numericId(chapterId)}/pages`));},
    async getRecommendations({mangaId,page=1}) {
      const currentPage = Math.max(1,Math.trunc(page)||1), id = numericId(mangaId);
      if (currentPage > 1) return {items:[],page:currentPage,hasNextPage:false};
      const responses = await Promise.all(['relations','similar'].map(key=>json(`/api/v1/titles/${id}/${key}`)));
      const items = [], seen = new Set([id]);
      for (const response of responses) {
        const data = responseData(response), rows = data == null ? [] : Array.isArray(data) ? data : record(data).items ?? record(data).titles ?? record(data).relations;
        for (const row of requireArray(rows,'AstraManga recommendations')) {
          const item = parseManga(record(row).related_title ?? record(row).title ?? row,base);
          if (!seen.has(item.id)) {seen.add(item.id);items.push(item);}
        }
      }
      return {items,page:currentPage,hasNextPage:false};
    },
  };
}
