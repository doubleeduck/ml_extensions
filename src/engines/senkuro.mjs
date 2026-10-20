import {chapter,compareText,filter,isoDate,manga,normalizeText,parseError,record,string} from '../core/data.mjs';
import {finiteNumber,requireArray,requireRecord} from '../core/http.mjs';

const types = {MANGA:'Manga',MANHWA:'Manhwa',MANHUA:'Manhua',COMICS:'Comics',OEL_MANGA:'OEL Manga',RU_MANGA:'RuManga'};
const formats = {DIGEST:'Digest',DOUJINSHI:'Doujinshi',IN_COLOR:'In color',SINGLE:'Single',WEB:'Web',WEBTOON:'Webtoon',YONKOMA:'Yonkoma',SHORT:'Short'};
const statuses = {ANNOUNCE:'Announced',ONGOING:'Ongoing',FINISHED:'Finished',HIATUS:'On hiatus',CANCELLED:'Cancelled'};
const translations = {IN_PROGRESS:'Translating',FINISHED:'Translated',FROZEN:'Frozen',ABANDONED:'Abandoned'};
const ages = {GENERAL:'0+',SENSITIVE:'12+',QUESTIONABLE:'16+',EXPLICIT:'18+'};
const sources = {ANIME:'Anime',COMIC:'Comic',DOUJINSHI:'Doujinshi',GAME:'Game',LIGHT_NOVEL:'Light novel',LIVE_ACTION:'Live action',MANGA:'Manga',NOVEL:'Novel',ORIGINAL:'Original work',OTHER:'Other',PICTURE_BOOK:'Picture book',VIDEO_GAME:'Video game',VISUAL_NOVEL:'Visual novel',WEB_NOVEL:'Web novel'};
const countries = {KR:'Korea',JP:'Japan',CN:'China',US:'United States',RU:'Russia',FR:'France'};
const roots = {'TEFCRUw6MQ':'Main cast','TEFCRUw6Mg':'Hentai themes','TEFCRUw6NQ':'Themes','TEFCRUw6NA':'Setting','TEFCRUw6Ng':'Elements','TEFCRUw6Mw':'Traits','TEFCRUw6Nw':'Demography'};
const sorts = [['POPULARITY_SCORE','Popularity'],['SCORE','Rating'],['CHAPTERS','Chapter count'],['VIEWS','Views'],['CREATED_AT','Date created'],['LAST_CHAPTER_AT','Latest upload']];
const list = value => Array.isArray(value) ? value : [];
const read = value => value == null ? '' : normalizeText(String(value));
const dedupe = values => { const seen = new Set(); return values.map(value => value.trim()).filter(value => { const key = value.toLowerCase(); if (!value || seen.has(key)) return false; seen.add(key); return true; }); };
export function localized(input,languages = ['RU','EN'],field = 'content') {
  const values = list(input).map(record);
  for (const language of languages) for (const value of values) if (read(value.lang).toUpperCase() === language && read(value[field])) return read(value[field]);
  return field === 'content' ? values.map(value => read(value[field])).find(Boolean) ?? '' : '';
}
export function buildFilters(labels,excludeAdult) {
  const groups = Object.fromEntries(Object.keys(roots).filter(key => !excludeAdult || key !== 'TEFCRUw6Mg').map(key => [key,[]]));
  for (const row of list(labels).map(record)) {
    const root = read(row.rootId), slug = read(row.slug), depth = Number.parseInt(read(row.depth),10) || 0, title = localized(row.titles);
    if (!Object.hasOwn(groups,root) || depth === 0 || !slug || !title || excludeAdult && (root === 'TEFCRUw6Mg' || slug === 'hentai')) continue;
    groups[root].push([slug,title]);
  }
  return [...Object.entries(groups).filter(([,values]) => values.length).map(([key,values]) => filter('triStateMultiSelect',`label.${key}`,roots[key],values.sort((a,b) => compareText(a[1],b[1])))),
    filter('sort','sort','Sort',sorts),...Object.entries({type:['Type',types],format:['Format',formats],status:['Status',statuses],translationStatus:['Translation status',translations],rating:['Age rating',ages]})
      .map(([key,[label,options]]) => filter('triStateMultiSelect',key,label,Object.entries(options))),
    ...[['chapters.min','Minimum chapters','20'],['chapters.max','Maximum chapters','100'],['releasedYear.min','Release year from','2000'],['releasedYear.max','Release year to','2026']]
      .map(([key,label,example]) => ({...filter('text',key,label),caption:`For example: ${example}`})),
    filter('triStateMultiSelect','source','Original source',Object.entries(sources)),filter('triStateMultiSelect','originCountry','Origin country',Object.entries(countries))];
}
const integer = value => typeof value === 'string' && /^[+-]?\d+$/u.test(value.trim()) ? Number(value.trim()) : null;
export function filterVariables(selected = {},excludeAdult = false) {
  const groups = {}, mapping = {type:'type',format:'format',status:'status',translationStatus:'translitionStatus',rating:'rating',source:'source',originCountry:'originCountry'};
  for (const [key,values] of Object.entries(selected)) {
    const param = key.startsWith('label.') ? 'label' : mapping[key]; if (!param) continue;
    const group = groups[param] ??= {include:new Set(),exclude:new Set()};
    for (const raw of values) { const value = raw.trim(), prefix = value.startsWith('include:') ? 'include' : value.startsWith('exclude:') ? 'exclude' : null;
      if (prefix) { const token = value.slice(prefix.length+1).trim(); if (token) group[prefix].add(token); } }
  }
  if (excludeAdult) (groups.label ??= {include:new Set(),exclude:new Set()}).exclude.add('hentai');
  const result = {};
  for (const [key,value] of Object.entries(groups)) {
    const filter = {}; if (value.include.size) filter.include = [...value.include].sort(compareText); if (value.exclude.size) filter.exclude = [...value.exclude].sort(compareText);
    if (Object.keys(filter).length) result[key] = filter;
  }
  for (const [prefix,param,date] of [['chapters','chapters',false],['releasedYear','releasedOn',true]]) {
    let start = integer(selected[`${prefix}.min`]?.[0]), end = integer(selected[`${prefix}.max`]?.[0]);
    if (date) { if (!(start >= 1 && start <= 9999)) start = null; if (!(end >= 1 && end <= 9999)) end = null; }
    if (start != null && end != null && start > end) [start,end] = [end,start];
    if (start != null || end != null) result[param] = {...(start != null ? {start:date ? `${start}-01-01` : start} : {}),...(end != null ? {end:date ? `${end}-01-01` : end} : {})};
  }
  const field = selected.sort?.[0]?.trim().toUpperCase();
  if (sorts.some(([key]) => key === field)) { result.orderField = field; result.orderDirection = selected.sort?.[1]?.trim().toLowerCase() === 'asc' ? 'ASC' : 'DESC'; }
  return result;
}
export function mapManga(input,{details = false} = {}) {
  const row = requireRecord(input,'Senkuro manga'), id = read(row.id), slug = read(row.slug), title = localized(row.titles) || read(record(row.originalName).content);
  if (!id || !slug || !title) throw parseError('Senkuro manga id/title is missing.');
  const alternatives = dedupe(list(row.alternativeNames).map(value => read(record(value).content))), secondary = [localized(row.titles,['EN','RU']),read(record(row.originalName).content),...alternatives].find(value => value && value !== title) ?? null;
  const result = manga({id:`${id},,${slug}`,title,secondaryTitle:secondary,coverUrl:string(read(record(record(row.cover).original).url))});
  if (!details) return result;
  const staff = role => dedupe(list(row.mainStaff).filter(value => list(record(value).roles).map(read).includes(role)).map(value => read(record(record(value).person).name))).join(', ') || null;
  const description = [alternatives.length ? `Alternative names:\n${alternatives.join(' / ')}` : null,string(localized(row.localizations,['RU','EN'],'description'))].filter(Boolean).join('\n\n') || null;
  return {...result,description,author:staff('STORY'),artist:staff('ART'),status:statuses[read(row.status)] ?? null,type:types[read(row.type)] ?? null,ageRating:ages[read(row.rating)] ?? null,
    tags:dedupe([types[read(row.type)],ages[read(row.rating)],translations[read(row.translationStatus)],...list(row.formats).map(value => formats[read(value)]),...list(row.labels).map(value => localized(record(value).titles))].filter(Boolean))};
}
export function mapChapters(input,mangaId) {
  const data = requireRecord(input,'Senkuro chapter data'), teams = Object.fromEntries(list(data.teams).map(record).filter(row => read(row.id)).map(row => [read(row.id),read(row.name)]));
  return list(data.chapters).map(record).filter(row => Object.keys(row).length).map(row => {
    const number = read(row.number), volume = read(row.volume), name = read(row.name), parts = [volume && volume !== '0' ? `Vol. ${volume}` : null,number ? `Chapter ${number}` : null,name || null].filter(Boolean);
    const names = [...new Set(list(row.teamIds).map(read).map(id => teams[id]).filter(Boolean))];
    return chapter({id:`${mangaId},,${read(row.id)},,${read(row.slug)}`,title:[parts.join(' - ') || 'Chapter',...(names.length ? [names.join(', ')] : [])].join(' - '),number:finiteNumber(number,-2),uploadedAt:isoDate(read(row.createdAt))});
  });
}
const mangaFields = `id slug originalName {lang content} titles {lang content} alternativeNames {lang content} cover {original {url}}`;
const catalogQuery = `query fetchMangas($first:Int,$after:String,$search:String,$type:MangaTypeFilter,$format:MangaFormatFilter,$status:MangaStatusFilter,$source:MangaSourceFilter,$rating:MangaRatingFilter,$chapters:MangaChaptersFilter,$originCountry:MangaOriginCountryFilter,$releasedOn:MangaReleasedOnFilter,$label:MangaLabelFilter,$translitionStatus:MangaTranslitionStatusFilter,$orderField:MangaOrderField=POPULARITY_SCORE,$orderDirection:OrderDirection=DESC) {
  mangas(first:$first,after:$after,search:$search,type:$type,format:$format,status:$status,source:$source,rating:$rating,chapters:$chapters,originCountry:$originCountry,releasedOn:$releasedOn,label:$label,translitionStatus:$translitionStatus,orderBy:{field:$orderField,direction:$orderDirection}) {edges {node {${mangaFields}}} pageInfo {hasNextPage endCursor}}}`;
const detailsQuery = `query fetchTachiyomiManga($mangaId:ID!) {mangaTachiyomiInfo(mangaId:$mangaId) {${mangaFields} localizations {lang description} type rating status formats labels {id rootId slug titles {lang content}} translationStatus mainStaff {roles person {name}}}}`;
const chaptersQuery = `query fetchTachiyomiChapters($mangaId:ID!) {mangaTachiyomiChapters(mangaId:$mangaId) {message chapters {id slug branchId name teamIds number volume createdAt} teams {id slug name}}}`;
const pagesQuery = `query fetchTachiyomiChapterPages($mangaId:ID!,$chapterId:ID!) {mangaTachiyomiChapterPages(mangaId:$mangaId,chapterId:$chapterId) {pages {url}}}`;
const filtersQuery = `query fetchMangaFilters {allLabels(subjectType:MANGA) {id rootId slug rating depth titles {lang content}}}`;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort(compareText).map(key => [key,canonical(value[key])])) : value;
export default function createSenkuro(ctx) {
  const excludeAdult = ctx.sourceId === 'ru.senkuro', api = excludeAdult ? 'https://api.senkuro.me/graphql' : 'https://api.senkognito.com/graphql';
  const appId = excludeAdult ? '4026531840100' : '5033164800100', appVersion = excludeAdult ? '310726' : '270526';
  // Per-instance caches only: no shared auth/settings/cursors between variants.
  const cursors = new Map(); let filters = null;
  async function post(payload) {
    const reply = await ctx.http.request({method:'POST',url:api,responseType:'json',body:payload,userAgentProfile:'reader',headers:{
      Accept:'application/json','Content-Type':'application/json',Origin:new URL(ctx.baseUrl).origin,Referer:`${new URL(ctx.baseUrl).origin}/`,'app-id':appId,'app-version':appVersion}});
    let root = reply.body; if (typeof root === 'string') { try { root = JSON.parse(root); } catch { throw parseError('Senkuro JSON is invalid.'); } }
    root = requireRecord(root,'Senkuro GraphQL envelope');
    if (list(root.errors).length) throw Object.assign(Error('Senkuro GraphQL request failed.'),{code:'invalid_response',phase:'graphql'});
    const data = requireRecord(root.data,'Senkuro GraphQL data'); if (!Object.keys(data).length) throw Object.assign(Error('Empty Senkuro payload.'),{code:'invalid_response',phase:'graphql'});
    return data;
  }
  const graph = (query,variables) => post({query,variables});
  async function catalog(variables,page) {
    const normalized = Math.max(1,page), key = JSON.stringify(canonical(variables));
    let cache = cursors.get(key); if (!cache) { cache = new Map([[1,null]]); cursors.set(key,cache); }
    const load = async after => requireRecord((await graph(catalogQuery,{...variables,after})).mangas,'Senkuro catalog connection');
    let requests = 0;
    while (!cache.has(normalized)) {
      if (++requests > 200) throw Object.assign(Error('Senkuro pagination work limit.'),{code:'resource_limit',phase:'pagination'});
      const previous = Math.max(...[...cache.keys()].filter(page => page < normalized)), data = await load(cache.get(previous)), info = record(data.pageInfo);
      if (info.hasNextPage !== true) return [];
      const cursor = string(read(info.endCursor)); if (!cursor || cursor === cache.get(previous)) throw parseError('Senkuro pagination cursor did not advance.');
      cache.set(previous+1,cursor);
    }
    const data = await load(cache.get(normalized)), info = record(data.pageInfo);
    if (info.hasNextPage === true) { const cursor = string(read(info.endCursor)); if (cursor) cache.set(normalized+1,cursor); }
    while (cursors.size > 16) cursors.delete(cursors.keys().next().value);
    return list(data.edges).map(value => record(record(value).node)).filter(row => Object.keys(row).length).map(value => mapManga(value));
  }
  return {
    async getFilters({refresh = false} = {}) {
      if (filters && !refresh) return filters;
      let labels = [];
      try { labels = (await graph(filtersQuery,{})).allLabels; } catch (error) { if (['cancelled','auth_session_changed','permission_denied','resource_limit'].includes(error.code)) throw error; }
      return filters = buildFilters(labels,excludeAdult);
    },
    async getPopular({page = 1} = {}) { return catalog({first:20,orderField:'POPULARITY_SCORE',orderDirection:'DESC',...filterVariables({},excludeAdult)},page); },
    async getLatest({page = 1} = {}) { return catalog({first:20,orderField:'LAST_CHAPTER_AT',orderDirection:'DESC',...filterVariables({},excludeAdult)},page); },
    async search({searchTerm = '',page = 1,selectedFilters = {}} = {}) { const term = searchTerm.trim(); return catalog({first:20,...(term ? {search:term} : {}),orderField:'POPULARITY_SCORE',orderDirection:'DESC',...filterVariables(selectedFilters,excludeAdult)},page); },
    async getDetails({mangaId:id}) { const row = record((await graph(detailsQuery,{mangaId:id.split(',,')[0].trim()})).mangaTachiyomiInfo);
      if (!Object.keys(row).length) throw Object.assign(Error('Senkuro title was not found.'),{code:'title_not_found',phase:'parse'}); return mapManga(row,{details:true}); },
    async getChapters({mangaId:id}) { return mapChapters(record((await graph(chaptersQuery,{mangaId:id.split(',,')[0].trim()})).mangaTachiyomiChapters),id); },
    async getPages({mangaId,chapterId}) {
      const parts = chapterId.split(',,').map(value => value.trim()), data = record((await graph(pagesQuery,{mangaId:parts[0] ?? mangaId.split(',,')[0].trim(),chapterId:parts.length > 2 ? parts[2] : chapterId})).mangaTachiyomiChapterPages);
      return list(data.pages).map(value => read(record(value).url)).filter(Boolean).map((imageUrl,index) => ({index,imageUrl}));
    },
    async getRecommendations({mangaId:id,page = 1}) {
      const normalized = Math.max(1,page); if (normalized > 1) return {items:[],page:normalized,hasNextPage:false};
      const parts = id.split(',,').map(value => value.trim()), data = await post({extensions:{persistedQuery:{sha256Hash:'062d157eb1158bd14aa95de219d125aa98bc00750f499970893287f1781f0770',version:1}},operationName:'fetchManga',variables:{slug:parts.length > 1 ? parts[1] : id}}), seen = new Set();
      const items = list(record(data.manga).recommendations).map(record).filter(row => Object.keys(row).length && !(excludeAdult && row.containExplicitThemes === true)).map(value => mapManga(value))
        .filter(row => { if (row.id === id || seen.has(row.id)) return false; seen.add(row.id); return true; });
      return {items,page:normalized,hasNextPage:false};
    },
  };
}
