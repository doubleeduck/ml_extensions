import {chapter,filter,manga,normalizeText,parseError,record,string} from '../core/data.mjs';
import {requireArray,requireRecord,urlWithQuery} from '../core/http.mjs';

const base = 'https://pururin.me';
// The site/legacy parser gives Artist CG and Manga the same taxonomy ID.
// One selectable value avoids duplicate keys while retaining that exact query.
const types = [['17783','Artbook'],['13004','Artist CG / Manga'],['13003','Doujinshi'],['13008','Game CG'],['27939','Webtoon']];
const legacyTypes = [['17783','Artbook'],['13004','Artist CG'],['13003','Doujinshi'],['13008','Game CG'],['13004','Manga'],['27939','Webtoon']];
const fields = [['tags','content','Tags'],['artists','artist','Artists'],['circles','circle','Circles'],['parodies','parody','Parodies'],
  ['languages','language','Languages'],['scanlators','scanlator','Scanlators'],['conventions','convention','Conventions'],['collections','collection','Collections'],
  ['categories','category','Categories'],['uploaders','uploader','Uploaders']];
export function buildFilters() {
  return [filter('sort','sort','Sort by',[['newest','Newest'],['most-popular','Most Popular'],['highest-rated','Highest Rated'],['most-viewed','Most Viewed'],['title','Title']]),
    filter('multiSelect','types','Types',types),...fields.map(([key,,label]) => ({...filter('text',key,label),caption:key === 'tags'
      ? 'Separate tags with commas. Prefix with "-" to exclude.' : `Separate ${key} with commas.`})),
    {...filter('text','pages','Pages'),caption:'Filter by pages, for example: >20, <=40, 25.'}];
}
export function pageRange(raw) {
  const value = raw.trim(), digits = value.replace(/[^0-9]/gu,'');
  if (!digits) return [1,9999];
  const number = Number(digits), bound = value => Math.min(9999,Math.max(1,value));
  if (value.startsWith('<=') || value.startsWith('=<')) return [1,bound(number)];
  // Preserve the legacy site's less-than query convention (+1).
  if (value.startsWith('<')) return [1,bound(number+1)];
  if (value.startsWith('>=') || value.startsWith('=>')) return [bound(number),9999];
  if (value.startsWith('>')) return [bound(number+1),9999];
  return [bound(number),bound(number)];
}
export const normalizePath = value => { const path = new URL(value.trim() || '/',base).pathname; return path.endsWith('/') ? path : `${path}/`; };
const imageProjection = selector => ({selector,fields:{lazy:{attr:'data-src'},src:{attr:'src'}}});
const imageUrl = value => { const row = record(value), raw = string(row.lazy) ?? string(row.src); return raw ? new URL(raw,base).href : null; };
export const listingProjection = {selector:'a.card',all:true,fields:{href:{attr:'href'},title:{attr:'title'},alt:{selector:'img',attr:'alt'},image:imageProjection('img')}};
export function parseListing(input) {
  const result = [], seen = new Set();
  for (const value of requireArray(input,'Pururin catalog')) {
    const row = requireRecord(value,'Pururin card'), href = string(row.href), title = string(normalizeText(row.title ?? row.alt));
    if (!href || !title) continue;
    const id = normalizePath(href); if (seen.has(id)) continue;
    seen.add(id); result.push(manga({id,title,coverUrl:imageUrl(row.image)}));
  }
  return result;
}
const texts = input => requireArray(input,'Pururin text values').map(normalizeText).filter(Boolean);
export const detailsProjection = {selector:'.box-gallery',fields:{title:{selector:'.title',text:true},image:imageProjection('img'),
  authors:{selector:'a[href*="/circle/"]',all:true,text:true},artists:{selector:'[itemprop="author"]',all:true,text:true},tags:{selector:'a[href*="/content/"]',all:true,text:true},
  rows:{selector:'.table-info tr',all:true,fields:{cells:{selector:'td',all:true,text:true},links:{selector:'a',all:true,text:true}}}}};
export function parseDetails(input,id) {
  const root = requireRecord(input,'Pururin gallery'), title = string(normalizeText(root.title));
  if (!title) throw parseError('Pururin title is missing.');
  const author = texts(root.authors).join(', ') || null, artist = texts(root.artists).join(', ') || null, description = [];
  for (const value of requireArray(root.rows,'Pururin metadata')) {
    const row = requireRecord(value,'Pururin metadata row'), cells = requireArray(row.cells,'Pururin cells');
    if (!cells.length || /content|ratings/u.test(normalizeText(cells[0]).toLowerCase())) continue;
    const links = requireArray(row.links,'Pururin metadata links'), values = texts(links.length ? links : cells.slice(1));
    if (values.length) description.push(`${normalizeText(cells[0])}: ${values.join(', ')}`);
  }
  return manga({id:normalizePath(id),title,coverUrl:imageUrl(root.image),author:author ?? artist,artist:artist ?? author,
    description:description.join('\n') || null,status:'completed',ageRating:'18+',tags:texts(root.tags)});
}
export default function createPururin(ctx) {
  async function request(url,{method = 'GET',body,referer = url,json = false} = {}) {
    const response = await ctx.http.request({method,url,responseType:'text',body,userAgentProfile:'browser',headers:{
      Accept:'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',Origin:base,Referer:referer,
      ...(body != null ? {'Content-Type':'application/x-www-form-urlencoded'} : {})}});
    if (typeof response.body !== 'string' || !response.body.trim()) {
      if (json) return null;
      throw Object.assign(Error('Empty Pururin response.'),{code:'invalid_response',phase:'http'});
    }
    if (!json) return response;
    try { return JSON.parse(response.body); } catch { throw parseError('Pururin tag payload is invalid.'); }
  }
  async function html(url,projection) { const response = await request(url); return ctx.html.extract(response.body,{...projection,baseUrl:response.url ?? url}); }
  const listing = async url => parseListing(await html(url,listingProjection));
  async function searchTag(query,taxonomy) {
    const payload = await request(`${base}/api/get/tags/search`,{method:'POST',body:new URLSearchParams({text:query}).toString(),referer:`${base}/tags/${taxonomy}/`,json:true});
    if (!Array.isArray(payload)) return null;
    const item = payload.find(value => normalizeText(record(value).name).toLowerCase().includes(query.toLowerCase()));
    return item ? {id:Number.parseInt(String(item.id),10) || 0,name:String(item.name ?? '').trim(),taxonomy} : null;
  }
  return {
    async getFilters() { return buildFilters(); },
    async getPopular({page = 1} = {}) { return listing(urlWithQuery('/browse',base,{sort:'most-popular',page:Math.max(1,page)})); },
    async getLatest({page = 1} = {}) { return listing(urlWithQuery('/browse',base,{page:Math.max(1,page)})); },
    async search({searchTerm = '',page = 1,selectedFilters = {}} = {}) {
      const included = [], excluded = [], sort = string(selectedFilters.sort?.[0]) ?? 'newest', range = pageRange(selectedFilters.pages?.[0] ?? '');
      const selectedTypes = new Set(selectedFilters.types ?? []);
      if (selectedTypes.size) for (const [id,name] of legacyTypes) if (!selectedTypes.has(id)) excluded.push({id:Number(id),name,taxonomy:'category'});
      for (const [key,taxonomy] of fields) for (const raw of (selectedFilters[key]?.[0] ?? '').split(',').map(value => value.trim()).filter(Boolean)) {
        const exclude = raw.startsWith('-'), query = exclude ? raw.slice(1).trim() : raw;
        if (!query) continue;
        const tag = await searchTag(query,taxonomy); if (tag) (exclude ? excluded : included).push(tag);
      }
      const params = {sort,start_page:range[0],last_page:range[1],...(page > 1 ? {page} : {})};
      if (!searchTerm.trim() && included.length === 1 && !excluded.length && sort) {
        const tag = included[0]; return listing(urlWithQuery(`/browse/tags/${tag.taxonomy}/${tag.id}/${encodeURIComponent(tag.name)}`,base,params));
      }
      return listing(urlWithQuery('/search',base,{q:searchTerm.trim(),...params,
        ...(included.length ? {included_tags:JSON.stringify(included.map(({id,name}) => ({id,name})))} : {}),
        ...(excluded.length ? {excluded_tags:JSON.stringify(excluded.map(({id,name}) => ({id,name})))} : {})}));
    },
    async getDetails({mangaId:id}) { return parseDetails(await html(new URL(normalizePath(id),base).href,detailsProjection),id); },
    async getChapters({mangaId:id}) {
      const data = requireArray(await html(new URL(normalizePath(id),base).href,{selector:'.table-collection tbody tr a',all:true,fields:{href:{attr:'href'},title:{text:true}}}),'Pururin chapters');
      const chapters = data.map(value => { const row = requireRecord(value,'Pururin chapter'); return chapter({id:normalizePath(row.href ?? id),title:string(normalizeText(row.title)) ?? 'Chapter',number:1}); }).reverse();
      return chapters.length ? chapters : [chapter({id:normalizePath(id),title:'Chapter',number:1})];
    },
    async getPages({chapterId:id}) {
      const data = requireArray(await html(new URL(normalizePath(id),base).href,{selector:'.gallery-preview a img',all:true,fields:{lazy:{attr:'data-src'},src:{attr:'src'}}}),'Pururin pages');
      const pages = data.map(imageUrl).filter(Boolean).map((url,index) => ({index,imageUrl:url.replace('t.','.')}));
      if (!pages.length) throw parseError('Pururin pages were not found.');
      return pages;
    },
  };
}
