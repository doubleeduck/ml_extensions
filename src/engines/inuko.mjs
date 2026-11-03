import {parseError,record} from '../core/data.mjs';
import {urlWithQuery} from '../core/http.mjs';
import {recent} from '../core/recent.mjs';
import {serializedPage} from '../core/serialized_page.mjs';
import {catalogQuery} from '../sources/puremanga_parser.mjs';

// Per-source/account SSR transport. Catalogs share only in-flight work; title
// metadata and chapters share one bounded load without executing website code.
export default function createInuko(ctx,parser) {
  const base=new URL(ctx.baseUrl).origin, pending=new Map();
  let labels=null,labelPending=null;
  const denied=()=>Object.assign(Error('Sign in on the source website to access this chapter.'),{code:'auth_required',phase:'http'});
  function titlePath(raw){
    let path;try{path=new URL(raw,base).pathname;}catch{throw parseError('Invalid title ID.');}
    if(!/^\/content\/[^/?#]+$/u.test(path))throw parseError('Invalid title ID.');return path;
  }
  async function load(path,query){
    const url=urlWithQuery(path,base,query);
    if(pending.has(url))return pending.get(url);
    const job=(async()=>{
      const response=await ctx.http.request({method:'GET',url,responseType:'text',userAgentProfile:'browser',headers:{Accept:'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',Referer:base+'/'}});
      if(response.url&&new URL(response.url).hostname==='sso.inuko.me')throw denied();
      if(typeof response.body!=='string'||!response.body.trim())throw parseError('Source returned an empty page.');
      const data=record(await ctx.html.extract(response.body,{baseUrl:response.url??url,fields:{scripts:{selector:'script',all:true,text:true}}}));
      if(!Array.isArray(data.scripts))throw parseError('Source page scripts are missing.');
      return serializedPage(data.scripts);
    })();
    const tracked=job.then(value=>{pending.delete(url);return value;},error=>{pending.delete(url);throw error;});
    pending.set(url,tracked);return tracked;
  }
  function array(state,key){return state.first(key,Array.isArray);}
  function rememberLabels(state){
    const found=state.values('labels').filter(value=>Array.isArray(value)&&value.every(row=>row&&['GENRE','TAG'].includes(row.kind))).sort((a,b)=>b.length-a.length)[0];
    if(found)labels=found;
  }
  async function taxonomy(refresh=false){
    if(refresh)labels=null;
    if(labels!==null)return labels;
    if(!labelPending){
      const job=load('/content',catalogQuery()).then(state=>{rememberLabels(state);if(labels===null)throw parseError('Source taxonomy is missing.');return labels;});
      labelPending=job.then(value=>{labelPending=null;return value;},error=>{labelPending=null;throw error;});
    }
    return labelPending;
  }
  async function catalog(query={},sort){
    const selected=query.selectedFilters??{};
    const hasLabels=['genre','tags'].some(key=>selected[key]?.length);
    const parameters=catalogQuery(query,sort,hasLabels?await taxonomy():[]);
    const state=await load('/content',parameters);rememberLabels(state);
    return array(state,'books').map(parser.parseManga);
  }
  const book=recent(async path=>{
    const state=await load(path+'/chapters'),raw=state.first('book',value=>value&&typeof value.slug==='string');
    return {raw,manga:parser.parseManga(raw),chapters:state.values('chapters').find(Array.isArray)??null};
  });
  const recommendations=recent(async path=>{
    const state=await load(path),rows=array(state,'relatedBooks'),seen=new Set([path]),items=[];
    for(const row of rows){const item=parser.parseManga(row.book??row);if(!seen.has(item.id)){seen.add(item.id);items.push(item);}}
    return items;
  });
  return {
    async getPopular(query={}){return catalog(query,'viewsCount');},
    async getLatest(query={}){return catalog(query,'latestChapterAt');},
    async search(query={}){return catalog(query);},
    async getFilters({refresh=false}={}){return parser.parseFilters(await taxonomy(refresh));},
    async getDetails({mangaId}){return (await book(titlePath(mangaId))).manga;},
    async getChapters({mangaId}){
      const data=await book(titlePath(mangaId));
      if(data.chapters===null)throw parseError('Source chapter list is missing.');
      if(!data.chapters.length&&data.raw.chaptersCount>0&&data.raw.readingRestriction==='AUTHORIZED_ONLY'){
        throw denied();
      }
      return parser.parseChapters(data.chapters,titlePath(mangaId));
    },
    async getPages({mangaId,chapterId}){
      const path=titlePath(mangaId);
      if(!parser.isValidChapterId(chapterId)||!String(chapterId).startsWith(path+'/'))throw parseError('Invalid chapter ID.');
      const state=await load(path+'/'+chapterId.split('/').at(-1));
      const rawPages=state.values('pages').find(Array.isArray);
      if(!rawPages?.length){
        const raw=state.values('book').find(value=>value&&typeof value.readingRestriction==='string');
        if(raw?.readingRestriction==='AUTHORIZED_ONLY')throw denied();
        throw Object.assign(Error('Source chapter has no available pages.'),{code:'chapter_unavailable',phase:'parse'});
      }
      return parser.parsePages({pages:rawPages});
    },
    async getRecommendations({mangaId,page=1}){
      const current=Math.max(1,Math.trunc(Number(page))||1),path=titlePath(mangaId);
      return {items:current===1?await recommendations(path):[],page:current,hasNextPage:false};
    },
  };
}
