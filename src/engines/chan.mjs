import {chapter,filter,isoDate,manga,normalizeText,parseError,record,string} from '../core/data.mjs';
import {requireArray,requireRecord,urlWithQuery} from '../core/http.mjs';
import {hChanTags,mangaChanTags} from './chan-tags.mjs';
const text = selector => ({selector,text:true});
const link = selector => ({selector,fields:{href:{attr:'href'},title:{attr:'title'},text:{text:true}}});
const imageFields = {src:{attr:'src'},lazy:{attr:'data-src'},original:{attr:'data-original'},srcset:{attr:'srcset'},
  parent:{ascend:1,fields:{href:{attr:'href'},srcset:{selector:'source',attr:'srcset'}}}};
const image = selector => ({selector,fields:imageFields});
export function buildFilters(hchan = false) {
  if (hchan) return [filter('triStateMultiSelect','tags','Тэги',hChanTags)];
  return [filter('singleSelect','status','Статус',[['','Все'],['all_done','Перевод завершен'],['end','Выпуск завершен'],['ongoing','Онгоинг'],['new_ch','Новые главы']]),
    filter('sort','sort','Сортировка',[['date','Дата'],['popularity','Популярность'],['name','Имя'],['chapters','Главы']]),
    filter('triStateMultiSelect','genres','Тэги',mangaChanTags)];
}
function tagTokens(values = [],trim = true) {
  return values.flatMap(value => {
    const prefix = value.startsWith('include:') ? '' : value.startsWith('exclude:') ? '-' : null;
    if (prefix == null) return [];
    const raw = value.slice(value.indexOf(':')+1), term = trim ? raw.trim() : raw;
    return term ? [`${prefix}${term}`] : [];
  });
}
export function searchUrl(base,{searchTerm = '',page = 1,selectedFilters = {}} = {},hchan = false) {
  if (searchTerm.trim()) return urlWithQuery('/index.php',base,{do:'search',subaction:'search',story:searchTerm.trim(),search_start:Math.max(1,page)});
  const offset = String(20*(Math.max(1,page)-1)), tags = tagTokens(selectedFilters[hchan ? 'tags' : 'genres'],!hchan);
  if (hchan) return urlWithQuery(tags.length ? `/tags/${tags.join('+')}` : '/manga/newest',base,{offset});
  const status = selectedFilters.status?.[0] ?? '', field = selectedFilters.sort?.[0] ?? 'popularity', ascending = selectedFilters.sort?.[1] === 'asc', statusPath = ascending && field === 'date';
  const order = ascending ? {date:'',name:'&n=abcdesc',chapters:'&n=chasc'}[field] ?? '&n=favasc' : {date:'&n=dateasc',name:'&n=abcasc',chapters:'&n=chdesc'}[field] ?? '&n=favdesc';
  if (tags.length) return urlWithQuery(`/tags/${statusPath && status.trim() ? `${status.trim()}/` : ''}${tags.join('+')}/${order}`,base,{offset,...(!statusPath ? {status} : {})});
  const path = ascending ? {date:'manga/new',name:'manga/new&n=abcdesc',chapters:'manga/new&n=chasc'}[field] ?? 'manga/new&n=favasc'
    : {date:'manga/new&n=dateasc',name:'catalog',chapters:'sortch'}[field] ?? 'mostfavorites';
  return urlWithQuery(`/${path}${statusPath ? `/${status.trim()}` : ''}`,base,{offset,...(!statusPath ? {status} : {})});
}
export function normalizeId(raw,base,{hchan = false,chapter = false} = {}) {
  if (!string(raw)) return null;
  const url = new URL(raw.trim(),base), path = decodeURI(url.pathname);
  if (!path || path === '/') return null;
  if (hchan && !(chapter ? /^\/online\/\d+-.+\.html$/iu : /^\/manga\/\d+-.+\.html$/iu).test(path)) return null;
  return `${path}${hchan && chapter ? url.search : ''}`;
}
function resolve(raw,base,hchan) { const value = string(raw); return !value || hchan && value.startsWith('data:image/') ? null : new URL(value,base).href; }
export function coverUrl(input,base,hchan = false) {
  const row = record(input); if (!hchan) return resolve(row.src,base,false);
  const parent = record(row.parent), parentHref = typeof parent.href === 'string' && /\.(?:avif|gif|jpe?g|png|webp)(?:\?|$)/iu.test(parent.href) ? parent.href : null;
  const srcset = row.srcset ?? parent.srcset, largest = srcset?.split(',').map(value => value.trim().split(/\s+/u)[0]).filter(Boolean).at(-1);
  for (const candidate of [parentHref,row.original,row.lazy,largest,row.src]) { const url = resolve(candidate,base,true); if (url) return url.replaceAll('/manganew_thumbs/','/manganew/'); }
  return null;
}
const listingProjection = {selector:'div.content_row',all:true,fields:{title:{attr:'title'},heading:link('h2 a'),titleLink:link('a.title_link[href*="/manga/"]'),fallback:link('a[href]'),
  hHeading:link('h2 a[href*="/manga/"]'),hFallback:link('a[href*="/manga/"]'),image:image('img'),authors:{selector:'a[href^="/mangaka/"]',all:true,text:true},tags:{selector:'.genre a[href^="/tags/"]',all:true,text:true}}};
export function parseListing(input,base,hchan = false) {
  const result = [], seen = new Set();
  for (const value of requireArray(input,'Chan catalog')) {
    const row = requireRecord(value,'Chan card'), anchor = record(hchan ? row.hHeading ?? row.titleLink ?? row.hFallback : row.heading ?? row.fallback);
    const id = normalizeId(anchor.href,base,{hchan}), title = string(normalizeText(row.title)) ?? string(normalizeText(anchor.text));
    if (!id || !title || seen.has(id)) continue; seen.add(id);
    const author = hchan ? row.authors.map(normalizeText).find(Boolean) ?? null : null;
    result.push(manga({id,title,coverUrl:coverUrl(row.image,base,hchan),...(hchan ? {author,artist:author,type:'Манга',ageRating:'NSFW',tags:row.tags.map(normalizeText).filter(Boolean)} : {})}));
  }
  return result;
}
const detailsProjection = {fields:{title:text('div.name_row h1 a'),hTitle:text('.title_top_a'),h1:text('h1'),pageTitle:text('title'),
  cover:image('#cover'),fallbackCover:image('.poster img, .cover img'),description:text('#description'),
  tags:{selector:'#info_wrap td.item2 a[href*="/tags/"]',all:true,text:true},hTags:{selector:'.sidetag a[href^="/tags/"]',all:true,fields:{text:{text:true},href:{attr:'href'}}},
  authors:{selector:'a[href^="/mangaka/"]',all:true,text:true},text:{text:true},rows:{selector:'#info_wrap tr',all:true,fields:{key:text('td.item'),value:text('td.item2')}}}};
export function parseDetails(input,id,base,hchan = false) {
  const data = requireRecord(input,'Chan details'), title = hchan ? string(normalizeText(data.hTitle)) ?? string(normalizeText(data.h1)) ?? string(normalizeText(data.pageTitle).replace(/\s*».*$/u,''))
    : string(normalizeText(data.title)) ?? string(normalizeText(data.pageTitle).replace(/\s*».*$/u,''));
  if (!title) throw parseError('Chan title is missing.');
  if (hchan) {
    const author = data.authors.map(normalizeText).find(Boolean) ?? null, seen = new Set();
    const tags = data.hTags.flatMap(row => { const text = normalizeText(row.text); if (!text || ['+','-'].includes(text) || row.href?.includes('/tags/-') || seen.has(text)) return []; seen.add(text); return [text]; });
    return manga({id:normalizeId(id,base,{hchan}) ?? id,title,coverUrl:coverUrl(data.cover ?? data.fallbackCover,base,true),description:string(normalizeText(data.description)),author,artist:author,
      type:'Манга',ageRating:'NSFW',pageCount:Number(data.text?.match(/(\d+)\s*(?:стр|страниц|страницы)/iu)?.[1]) || null,tags});
  }
  const info = label => data.rows.map(row => ({key:normalizeText(row.key).toLowerCase(),value:string(normalizeText(row.value))})).find(row => row.key.includes(label.toLowerCase()) && row.value)?.value ?? null;
  const status = info('Загружено') ?? info('Статус'), normalized = status?.toLowerCase() ?? '';
  return manga({id:normalizeId(id,base) ?? id,title,secondaryTitle:info('Другие названия')?.replaceAll(';',', ') ?? null,description:string(normalizeText(data.description)),coverUrl:coverUrl(data.cover,base),author:info('Автор'),type:info('Тип'),
    status:normalized.includes('заверш') ? 'completed' : normalized.includes('продолжа') || normalized.includes('новые главы') ? 'ongoing' : status,tags:data.tags.map(normalizeText).filter(Boolean)});
}
const recommendationsProjection = {fields:{items:{selector:'div.related',all:true,fields:{link:link('.related_info h2 a[href*="/manga/"], .related_cover a[href*="/manga/"]'),image:image('.related_cover img'),
  author:text('a[href*="/mangaka/"]'),tags:{selector:'.genre a[href*="/tags/"]',all:true,text:true}}},next:{selector:'a[href*="offset="]',all:true,attr:'href'}}};
export function parsePages(body,base,hchan = false) {
  const match = body.match(hchan ? /(?:["']?fullimg["']?\s*[:=]\s*)\[(.*?)\]/isu : /"fullimg"\s*:\s*\[(.*?)\]/su);
  if (!match) throw parseError('Chan reader payload is missing.');
  const urls = [...match[1].matchAll(hchan ? /['"]([^'"]+)['"]/gu : /"([^"]+)"/gu)].map(match => {
    let value = match[1]; if (hchan) { try { value = JSON.parse(`["${value.replaceAll('"','\\"')}"]`)[0]; } catch { value = value.replaceAll('\\/','/').replaceAll('\\u002F','/').replaceAll('\\u002f','/'); } }
    return resolve(value,base,hchan);
  }).filter(Boolean);
  if (!urls.length) throw parseError('Chan reader pages are empty.');
  return urls.map((imageUrl,index) => ({index,imageUrl}));
}
export default function createChan(ctx) {
  const hchan = ctx.sourceId === 'ru.hchan';
  const base = async () => hchan ? string(record(await ctx.settings.get('network')).customBaseUrl) ?? ctx.baseUrl : ctx.baseUrl;
  async function body(url) {
    const origin = new URL(url).origin, response = await ctx.http.request({method:'GET',url,responseType:'text',userAgentProfile:hchan ? 'app' : 'browser',headers:{Accept:'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',Referer:`${origin}/`,...(!hchan ? {Origin:origin} : {})}});
    if (typeof response.body !== 'string' || !response.body.trim()) throw Object.assign(Error('Empty Chan response.'),{code:'invalid_response',phase:'http'});
    return response.body;
  }
  const html = async (url,projection) => ctx.html.extract(await body(url),{...projection,baseUrl:url});
  const browse = async (path,page,params = {}) => { const origin = await base(); return parseListing(await html(urlWithQuery(path,origin,{offset:20*(Math.max(1,page)-1),...params}),listingProjection),origin,hchan); };
  return {
    async getFilters() { return buildFilters(hchan); },
    async getPopular({page = 1} = {}) { return browse(hchan ? '/manga/newest' : '/mostfavorites',page,hchan ? {} : {status:''}); },
    async getLatest({page = 1} = {}) { return browse(hchan ? '/manga/newest' : '/manga/new',page,hchan ? {} : {status:''}); },
    async search(query) { const origin = await base(); return parseListing(await html(searchUrl(origin,query,hchan),listingProjection),origin,hchan); },
    async getDetails({mangaId:id}) { const origin = await base(), normalized = normalizeId(id,origin,{hchan}); if (hchan && !normalized) throw parseError('H-chan manga id is invalid.');
      return parseDetails(await html(new URL(normalized ?? '/',origin).href,detailsProjection),id,origin,hchan); },
    async getChapters({mangaId:id}) {
      const origin = await base(), normalized = normalizeId(id,origin,{hchan}); if (hchan && !normalized) return [];
      const data = await html(new URL(normalized ?? '/',origin).href,hchan ? link('a[href*="/online/"]') : {selector:'table.table_cha tr',all:true,fields:{link:link('a[href*="/online/"]'),date:text('div.date')}});
      if (hchan) { const row = record(data), chapterId = normalizeId(row.href,origin,{hchan,chapter:true}); if (!chapterId) throw parseError('H-chan reader link is missing.'); return [chapter({id:chapterId,title:string(normalizeText(row.title)) ?? 'Читать онлайн',number:1})]; }
      const seen = new Set(); return requireArray(data,'MangaChan chapters').flatMap(row => {
        const anchor = record(row.link), chapterId = normalizeId(anchor.href,origin), title = string(normalizeText(anchor.text));
        if (!chapterId || !title || seen.has(chapterId)) return []; seen.add(chapterId);
        return [chapter({id:chapterId,title,number:Number(title.match(/(?:глава|часть)\s*([0-9]+(?:\.[0-9]+)?)/iu)?.[1] ?? -1),uploadedAt:isoDate(row.date)})];
      });
    },
    async getPages({chapterId:id}) { const origin = await base(), normalized = normalizeId(id,origin,{hchan,chapter:true}); if (hchan && !normalized) throw parseError('H-chan chapter id is invalid.'); return parsePages(await body(new URL(normalized ?? id,origin).href),origin,hchan); },
    async getRecommendations({mangaId:id,page = 1}) {
      const origin = await base(), normalized = Math.max(1,page), path = normalizeId(id,origin,{hchan}), offset = 10*(normalized-1);
      if (hchan && !path) return {items:[],page:normalized,hasNextPage:false};
      const related = (path ?? id).replace('/manga/','/related/'), data = requireRecord(await html(urlWithQuery(related,origin,offset ? {offset} : {}),recommendationsProjection),'Chan recommendations'), seen = new Set(), items = [];
      for (const row of requireArray(data.items,'Chan related items')) {
        const anchor = record(row.link), itemId = normalizeId(anchor.href,origin,{hchan}), title = normalizeText(anchor.title ?? anchor.text);
        if (!itemId || itemId === id || !title || seen.has(itemId)) continue; seen.add(itemId);
        const author = string(normalizeText(row.author)), raw = string(record(row.image).src), image = resolve(raw,origin,hchan);
        items.push(manga({id:itemId,title,coverUrl:hchan ? image?.replaceAll('/manganew_thumbs/','/manganew/') ?? null : image,author,
          ...(hchan ? {artist:author,type:'Manga',ageRating:'NSFW'} : {}),tags:row.tags.map(normalizeText).filter(Boolean)}));
      }
      return {items,page:normalized,hasNextPage:requireArray(data.next,'Chan recommendation pagination').some(href => new URL(href,origin).searchParams.get('offset') === String(offset+10))};
    },
  };
}
