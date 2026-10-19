import {chapter,manga,normalizeText,parseError,record,string} from '../core/data.mjs';
import {finiteNumber,requireArray,requireRecord,urlWithQuery} from '../core/http.mjs';
import {fallbackSort,filterProjection,parseFilters,searchParameters} from './grouple-filters.mjs';
import {detailsProjection,parseDetails} from './grouple-details.mjs';

const titleProjection = {selector:'.names > .name, .cr-hero-names__main',text:true};
export const chaptersProjection = {fields:{title:titleProjection,
  selected:{selector:'.translator-selection-item.selected.best-choice[id^="tr-"]',fields:{id:{attr:'id'},name:{selector:'.translator-selection-name',text:true,normalizeWhitespace:false}}},
  rows:{selector:'tr.item-row',all:true,fields:{link:{selector:'a.chapter-link',fields:{href:{attr:'href'},title:{text:true},scanlator:{attr:'title'},translations:{attr:'data-translations'}}},
    fallback:{selector:'td.item-title',text:true},number:{selector:'td.item-title',attr:'data-num'},dates:{selector:'td.d-none, td.date',all:true,text:true}}}}};
const stableId = (value,base) => new URL(value,base).pathname;
const galleryId = (value,base) => { const path = stableId(value,base).trim().replace(/^\/+|\/+$/gu,''); return path || null; };
export function parseCatalog(input,base) {
  const payload = requireRecord(input,'GroupLe catalog'), items = payload.list ?? payload.results ?? record(payload.data).list;
  if (!Array.isArray(items)) return [];
  return items.flatMap(value => {
    const row = record(value), id = row.elementId && string(String(record(row.elementId).linkName ?? '')), title = normalizeText(String(row.name ?? ''));
    if (!id || !title) return [];
    const raw = string(row.picUrl == null ? null : String(row.picUrl));
    return [manga({id,title,coverUrl:raw ? new URL(raw,base).href : null})];
  });
}
function chapterDate(values) {
  for (const raw of values) {
    const match = normalizeText(raw).match(/^(\d{2})[./](\d{2})[./](\d{2,4})$/u);
    if (!match) continue;
    let year = Number(match[3]); if (year < 100) year += 2000;
    return new Date(year,Number(match[2])-1,Number(match[1])).toISOString();
  }
  return null;
}
export function parseChapters(input,base,{readManga = false,requiresAuthorization = false} = {}) {
  const root = requireRecord(input,'GroupLe chapters'), title = normalizeText(root.title), selected = record(root.selected);
  const rows = requireArray(root.rows,'GroupLe chapter rows').filter(row => row.link != null);
  if (!rows.length && requiresAuthorization) throw Object.assign(Error('GroupLe login is required.'),{code:'auth_required',phase:'parse'});
  return rows.map(value => {
    const row = requireRecord(value,'GroupLe chapter row'), link = requireRecord(row.link,'GroupLe chapter link'), href = string(link.href);
    if (!href) throw parseError('GroupLe chapter link is missing.');
    let name = normalizeText(link.title).replace(/\s+новое$/iu,'');
    if (title && name.startsWith(title)) name = name.slice(title.length).trim();
    if (!name) name = normalizeText(row.fallback) || 'Chapter';
    let scanlator = normalizeText(link.scanlator).replaceAll('(Переводчик),','&').replaceAll(' (Переводчик)','').trim();
    const translatorId = string(selected.id)?.replace(/^tr-/u,'').trim(), translatorName = string(selected.name);
    if (readManga && translatorId && translatorName && typeof link.translations === 'string') {
      const ids = [...link.translations.replaceAll('&quot;','"').matchAll(/"(?:personId|secondPersonId)"\s*:\s*(\d+)/gu)].map(match => match[1]);
      if (ids.includes(translatorId)) scanlator = translatorName;
    }
    const number = string(normalizeText(row.number));
    return chapter({id:stableId(href,base),title:scanlator ? `${name} - ${scanlator}` : name,
      number:number != null && Number.isFinite(Number(number)) ? Number(number)/10 : finiteNumber(normalizeText(link.title).match(/(\d+(?:\.\d+)?)/u)?.[1]),
      uploadedAt:chapterDate(requireArray(row.dates,'GroupLe chapter dates'))});
  });
}
export function parseReader(body,base) {
  let marker = -1;
  for (const value of ['rm_h.readerInit(','rm_h.readerDoInit(']) { marker = body.indexOf(value); if (marker !== -1) break; }
  if (marker === -1) return [];
  const end = body.indexOf(');',marker); if (end === -1) return [];
  const result = [];
  for (const match of body.slice(marker,end).matchAll(/'[^']*','[^']*',"[^"]*"/gmu)) {
    const [first,second,third] = match[0].replace(/["']/gu,'').split(',');
    let url = !second && third.startsWith('/static/') ? `${new URL(base).origin}${third}` : second.endsWith('/manga/') ? `${first}${third}` : `${second}${first}${third}`;
    if (!url.includes('://')) url = `https:${url}`;
    if (url.includes('one-way.work')) url = url.split('?')[0];
    result.push({index:result.length,imageUrl:url.replaceAll('//resh','//h')});
  }
  return result;
}
const recommendationsProjection = {selector:'.ui-section',all:true,fields:{like:{selector:'a[href*="/list/like/"]',attr:'href'},
  cards:{selector:'.similar-item-card a.entity-card-tile, a.entity-card-tile',all:true,fields:{href:{attr:'href'},title:{selector:'.entity-card-tile__title',text:true},
    image:{selector:'img',fields:{alt:{attr:'alt'},lazy:{attr:'data-src'},src:{attr:'src'}}},type:{selector:'.entity-card-tile__subtitle span',text:true},rating:{selector:'app-user-rating-value span',text:true}}}}};
const readerInfoProjection = {fields:{avatar:{selector:'.user-avatar',text:true},title:{selector:'title',text:true},content:{selector:'body',text:true},
  hero:{selector:'.cr-hero-names__main',text:true}}};
export default function createGrouple(ctx) {
  const requiresAuthorization = ['ru.allhentai','ru.rumix','ru.mintmanga'].includes(ctx.sourceId), accepts404 = ctx.sourceId === 'ru.allhentai';
  const base = async () => string(record(await ctx.settings.get('network')).customBaseUrl) ?? ctx.baseUrl;
  async function response(url,{json = false,tags = false} = {}) {
    const origin = new URL(url).origin;
    try {
      const reply = await ctx.http.request({method:'GET',url,responseType:'text',userAgentProfile:'browser',headers:{
        Accept:json ? 'application/json, text/plain, */*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',Origin:origin,
        Referer:tags ? `${origin}/catalog` : `${origin}/`,...(tags ? {'X-Requested-With':'XMLHttpRequest'} : {})}});
      if (typeof reply.body !== 'string' || !reply.body.length) throw Object.assign(Error('GroupLe response is empty.'),{code:'invalid_response',phase:'http'});
      if (json) { try { return JSON.parse(reply.body); } catch { throw parseError('GroupLe JSON is invalid.'); } }
      return reply.body;
    } catch (error) {
      if (json || !accepts404 || error.httpStatus !== 404 || typeof error.body !== 'string') throw error;
      const info = await ctx.html.extract(error.body,{...readerInfoProjection,baseUrl:url}), title = normalizeText(info.title).toLowerCase();
      if (!title || title === '404 not found' || !(info.hero != null || /rm_h\.reader(?:Do)?Init\(/u.test(error.body) || title.includes('платный доступ'))) throw error;
      return error.body;
    }
  }
  const html = async (url,projection) => ctx.html.extract(await response(url),{...projection,baseUrl:url});
  const catalog = async query => { const origin = await base(); return parseCatalog(await response(urlWithQuery('/api/catalog/search',origin,query),{json:true}),origin); };
  return {
    async getFilters() {
      const origin = await base();
      let page;
      try { page = await html(new URL('/search/advanced',origin).href,filterProjection); }
      catch (error) { if (['cancelled','auth_session_changed','resource_limit','permission_denied'].includes(error.code)) throw error; return [fallbackSort()]; }
      let tags = [];
      try {
        const payload = await response(new URL('/api/catalog/elementsByType?type=40',origin).href,{json:true,tags:true});
        if (Array.isArray(record(payload).results)) tags = payload.results.map(value => [String(record(value).id ?? '').trim(),normalizeText(String(record(value).text ?? ''))]).filter(([id,label]) => id && label);
      } catch (error) { if (['cancelled','auth_session_changed','resource_limit','permission_denied'].includes(error.code)) throw error; }
      return parseFilters(page,tags);
    },
    async getPopular({page = 1} = {}) { return catalog(searchParameters({page},'RATING')); },
    async getLatest({page = 1} = {}) { return catalog(searchParameters({page},'DATE_UPDATE')); },
    async search(query) {
      const term = query.searchTerm?.trim() ?? '';
      if (term.startsWith('slug:')) { const id = term.slice(5).trim(); return id ? [await this.getDetails({mangaId:id})] : []; }
      return catalog(searchParameters(query));
    },
    async getDetails({mangaId:id}) {
      const origin = await base(), settings = record(await ctx.settings.get('libgroup'));
      return parseDetails(await html(new URL(id.startsWith('/') ? id : `/${id}`,origin).href,detailsProjection),id,origin,settings);
    },
    async getChapters({mangaId:id}) { const origin = await base(); return parseChapters(await html(new URL(id.startsWith('/') ? id : `/${id}`,origin).href,chaptersProjection),origin,
      {readManga:ctx.sourceId === 'ru.readmanga',requiresAuthorization}); },
    async getPages({mangaId:id,chapterId}) {
      const origin = await base(), url = new URL(chapterId,origin); url.search = ''; url.hash = '';
      let body;
      try {
        const details = await response(new URL(id.startsWith('/') ? id : `/${id}`,origin).href);
        const hash = details.match(/user_hash[^"'`]*['"`]([^'"`]+)['"`]/iu)?.[1]?.trim();
        url.search = hash ? `d=${hash}&mtr=true` : 'mtr=true'; body = await response(url.href);
      } catch (error) {
        if (!['network','offline','timeout','not_found','invalid_response'].includes(error.code)) throw error;
        url.search = ''; body = await response(url.href);
      }
      const info = requireRecord(await ctx.html.extract(body,{...readerInfoProjection,baseUrl:url.href}),'GroupLe reader metadata');
      if (requiresAuthorization && info.avatar == null) throw Object.assign(Error('GroupLe login is required.'),{code:'auth_required',phase:'parse'});
      const pages = parseReader(body,origin); if (pages.length) return pages;
      const title = normalizeText(info.title).toLowerCase(), content = normalizeText(info.content).toLowerCase();
      if (title.includes('платный доступ') || content.includes('платный доступ') && content.includes('купить подписку')) {
        throw Object.assign(Error('Premium access is required.'),{code:'chapter_unavailable',phase:'parse',access:{type:'paid',availableAt:null,priceLabel:null,message:'This chapter requires an active premium subscription on the source.'}});
      }
      if (requiresAuthorization) throw Object.assign(Error('GroupLe login is required.'),{code:'auth_required',phase:'parse'});
      if (body.includes('purchase-form') || body.includes('alert')) throw Object.assign(Error('Chapter is not publicly readable.'),{code:'chapter_unavailable',phase:'parse'});
      throw parseError('GroupLe reader payload was not found.');
    },
    async getRecommendations({mangaId:id,page = 1}) {
      const origin = await base(), normalized = Math.max(1,page), items = [], seen = new Set();
      if (normalized > 1) return {items,page:normalized,hasNextPage:false};
      const sections = requireArray(await html(new URL(id.startsWith('/') ? id : `/${id}`,origin).href,recommendationsProjection),'GroupLe recommendations');
      const section = sections.find(value => value.like != null);
      if (section) for (const row of requireArray(section.cards,'GroupLe recommendation cards')) {
        const itemId = row.href ? galleryId(row.href,origin) : null, image = record(row.image), title = normalizeText(row.title ?? image.alt);
        if (!itemId || itemId === id || !title || seen.has(itemId)) continue;
        seen.add(itemId); const raw = string(image.lazy ?? image.src);
        items.push(manga({id:itemId,title,coverUrl:raw ? new URL(raw,origin).href : null,type:string(normalizeText(row.type)),rating:string(normalizeText(row.rating)) ? finiteNumber(row.rating,null) : null}));
      }
      return {items,page:normalized,hasNextPage:false};
    },
  };
}
