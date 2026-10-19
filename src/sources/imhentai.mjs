import {chapter,filter,manga,normalizeText,parseError,record,string} from '../core/data.mjs';
import {requireArray,requireRecord} from '../core/http.mjs';

const categories = [['m','Manga'],['d','Doujinshi'],['w','Western'],['i','Image Set'],['a','Artist CG'],['g','Game CG']];
const languages = [['en','English'],['jp','Japanese'],['es','Spanish'],['fr','French'],['kr','Korean'],['de','German'],['ru','Russian']];
const languageSlugs = {en:'english',jp:'japanese',es:'spanish',fr:'french',kr:'korean',de:'german',ru:'russian'};
const sorts = {latest:'lt',popular:'pp',downloaded:'dl','top-rated':'tr'};
const advancedFields = [['tags','tag','Tags'],['parodies','parody','Parodies'],['artists','artist','Artists'],['characters','character','Characters'],['groups','group','Groups']];
export const defaultLanguages = edition => edition === 'all' ? languages.map(([key]) => key) : [edition];
export function buildFilters(edition) {
  return [filter('sort','sort','Sort',[['latest','Latest'],['popular','Popular'],['downloaded','Downloaded'],['top-rated','Top rated']]),
    filter('multiSelect','category','Categories',categories),
    {...filter('multiSelect','language','Languages',languages,defaultLanguages(edition)),caption:'Filter the mixed catalog by the gallery language.'},
    ...advancedFields.map(([key,,label]) => ({...filter('text',key,label),caption:'Separate terms with commas. Prefix a term with "-" to exclude it.'})),
    {...filter('toggle','speechless','Speechless only'),caption:'Browse speechless galleries without spoken text.'},
    {...filter('toggle','random','Random gallery'),caption:'Open one random title instead of the normal listing.'}];
}
const term = value => value.trim().replace(/\s+/gu,'+').replaceAll(' ','');
// The site treats literal '+' and ',' as search delimiters, not escaped data.
const encodeTerm = value => encodeURIComponent(value).replace(/[!'()*]/gu,char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`).replaceAll('%2B','+').replaceAll('%2C',',');
const makeUrl = (base,path,params = {}) => {
  const url = new URL(path,base); url.search = ''; url.hash = '';
  const query = Object.entries(params).map(([key,value]) => `${key}=${value}`).join('&');
  return `${url.href}${query ? `?${query}` : ''}`;
};
export function listingUrl(base,edition,{page = 1,popular = false,language = null} = {}) {
  const slug = language ?? languageSlugs[edition];
  return makeUrl(base,`${slug ? `/language/${slug}` : ''}${popular ? '/popular' : ''}/`,page > 1 ? {page:String(page)} : {});
}
function parseTerms(raw) {
  const included = [], excluded = [];
  for (const value of raw.split(',').map(value => value.trim()).filter(Boolean)) {
    if (value.startsWith('-')) { const item = value.slice(1).trim(); if (item) excluded.push(item); }
    else included.push(value);
  }
  return {included,excluded};
}
export function searchUrl(base,edition,{searchTerm = '',page = 1,selectedFilters = {}} = {}) {
  if (selectedFilters.random?.includes('true')) return makeUrl(base,'/random/');
  const sort = selectedFilters.sort?.[0];
  if (selectedFilters.speechless?.includes('true')) return makeUrl(base,
    `/language/speechless/${sort === 'popular' ? 'popular/' : ''}`,page > 1 ? {page:String(page)} : {});
  const selected = selectedFilters.language ?? defaultLanguages(edition);
  const valid = [...new Set(selected.filter(value => Object.hasOwn(languageSlugs,value)))];
  const enabledLanguages = selected.includes('all') || valid.length === languages.length ? null : valid;
  if (enabledLanguages?.length === 0) return null;
  const selectedCategories = new Set(selectedFilters.category ?? []);
  const fields = advancedFields.map(([key,field]) => [field,parseTerms(selectedFilters[key]?.[0]?.trim() ?? '')]);
  const advanced = fields.some(([,terms]) => terms.included.length || terms.excluded.length);
  if (!searchTerm.trim() && !selectedCategories.size && !advanced && (sort == null || sort === 'latest' || sort === 'popular') &&
      (enabledLanguages == null || enabledLanguages.length === 1) && (enabledLanguages != null || edition === 'all')) {
    return listingUrl(base,edition,{page,popular:sort === 'popular',language:enabledLanguages?.length === 1 ? languageSlugs[enabledLanguages[0]] : null});
  }
  const params = {};
  if (advanced) {
    params.key = fields.flatMap(([field,terms]) => [
      ...terms.included.map(value => `%2B${field}:%22${encodeTerm(term(value))}%22`),
      ...terms.excluded.map(value => `-${field}:%22${encodeTerm(term(value))}%22`),
    ]).join('+');
  } else {
    const query = searchTerm.split(',').map(term).filter(Boolean).join(',');
    if (query) { params.key = encodeTerm(query); params.apply = 'Search'; }
  }
  if (page > 1) params.page = String(page);
  for (const [value,key] of Object.entries(sorts)) params[key] = value === (sort ?? 'latest') ? '1' : '0';
  for (const [key] of categories) params[key] = !selectedCategories.size || selectedCategories.has(key) ? '1' : '0';
  for (const [key] of languages) params[key] = enabledLanguages == null || enabledLanguages.includes(key) ? '1' : '0';
  return makeUrl(base,advanced ? '/advsearch/' : '/search/',params);
}
const rawText = {text:true,normalizeWhitespace:false};
const imageProjection = selector => ({selector,fields:{lazy:{attr:'data-src'},src:{attr:'src'}}});
const tileFields = {link:{selector:'.gallery_title a, .caption a',fields:{href:{attr:'href'},title:rawText}},
  cover:imageProjection('.inner_thumb img'),flag:imageProjection('img.thumb_flag'),type:{selector:'.thumb_cat',...rawText}};
export const listingProjection = {selector:'.galleries .thumb, .thumbs_container .thumb',all:true,fields:tileFields};
export const detailsProjection = {fields:{root:{selector:'.gallery_first',fields:{
  title:{selector:'h1',...rawText},subtitle:{selector:'p.subtitle',...rawText},cover:imageProjection('.left_cover img'),
  rows:{selector:'.galleries_info li',all:true,fields:{label:{selector:'.tags_text',...rawText},
    values:{selector:'a.tag',all:true,text:true,exclude:'.badge, .rborder'}}}}},
  pageCount:{selector:'#load_pages',attr:'value'},canonical:{selector:'link[rel=canonical]',attr:'href'},og:{selector:'meta[property="og:url"]',attr:'content'}}};
const galleryId = value => typeof value === 'string' ? value.match(/\/gallery\/(\d+)\//u)?.[1] ?? null : null;
function imageUrl(input,base) {
  if (input == null) return null;
  const row = requireRecord(input,'IMHentai image'), lazy = string(row.lazy), src = string(row.src);
  const raw = lazy ?? (src?.startsWith('data:image/') ? null : src);
  return raw ? new URL(raw,base).href : null;
}
export function parseListing(input,base) {
  const items = [];
  for (const value of requireArray(input,'IMHentai listing')) {
    const row = requireRecord(value,'IMHentai card'), link = record(row.link), id = galleryId(link.href), title = string(link.title);
    if (!id || !title) continue; // Ad/empty tiles are not galleries.
    items.push(manga({id,title,coverUrl:imageUrl(row.cover,base),languageFlagUrl:imageUrl(row.flag,base),type:row.type ?? null}));
  }
  return items;
}
export function parseDetails(input,id,base,{random = false} = {}) {
  const page = requireRecord(input,'IMHentai gallery'), root = requireRecord(page.root,'IMHentai details root'), title = string(root.title);
  if (!title) throw parseError('IMHentai title is missing.');
  const common = {id,title,secondaryTitle:root.subtitle ?? null,coverUrl:imageUrl(root.cover,base)};
  if (random) {
    common.id = galleryId(page.canonical ?? page.og);
    if (!common.id) throw parseError('IMHentai random gallery id is missing.');
    return manga(common);
  }
  const details = {};
  for (const value of requireArray(root.rows,'IMHentai metadata')) {
    const row = requireRecord(value,'IMHentai metadata row'), label = (row.label ?? '').trim().replaceAll(':','');
    const values = requireArray(row.values,'IMHentai metadata values').map(normalizeText).filter(Boolean);
    if (label && values.length) details[label] = values;
  }
  const count = typeof page.pageCount === 'string' && /^[+-]?\d+$/u.test(page.pageCount.trim()) ? Number(page.pageCount) : null;
  const sections = [root.subtitle || null,count == null ? null : `Pages: ${count}`,
    ...['Parodies','Characters','Languages','Category'].map(key => details[key]?.length ? `${key}: ${details[key].join(', ')}` : null)].filter(Boolean);
  return manga({...common,description:sections.join('\n\n') || null,pageCount:count,author:(details.Groups ?? details.Artists)?.join(', ') ?? null,
    artist:details.Artists?.join(', ') ?? null,type:details.Category?.[0] ?? null,tags:details.Tags ?? []});
}
export const pagesProjection = {fields:{image:{selector:'#gimg',attr:'src'},dir:{selector:'#image_dir',attr:'value'},
  token:{selector:'#gallery_id',attr:'value'},scripts:{selector:'script',all:true,...rawText}}};
export function parsePages(input,base) {
  const data = requireRecord(input,'IMHentai reader'), image = string(data.image), dir = string(data.dir), token = string(data.token);
  const script = requireArray(data.scripts,'IMHentai reader scripts').join('\n');
  const match = script.match(/var\s+g_th\s*=\s*\$\.parseJSON\('(\{.*?\})'\);/su);
  let map; try { map = match ? JSON.parse(match[1]) : null; } catch { throw parseError('IMHentai page map is invalid.'); }
  const entries = Object.entries(requireRecord(map,'IMHentai page map'));
  if (!image || !dir || !token || !entries.length || entries.some(([key]) => !/^\d+$/u.test(key))) throw parseError('IMHentai page map is incomplete.');
  const origin = new URL(image,base), host = origin.hostname;
  return entries.sort(([a],[b]) => Number(a)-Number(b)).map(([key,value]) => {
    const extension = {j:'jpg',p:'png',g:'gif',w:'webp'}[String(value).split(',')[0].trim().toLowerCase()] ?? 'jpg';
    return {index:Number(key)-1,imageUrl:new URL(`/${dir}/${token}/${Number(key)}.${extension}`,`${origin.protocol}//${host}`).href};
  });
}
export default function createIMHentai(ctx) {
  const edition = ctx.sourceId.split('.')[0];
  if (!['all','en','ru'].includes(edition)) throw parseError('Unknown IMHentai edition.');
  const base = async () => string(record(await ctx.settings.get('network')).customBaseUrl) ?? ctx.baseUrl;
  async function html(url,projection) {
    const response = await ctx.http.request({method:'GET',url,responseType:'text',headers:{Accept:'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'}});
    if (typeof response.body !== 'string' || !response.body.trim()) throw Object.assign(Error('Empty IMHentai response.'),{code:'invalid_response',phase:'http'});
    if (response.body.includes('Overload... Please use the advanced search')) throw Object.assign(Error('IMHentai is overloaded.'),{code:'rate_limited',phase:'http'});
    return ctx.html.extract(response.body,{...projection,baseUrl:response.url ?? url});
  }
  return {
    async getFilters() { return buildFilters(edition); },
    async getPopular({page = 1} = {}) { const url = await base(); return parseListing(await html(listingUrl(url,edition,{page,popular:true}),listingProjection),url); },
    async getLatest({page = 1} = {}) { const url = await base(); return parseListing(await html(listingUrl(url,edition,{page}),listingProjection),url); },
    async search(query) {
      const url = await base(), target = searchUrl(url,edition,query);
      if (target == null) return [];
      if (query.selectedFilters?.random?.includes('true')) return [parseDetails(await html(target,detailsProjection),'',url,{random:true})];
      return parseListing(await html(target,listingProjection),url);
    },
    async getDetails({mangaId:id}) { const url = await base(); return parseDetails(await html(makeUrl(url,`/gallery/${id}/`),detailsProjection),id,url); },
    async getChapters({mangaId:id}) { const details = await this.getDetails({mangaId:id}); return [chapter({id:`gallery:${id}`,title:string(details.type) ?? 'Gallery',number:1})]; },
    async getPages({mangaId:id}) { const url = await base(); return parsePages(await html(makeUrl(url,`/view/${id}/1/`),pagesProjection),url); },
    async getRecommendations({mangaId:id,page = 1}) {
      const url = await base(), normalized = Math.max(1,page);
      return {items:normalized > 1 ? [] : parseListing(await html(makeUrl(url,`/gallery/${id}/`),{selector:'.row.related .thumb',all:true,fields:tileFields}),url).filter(item => item.id !== id),
        page:normalized,hasNextPage:false};
    },
  };
}
