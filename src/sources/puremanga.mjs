import {manga,normalizeText,parseError,record,records,string} from '../core/data.mjs';
import {requireArray,urlWithQuery} from '../core/http.mjs';
import {recent} from '../core/recent.mjs';
import {catalogQuery,isValidChapterId,parseCatalog,parseChapters,parseFilters,parseListing,parseManga,parsePages} from './puremanga_parser.mjs';

export default function createPureManga(ctx) {
  const base = new URL(ctx.baseUrl).origin, api = ctx.parameters.apiBaseUrl, serviceName = ctx.parameters.serviceName;
  async function json(path,query) {
    const response = await ctx.http.request({method:'GET',url:urlWithQuery(path,api,query),responseType:'json',userAgentProfile:'browser',
      headers:{Accept:'application/json','X-Service-Name':serviceName,Referer:`${base}/`,Origin:base}});
    return response.body;
  }
  function titlePath(raw) {
    let url; try {url=new URL(raw,base);} catch {throw parseError('Invalid PureManga title ID.');}
    if (!/^\/content\/[^/?#]+$/u.test(url.pathname)) throw parseError('Invalid PureManga title ID.');
    return url.pathname;
  }
  const title = recent(path=>json(`books/${encodeURIComponent(path.split('/').at(-1))}`));
  const chapters = recent(async path=>{
    const data=record(await title(path));
    if (!string(data.id)) throw parseError('PureManga title UUID is missing.');
    return parseChapters(await json('chapters',{bookId:data.id,moderationStatus:'APPROVED'}),path);
  });
  let filters = null;
  async function taxonomy(refresh=false) {
    if(refresh)filters=null;
    if(filters==null) {
      const pending=json('labels').then(value=>{const labels=requireArray(value,'PureManga labels');return {labels,definitions:parseFilters(labels)};});
      filters=pending;pending.catch(()=>{if(filters===pending)filters=null;});
    }
    return filters;
  }
  async function catalog(query={},forcedSort) {
    const selected=query.selectedFilters??{},hasLabels=['genre','tags'].some(key=>selected[key]?.length);
    const parameters=catalogQuery(query,forcedSort,hasLabels?(await taxonomy()).labels:[]);
    const response=await ctx.http.request({method:'GET',url:urlWithQuery('/content',base,parameters),responseType:'text',userAgentProfile:'browser',headers:{Accept:'text/html',Referer:`${base}/`}});
    const data=record(await ctx.html.extract(response.body,{baseUrl:response.url,fields:{heading:{selector:'h1',text:true},items:{selector:'.grid > a[href^="/content/"]',all:true,
      fields:{path:{attr:'href'},image:{selector:'img',fields:{alt:{attr:'alt'},src:{attr:'src',absoluteUrl:true}}},rating:{selector:'[class~="absolute"]',text:true},metadata:{selector:'p',all:true,text:true}}}}}));
    if(normalizeText(data.heading)!=='Каталог')throw parseError('PureManga returned no catalog page.');
    return parseListing(data.items);
  }
  return {
    async getFilters({refresh=false}={}) {
      return (await taxonomy(refresh)).definitions;
    },
    async getPopular(query={}) {return catalog(query,'viewsCount');},
    async getLatest({page=1}={}) {return parseCatalog(requireArray(await json('chapter-update-feed',{serviceName,onlyBorderChapters:true,page:Math.max(0,(Math.trunc(Number(page))||1)-1),size:30}),'PureManga updates'));},
    async search(query) {return catalog(query);},
    async getDetails({mangaId}) {return parseManga(await title(titlePath(mangaId)));},
    async getChapters({mangaId}) {return chapters(titlePath(mangaId));},
    async getPages({mangaId,chapterId}) {
      const path=titlePath(mangaId);
      if (!isValidChapterId(chapterId) || !String(chapterId).startsWith(`${path}/`)) throw parseError('Invalid PureManga chapter ID.');
      const pages=parsePages(await json(`chapters/${encodeURIComponent(chapterId.split('/').at(-1))}`));
      if (!pages.length) throw Object.assign(Error('PureManga chapter has no available pages.'),{code:'chapter_unavailable',phase:'parse'});
      return pages;
    },
    async getRecommendations({mangaId,page=1}) {
      const currentPage=Math.max(1,Math.trunc(page)||1),path=titlePath(mangaId);
      if(currentPage>1)return {items:[],page:currentPage,hasNextPage:false};
      const response=await ctx.http.request({method:'GET',url:new URL(path,base).href,responseType:'text',userAgentProfile:'browser',headers:{Accept:'text/html',Referer:`${base}/`}});
      const data=await ctx.html.extract(response.body,{baseUrl:response.url,selector:'h2',textEquals:'Похожее',ascend:2,nextSibling:true,fields:{items:{selector:'a[href^="/content/"]',all:true,
        fields:{path:{attr:'href'},image:{selector:'img',fields:{alt:{attr:'alt'},src:{attr:'src',absoluteUrl:true}}}}}}});
      const seen=new Set([path]),items=[];
      for(const row of records(record(data).items)) {
        if(!/^\/content\/[^/?#]+$/u.test(row.path ?? '')||seen.has(row.path))continue;
        const image=record(row.image),title=normalizeText(image.alt),coverUrl=string(image.src);
        if(!title||!coverUrl||!coverUrl.startsWith('https://'))continue;
        seen.add(row.path);items.push(manga({id:row.path,title,coverUrl}));
      }
      return {items,page:currentPage,hasNextPage:false};
    },
  };
}
