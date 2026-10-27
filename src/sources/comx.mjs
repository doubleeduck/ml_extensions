import {record,parseError} from '../core/data.mjs';
import {requireArray} from '../core/http.mjs';
import {recent} from '../core/recent.mjs';
import {catalogRequest,chapterId,parseChapters,parseDetails,parseFilters,parseListing,parsePages,titleId} from './comx_parser.mjs';

const item = {fields:{href:{attr:'href'},link:{selector:'a[href*=".html"]',attr:'href'},title:{selector:'.readed__title, .poster__title',text:true},
  image:{selector:'img',fields:{src:{attr:'src'},lazy:{attr:'data-src'},alt:{attr:'alt'}}},rating:{selector:'.poster__label--rate',text:true},metadata:{selector:'.readed__meta-item',all:true,text:true}}};
const scripts = {selector:'script:not([src])',all:true,text:true,normalizeWhitespace:false};
const details = {fields:{title:{selector:'.page__header h1',text:true},secondaryTitle:{selector:'.page__title-original',text:true},description:{selector:'.page__text',text:true},
  image:{selector:'.page__poster img',fields:{src:{attr:'src'},lazy:{attr:'data-src'}}},rating:{selector:'.page__rating',text:true},
  metadata:{selector:'.page__list li',all:true,fields:{label:{selector:'div',text:true},value:{text:true}}},tags:{selector:'.page__tags a',all:true,text:true},
  scripts,recommendations:{...item,selector:'#rec-similar a.poster',all:true}}};
export function isChallenge(body,url='') {
  return /\/_c(?:\?|$)/u.test(url) || typeof body === 'string' && /(?:__guard_trust|function\s+showTs|Для доступа к сайту необходимо включить JavaScript|cf-chl-|cf-turnstile|challenges\.cloudflare\.com\/turnstile)/iu.test(body);
}
export default function createComX(ctx) {
  const base = new URL(ctx.baseUrl).origin;
  async function request(input,probeRedirect=true) {
    try {
      const response = await ctx.http.request({method:'GET',...input,responseType:'text',userAgentProfile:'browser',headers:{Accept:'text/html,application/xhtml+xml',Referer:`${base}/`,...input.headers}});
      if (isChallenge(response.body,response.url)) throw Object.assign(Error('Com-X browser verification is required.'),{code:'challenge_required',phase:'http'});
      if (typeof response.body !== 'string' || !response.body.trim()) throw parseError('Com-X returned an empty page.');
      return response;
    } catch (error) {
      if (isChallenge(error.body)) throw Object.assign(Error('Com-X browser verification is required.'),{code:'challenge_required',phase:'http',httpStatus:error.httpStatus});
      // The host deliberately refuses to replay POST redirects. A protection
      // redirect must be inspected with a safe GET before retrying any form.
      if (probeRedirect && input.method === 'POST' && error.code === 'invalid_response' && /POST redirects/iu.test(error.message)) {
        const response=await redirectCheck(input.url);
        return request({...input,url:response.url},false);
      }
      throw error;
    }
  }
  const redirectCheck=recent(url=>request({url},false));
  const title = recent(async id=>{
    const response = await request({url:`${base}/${titleId(id)}-manga.html`});
    const data = parseDetails(await ctx.html.extract(response.body,{...details,baseUrl:response.url}),base);
    if (data.info.id !== id) throw parseError('Com-X returned another title.');
    return data;
  });
  let filters = null;
  async function catalog(query,sort) {
    try {
      const response = await request(catalogRequest(base,query,sort));
      const rows = await ctx.html.extract(response.body,{...item,baseUrl:response.url,selector:'#dle-content .short, #dle-content a.poster',all:true});
      return parseListing(rows,base);
    } catch(error) {
      if (Number(query?.page) > 1 && error.code === 'not_found') return [];
      throw error;
    }
  }
  return {
    async getFilters({refresh=false}={}) {
      if (refresh) filters = null;
      if (filters == null) {
        const pending = request({url:`${base}/comix-read/`}).then(response=>ctx.html.extract(response.body,scripts)).then(parseFilters);
        filters = pending;pending.catch(()=>{if (filters === pending) filters = null;});
      }
      return filters;
    },
    async getPopular(query={}) {return catalog(query,'rating');},
    async getLatest(query={}) {return catalog(query,'editdate');},
    async search(query) {return catalog(query);},
    async getDetails({mangaId}) {return (await title(titleId(mangaId))).info;},
    async getChapters({mangaId}) {const id=titleId(mangaId);return parseChapters((await title(id)).chapters,id);},
    async getPages({mangaId,chapterId:rawId}) {
      const id=chapterId(rawId);
      if (mangaId != null && titleId(mangaId) !== id.title) throw parseError('Com-X chapter does not belong to the title.');
      const [response,config,session] = await Promise.all([request({url:`${base}/reader/${id.title}/${id.chapter}`}),ctx.settings.get('source'),ctx.auth.getSession({url:base})]);
      return parsePages(requireArray(await ctx.html.extract(response.body,scripts),'Com-X reader'),rawId,{server:record(config).imageServer,cookieHeader:session.cookieHeader ?? session.headers?.Cookie ?? ''});
    },
    async getRecommendations({mangaId,page=1}) {
      const currentPage=Math.max(1,Math.trunc(page)||1);
      return {items:currentPage === 1 ? (await title(titleId(mangaId))).recommendations : [],page:currentPage,hasNextPage:false};
    },
  };
}
