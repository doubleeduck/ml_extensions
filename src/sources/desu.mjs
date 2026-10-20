import {recentRequest} from '../core/recent.mjs';
import {chapter,filter,manga,normalizeText,parseError,record,string} from '../core/data.mjs';
import {finiteNumber,requireArray,requireRecord,urlWithQuery} from '../core/http.mjs';
const text = selector => ({selector,text:true});
const definitionPairs = {selector:'dl dt',all:true,fields:{key:{text:true},value:{nextSibling:true,text:true}}};
const pairs = input => Object.fromEntries(requireArray(input,'Desu definition pairs').map(row => [normalizeText(row.key).replace(/:$/u,'').toLowerCase(),normalizeText(row.value)]).filter(([key,value]) => key && value));
export function normalizeId(raw,{chapter = false,base = 'https://desu.uno'} = {}) {
  if (!string(raw)) return null;
  const path = decodeURI(new URL(raw.trim(),base).pathname);
  if (!(chapter ? /^\/manga\/[^/?#]+\.\d+\/vol[^/]+\/ch[^/]+\/[^/?#]+\/?$/iu : /^\/manga\/[^/?#]+\.\d+\/?$/iu).test(path)) return null;
  return chapter ? path.replace(/\/$/u,'') : path.endsWith('/') ? path : `${path}/`;
}
const resolve = (raw,base) => string(raw) && !raw.trim().startsWith('data:image/') ? new URL(raw.trim(),base).href : null;
const inputProjection = attribute => ({value:{attr:attribute},parent:{ascend:1,fields:{label:text('.filter-control-text'),text:{text:true}}}});
const filtersProjection = {fields:{types:{selector:'.catalog-kinds input[data-kind]',all:true,fields:inputProjection('data-kind')},
  statuses:{selector:'.catalog-status input[data-status]',all:true,fields:inputProjection('data-status')},
  genres:{selector:'.catalog-genres input[data-genre-id][data-genre-slug]',all:true,fields:{id:{attr:'data-genre-id'},slug:{attr:'data-genre-slug'},name:{attr:'data-genre-name'},parent:{ascend:1,fields:{label:text('.filter-control-text')}}}},
  sorts:{selector:'.catalog-order input[name=sort_option]',all:true,fields:{value:{attr:'value'},id:{attr:'id'},next:{nextSibling:true,fields:{tag:{tagName:true},for:{attr:'for'},text:{text:true}}},parent:{ascend:1,fields:{label:text('.filter-control-text')}}}}}};
export function parseFilters(input) {
  const data = requireRecord(input,'Desu filters'), simple = values => requireArray(values,'Desu input options').flatMap(row => {
    const value = string(row.value), label = string(normalizeText(record(row.parent).label ?? record(row.parent).text)); return value && label ? [[value,label]] : [];
  });
  const sorts = data.sorts.flatMap(row => { const value = string(row.value), next = record(row.next);
    const label = normalizeText(next.tag === 'label' && (!string(row.id) || next.for === row.id.trim()) ? next.text : record(row.parent).label);
    return value && label ? [[value,label]] : [];
  });
  const result = [filter('sort','sort','Сортировка',sorts.length ? sorts : [['id','По добавлению'],['name','По названию'],['popular','По популярности'],['updated','По обновлению']])];
  for (const [key,label,kind,options] of [['types','Тип','multiSelect',simple(data.types)],['statuses','Статус','multiSelect',simple(data.statuses)],
    ['genres','Жанры и теги','triStateMultiSelect',data.genres.flatMap(row => { const id = string(row.id), slug = string(row.slug), label = string(normalizeText(row.name ?? record(row.parent).label)); return id && slug && label ? [[`${id}-${slug}`,label]] : []; })]]) {
    if (options.length) result.push({...filter(kind,key,label,options),...(key === 'genres' ? {caption:'Можно включать и исключать отдельные значения.'} : {})});
  }
  return result;
}
export function catalogUrl(base,{page = 1,selectedFilters = {}} = {},forcedSort) {
  const params = page > 1 ? {page} : {}, plain = values => [...new Set((values ?? []).map(value => value.trim()).filter(value => value && !value.startsWith('include:') && !value.startsWith('exclude:')))];
  for (const [key,param] of [['types','kinds'],['statuses','status']]) { const values = plain(selectedFilters[key]); if (values.length) params[param] = values.join(','); }
  const genres = [...new Set((selectedFilters.genres ?? []).flatMap(raw => {
    const value = raw.trim(), include = value.startsWith('include:'), exclude = value.startsWith('exclude:'); if (!include && !exclude) return [];
    const genre = value.slice(value.indexOf(':')+1).trim(); return genre ? [exclude ? genre.replace('-','-!') : genre] : [];
  }))]; if (genres.length) params.genres = genres.join(',');
  const sort = forcedSort ?? selectedFilters.sort?.[0]; if (sort && sort !== 'updated') params.order_by = sort;
  return urlWithQuery('/manga/',base,params);
}
const catalogFields = {link:{selector:'a.animeTitle[href*="manga/"]',fields:{href:{attr:'href'},title:{text:true}}},russian:text('.dimmed [itemprop=title]'),info:definitionPairs,
  cover:{selector:'a.avatar .img',fields:{style:{attr:'style'},src:{attr:'src'}}},age:{selector:'a.avatar',attr:'class'}};
const catalogProjection = {selector:'#animeCatalog .animeList li.memberListItem, #animeCatalog li.primaryContent.memberListItem',all:true,fields:catalogFields};
const quickProjection = {selector:'#acpQuickSearch a[href^="manga/"], #acpQuickSearch a[href^="/manga/"]',all:true,fields:{href:{attr:'href'},russian:text('.itemSubTitle'),original:text('.itemTitle'),image:{selector:'img',attr:'src'},info:definitionPairs}};
export function parseCatalog(input,base,{quick = false} = {}) {
  const result = [], seen = new Set();
  for (const value of requireArray(input,'Desu catalog')) {
    const row = requireRecord(value,'Desu card'), link = record(row.link), id = normalizeId(quick ? row.href : link.href,{base});
    if (!id || seen.has(id)) continue; seen.add(id);
    const original = string(normalizeText(quick ? row.original : link.title)), title = string(normalizeText(row.russian)) ?? original; if (!title) continue;
    const info = pairs(row.info), cover = record(row.cover), style = typeof cover.style === 'string' ? cover.style.match(/background-image\s*:\s*url\(\s*['"]?([^'")]+)/iu)?.[1] : null;
    result.push(manga({id,title,secondaryTitle:original === title ? null : original,coverUrl:resolve(quick ? row.image : style ?? cover.src,base),type:info['тип'] ?? null,releaseYear:info['год'] ?? null,
      ...(!quick ? {rating:finiteNumber(info['рейтинг']?.replaceAll(',','.'),null),ageRating:row.age?.includes('age_18_plus') ? '18+' : null,tags:(info['жанры'] ?? '').split(',').map(normalizeText).filter(Boolean)} : {})}));
  }
  return result;
}
const detailsProjection = {fields:{russian:text('.titleBar h1 .rus-name'),name:text('.titleBar h1 .name'),headline:{selector:'#animeView [itemprop=headline]',attr:'content'},
  alternative:{selector:'#animeView [itemprop=alternativeHeadline]',attr:'content'},cover:{selector:'#animeView [itemprop=image]',attr:'src'},
  description:text('#description [itemprop=description]'),descriptionFallback:text('#description'),status:text('.b-entry-info .b-anime_status_tag'),adult:{selector:'#animeView .c-poster.age_18_plus',text:true},
  rating:{selector:'[itemprop=ratingValue]',attr:'content'},tags:{selector:'.b-entry-info a[itemprop=genre]',all:true,text:true},
  info:{selector:'.b-entry-info .line',all:true,fields:{key:text('.key'),value:text('.value'),people:{selector:'.value a',all:true,text:true}}}}};
export function parseDetails(input,id,base) {
  const data = requireRecord(input,'Desu details'), title = string(normalizeText(data.russian ?? data.headline ?? data.name)); if (!title) throw parseError('Desu title is missing.');
  const secondary = string(normalizeText(data.name ?? data.alternative)), info = pairs(data.info), authorLine = data.info.find(row => normalizeText(row.key).replace(/:$/u,'').toLowerCase().startsWith('автор'));
  const names = authorLine ? [...new Set(authorLine.people.map(normalizeText).filter(Boolean))] : [], author = names.length ? names.join(', ') : string(normalizeText(authorLine?.value));
  return manga({id,title,secondaryTitle:secondary === title ? null : secondary,coverUrl:resolve(data.cover,base),description:string(normalizeText(data.description ?? data.descriptionFallback)),author,artist:author,
    status:string(normalizeText(data.status ?? info['статус'])),type:info['тип'] ?? null,ageRating:data.adult == null ? null : '18+',rating:finiteNumber(normalizeText(data.rating).replaceAll(',','.'),null),
    releaseYear:info['статус']?.match(/\b(?:19|20)\d{2}\b/u)?.[0] ?? null,tags:[...new Set(data.tags.map(value => normalizeText(value).replace(/^#\s*/u,'')).filter(Boolean))]});
}
const integer = value => typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : typeof value === 'string' && /^[+-]?\d+$/u.test(value) ? Number(value) : null;
const asText = value => value == null ? null : string(String(value));
const timestamp = value => { const seconds = integer(value); return seconds == null ? null : new Date(seconds*1000).toISOString(); };
export function parseApiChapters(input) {
  const data = requireRecord(input,'Desu API chapters'), seen = new Set();
  return requireArray(data.chapters,'Desu API chapter list').flatMap(value => {
    const row = record(value), id = integer(row.id), number = finiteNumber(typeof row.number === 'string' ? row.number.replaceAll(',','.') : row.number,null);
    if (id == null || number == null || seen.has(id)) return []; seen.add(id);
    const volume = asText(row.volume), name = asText(row.title), prefix = `${volume ? `Volume ${volume}. ` : ''}Chapter ${asText(row.number) ?? number}`;
    return [chapter({id:`api:${id}`,title:`${prefix}${name ? ` - ${name}` : ''}`,number,uploadedAt:timestamp(row.publish_date)})];
  });
}
export function parseApiPages(input,base) {
  const data = requireRecord(record(input).chapter,'Desu API chapter'), pages = requireArray(data.pages,'Desu API pages').map(row => resolve(asText(record(row).url),base)).filter(Boolean);
  if (!pages.length) throw parseError('Desu chapter has no readable pages.'); return pages.map((imageUrl,index) => ({index,imageUrl}));
}
const legacyChaptersProjection = {selector:'ul.chlist > li',all:true,fields:{link:{selector:'a[href*="/vol"][href*="/ch"]',fields:{href:{attr:'href'},title:{attr:'title'},text:{text:true}}},time:{selector:'.DateTime[data-time]',attr:'data-time'}}};
const recommendationsProjection = {selector:'#cutted_covers_4 article.c-anime',all:true,fields:{main:{selector:'a.title[href*="manga/"]',fields:{href:{attr:'href'},title:{attr:'title'},text:{text:true}}},
  fallback:{selector:'a[href*="manga/"]',fields:{href:{attr:'href'},title:{attr:'title'},text:{text:true}}},image:{selector:'img',fields:{src:{attr:'src'},alt:{attr:'alt'}}}}};
const compatibleFailure = error => ['network','offline','timeout','not_found','parse_error','invalid_response'].includes(error.code);
export default function createDesu(ctx) {
  const titleRequest = recentRequest(input => ctx.http.request(input));
  let cachedBase = null, cachedFilters = null;
  async function base() { const value = string(record(await ctx.settings.get('network')).customBaseUrl) ?? ctx.baseUrl; if (value !== cachedBase) { cachedBase = value; cachedFilters = null; } return value; }
  async function request(url,{form,json = false,referer,reuse = false} = {}) {
    const response = await (reuse ? titleRequest : input => ctx.http.request(input))({method:form ? 'POST' : 'GET',url,responseType:'text',...(form ? {body:new URLSearchParams(form).toString()} : {}),headers:{
      Accept:form ? 'application/json, text/javascript, */*; q=0.01' : json ? 'application/json, text/plain, */*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Referer:referer ?? new URL(url).origin,...(form ? {'Content-Type':'application/x-www-form-urlencoded','X-Requested-With':'XMLHttpRequest'} : {})}});
    if (typeof response.body !== 'string' || !response.body.trim()) throw Object.assign(Error('Empty Desu response.'),{code:'invalid_response',phase:'http'});
    if (json || form) { try { return requireRecord(JSON.parse(response.body),'Desu payload'); } catch { throw parseError('Desu JSON is malformed.'); } }
    return response.body;
  }
  const html = async (url,projection,reuse = false) => ctx.html.extract(await request(url,{reuse}),{...projection,baseUrl:url});
  const listing = async (query,sort) => { const origin = await base(); return parseCatalog(await html(catalogUrl(origin,query,sort),catalogProjection),origin); };
  const numericId = id => normalizeId(id)?.match(/\.(\d+)\/?$/u)?.[1];
  return {
    async getFilters({refresh = false} = {}) { const origin = await base(); if (!cachedFilters || refresh) cachedFilters = parseFilters(await html(new URL('/manga/',origin).href,filtersProjection)); return cachedFilters; },
    async getPopular({page = 1} = {}) { return listing({page},'popular'); },
    async getLatest({page = 1} = {}) { return listing({page},'updated'); },
    async search(query) {
      const origin = await base(), term = query.searchTerm?.trim() ?? ''; if (!term) return listing(query);
      if (query.page > 1) return [];
      const payload = await request(urlWithQuery('/manga/search/',origin,{_xfRequestUri:'/manga/',_xfNoRedirect:'1',_xfResponseType:'json'}),{form:{q:term,_xfToken:''},referer:new URL('/manga/',origin).href});
      if (typeof payload.templateHtml !== 'string') throw parseError('Desu search template is missing.');
      return parseCatalog(await ctx.html.extract(payload.templateHtml,{...quickProjection,baseUrl:origin}),origin,{quick:true});
    },
    async getDetails({mangaId:id}) { const origin = await base(), path = normalizeId(id,{base:origin}); if (!path) throw parseError('Desu manga id is invalid.'); return parseDetails(await html(new URL(path,origin).href,detailsProjection,true),path,origin); },
    async getChapters({mangaId:id}) {
      const origin = await base(), path = normalizeId(id,{base:origin}); if (!path) throw parseError('Desu manga id is invalid.');
      const numeric = numericId(path); if (numeric) try { const chapters = parseApiChapters(await request(new URL(`/api/manga/${numeric}/chapters`,origin).href,{json:true})); if (chapters.length) return chapters; } catch (error) { if (!compatibleFailure(error)) throw error; }
      const rows = requireArray(await html(new URL(path,origin).href,legacyChaptersProjection,true),'Desu HTML chapters'), seen = new Set();
      return rows.flatMap(row => {
        const link = record(row.link), id = normalizeId(link.href,{base:origin,chapter:true}), number = id?.match(/\/ch(-?\d+(?:[.,]\d+)?)/iu)?.[1];
        if (!id || number == null || seen.has(id)) return []; seen.add(id);
        return [chapter({id,title:string(normalizeText(link.title ?? link.text)) ?? `Глава ${Number(number.replace(',','.'))}`,number:Number(number.replace(',','.')),uploadedAt:timestamp(row.time)})];
      });
    },
    async getPages({mangaId,chapterId}) {
      const origin = await base(), numeric = numericId(mangaId), api = chapterId.trim().match(/^api:([+-]?\d+)$/u)?.[1];
      if (api) { if (!numeric) throw parseError('Desu manga id is invalid.'); return parseApiPages(await request(new URL(`/api/manga/${numeric}/chapters/${api}`,origin).href,{json:true}),origin); }
      const path = normalizeId(chapterId,{base:origin,chapter:true}); if (!path) throw parseError('Desu chapter id is invalid.');
      if (numeric) try {
        const payload = await request(new URL(`/api/manga/${numeric}/chapters`,origin).href,{json:true});
        const row = Array.isArray(payload.chapters) ? payload.chapters.find(row => normalizeId(asText(record(row).view_url),{base:origin,chapter:true}) === path && integer(record(row).id) != null) : null;
        if (row) return parseApiPages(await request(new URL(`/api/manga/${numeric}/chapters/${integer(row.id)}`,origin).href,{json:true}),origin);
      } catch (error) { if (!compatibleFailure(error)) throw error; }
      const body = await request(new URL(path,origin).href), directory = body.match(/\bdir\s*:\s*["']([^"']+)["']/iu)?.[1], raw = body.match(/\bimages\s*:\s*(\[[\s\S]*?\])\s*,\s*page\s*:/iu)?.[1];
      if (!directory || !raw) throw parseError('Desu reader configuration is missing.');
      let values; try { values = JSON.parse(raw); } catch { throw parseError('Desu reader images are malformed.'); }
      const dir = new URL(directory,origin).href, urls = requireArray(values,'Desu reader images').map(value => resolve(Array.isArray(value) ? asText(value[0]) : typeof value === 'string' ? value : null,dir)).filter(Boolean);
      if (!urls.length) throw parseError('Desu reader has no images.'); return urls.map((imageUrl,index) => ({index,imageUrl}));
    },
    async getRecommendations({mangaId:id,page = 1}) {
      const normalized = Math.max(1,page); if (normalized > 1) return {items:[],page:normalized,hasNextPage:false};
      const origin = await base(), path = normalizeId(id,{base:origin}), items = [], seen = new Set(); if (!path) return {items,page:normalized,hasNextPage:false};
      for (const row of requireArray(await html(new URL(path,origin).href,recommendationsProjection),'Desu recommendations')) {
        const link = record(row.main ?? row.fallback), itemId = normalizeId(link.href,{base:origin}); if (!itemId || itemId === path || seen.has(itemId)) continue; seen.add(itemId);
        const original = string(normalizeText(link.text)), combined = string(normalizeText(link.title ?? record(row.image).alt)); let title, secondary = null;
        if (!combined || !original) title = combined ?? original;
        else if (combined.endsWith(`(${original})`)) { const russian = string(combined.slice(0,-(original.length+2))); title = russian ?? original; secondary = russian ? original : null; }
        else { title = combined; secondary = combined === original ? null : original; }
        if (title) items.push(manga({id:itemId,title,secondaryTitle:secondary,coverUrl:resolve(record(row.image).src,origin)}));
      }
      return {items,page:normalized,hasNextPage:false};
    },
  };
}
