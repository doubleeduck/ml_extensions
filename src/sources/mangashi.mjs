import {recent} from '../core/recent.mjs';
import {chapter,filter,manga,normalizeText,parseError,record,string} from '../core/data.mjs';
import {requireArray,requireRecord,urlWithQuery} from '../core/http.mjs';
const base = 'https://manga-shi.org';
const text = selector => ({selector,text:true});
export function normalizeId(raw,chapter = false) {
  if (!string(raw)) return null;
  const path = decodeURI(new URL(raw.trim(),base).pathname);
  if (!(chapter ? /^\/manga\/[^/]+\/(?:[^/]+\/)*glava[-_][^/]+\/?$/iu : /^\/manga\/[^/]+\/?$/iu).test(path)) return null;
  return path.endsWith('/') ? path : `${path}/`;
}
const optionsProjection = {fields:{tags:{selector:'input[name=tag]',all:true,fields:{value:{attr:'value'},parent:{ascend:1,fields:{span:text('span'),text:{text:true}}}}},years:{selector:'select[name=year] option',all:true,fields:{value:{attr:'value'},label:{text:true}}}}};
function parseOptions(input) {
  const data = requireRecord(input,'MangaShi filter options'), seen = new Set();
  return {tags:requireArray(data.tags,'MangaShi tags').flatMap(row => { const value = string(row.value), label = string(normalizeText(record(row.parent).span ?? record(row.parent).text));
    if (!value || !label || seen.has(value)) return []; seen.add(value); return [[value,label]]; }),
  years:requireArray(data.years,'MangaShi years').flatMap(row => { const value = string(row.value), label = string(normalizeText(row.label)); return value && label ? [[value,label]] : []; })};
}
export function buildFilters({tags = [],years = []} = {}) {
  return [filter('sort','sort','Сортировка',[['added','По дате добавления'],['updated','По обновлению глав'],['rating','По рейтингу'],['popular','По популярности'],['chapters','По количеству глав'],['year','По году выпуска']]),
    filter('singleSelect','status','Статус',[['ONGOING','Онгоинг'],['COMPLETED','Завершён'],['HIATUS','Хиатус']]),
    filter('singleSelect','type','Тип',[['MANGA','Манга'],['MANHWA','Манхва'],['MANHUA','Маньхуа'],['WESTERN','Западный комикс'],['RUMANGA','Руманга']]),
    filter('singleSelect','year','Год выпуска',years),filter('singleSelect','age_rating','Возрастной рейтинг',[['sfw','Без 18+'],['adult','Только 18+']]),
    filter('text','chapters_min','Минимум глав'),filter('text','chapters_max','Максимум глав'),filter('triStateMultiSelect','tags','Жанры и теги',tags)];
}
export function searchUrl({searchTerm = '',page = 1,selectedFilters = {}} = {}) {
  const params = {page:Math.max(1,page)}, term = string(searchTerm); if (term) params.q = term;
  for (const key of ['sort','status','type','year','age_rating','chapters_min','chapters_max']) { const value = string(selectedFilters[key]?.[0]); if (value) params[key] = value; }
  for (const [prefix,key] of [['include:','tag'],['exclude:','exclude_tag']]) {
    const values = (selectedFilters.tags ?? []).filter(value => value.startsWith(prefix)).map(value => value.slice(prefix.length).trim()).filter(Boolean); if (values.length) params[key] = values;
  }
  return urlWithQuery('/catalog/',base,params);
}
const cardFields = {href:{attr:'href'},title:text('h3, h4, .title'),image:{selector:'img',fields:{title:{attr:'title'},src:{attr:'src'},lazy:{attr:'data-src'}}},
  type:text('div.flex.justify-between.items-center > span'),badges:{selector:'span, div',all:true,text:true}};
const listingProjection = {fields:{items:{selector:'#manga-grid > a[href*="/manga/"]',all:true,fields:cardFields},options:optionsProjection}};
const resolve = value => string(value) && !value.trim().startsWith('data:image/') ? new URL(value.trim(),base).href : null;
export function parseListing(input,exclude = null) {
  const result = [], seen = new Set();
  for (const value of requireArray(input,'MangaShi catalog')) {
    const row = requireRecord(value,'MangaShi card'), id = normalizeId(row.href), image = record(row.image), title = string(normalizeText(row.title ?? image.title));
    if (!id || id === exclude || !title || seen.has(id)) continue; seen.add(id);
    result.push(manga({id,title,coverUrl:resolve(image.lazy ?? image.src),type:string(normalizeText(row.type)),ageRating:requireArray(row.badges,'MangaShi badges').some(value => normalizeText(value) === '18+') ? '18+' : null}));
  }
  return result;
}
const detailsProjection = {fields:{title:text('h1'),hero:{selector:'h1',ascend:1,fields:{badges:{selector:'span.tracking-widest',all:true,text:true},description:text('.leading-relaxed')}},
  cover:{selector:'meta[property="og:image"]',attr:'content'},adult:{selector:'[data-adult-warning=true]',text:true},tags:{selector:'a[href^="/manga-genre/"], a[href*="/catalog/?tag="]',all:true,text:true},
  metadata:{selector:'div',all:true,fields:{children:{selector:'*',all:true,directChildren:true,fields:{tag:{tagName:true},text:{text:true}}}}}}};
export function parseDetails(input,id) {
  const data = requireRecord(input,'MangaShi details'), title = string(normalizeText(data.title)); if (!title) throw parseError('MangaShi title is missing.');
  const info = label => { for (const row of data.metadata) {
    const children = row.children; if (children.length < 2 || children[0].tag !== 'span') continue;
    if (normalizeText(children[0].text).replaceAll(':','').toLowerCase() === label.toLowerCase()) return string(normalizeText(children.slice(1).map(row => row.text).join(', ')));
  } return null; };
  const badges = record(data.hero).badges ?? [], status = normalizeText(badges[1]).replace('•','').trim(), lower = status.toLowerCase(), seen = new Set();
  return manga({id:normalizeId(id),title,coverUrl:resolve(data.cover),description:string(normalizeText(record(data.hero).description)),secondaryTitle:info('Другие названия')?.replace(/\s*\/\s*/gu,', ') ?? null,
    author:info('Автор'),artist:info('Художник'),releaseYear:info('Год'),type:badges[0] ?? null,ageRating:data.adult == null ? null : '18+',
    status:lower.includes('онгоинг') ? 'ongoing' : lower.includes('заверш') ? 'completed' : lower.includes('хиатус') ? 'hiatus' : string(status),
    tags:data.tags.map(value => normalizeText(value).replace('#','')).filter(value => { const key = value.toLowerCase(); if (!value || seen.has(key)) return false; seen.add(key); return true; })});
}
const chaptersProjection = {fields:{items:{selector:'a[href*="/glava"]',all:true,fields:{href:{attr:'href'},title:text('.chapter-title'),text:{text:true}}},next:{selector:'#chapters-load-more [hx-get], #chapters-load-more[hx-get]',attr:'hx-get'}}};
const relatedProjection = {selector:'[data-rec-block]',fields:{items:{selector:'a[href*="/manga/"]',all:true,fields:{...cardFields,title:text('h3, h4')}}}};
export default function createMangaShi(ctx) {
  let cachedTags = null, cachedYears = null;
  async function html(url,projection,{htmx = false} = {}) {
    const response = await ctx.http.request({method:'GET',url,responseType:'text',headers:{Accept:'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',Referer:`${base}/`,...(htmx ? {'HX-Request':'true'} : {})}});
    if (typeof response.body !== 'string' || !response.body.trim()) throw Object.assign(Error('MangaShi response is empty.'),{code:'invalid_response',phase:'http'});
    return ctx.html.extract(response.body,{...projection,baseUrl:response.url ?? url});
  }
  const titlePage = recent(url => html(url,{fields:{details:detailsProjection,chapters:chaptersProjection,related:relatedProjection}}));
  async function listing(url) { const page = await html(url,listingProjection), options = parseOptions(page.options); if (cachedTags == null && options.tags.length) cachedTags = options.tags; if (cachedYears == null && options.years.length) cachedYears = options.years; return parseListing(page.items); }
  return {
    async getFilters({refresh = false} = {}) {
      if (cachedTags == null || cachedYears == null || refresh) { const options = parseOptions(await html(`${base}/catalog/`,optionsProjection)); cachedTags = options.tags; cachedYears = options.years; }
      return buildFilters({tags:cachedTags,years:cachedYears});
    },
    async getPopular({page = 1} = {}) { return listing(urlWithQuery('/catalog/',base,{sort:'popular',page:Math.max(1,page)})); },
    async getLatest({page = 1} = {}) { return listing(urlWithQuery('/catalog/',base,{sort:'updated',page:Math.max(1,page)})); },
    async search(query) { return listing(searchUrl(query)); },
    async getDetails({mangaId:id}) { const path = normalizeId(id); if (!path) throw parseError('MangaShi manga id is invalid.'); return parseDetails((await titlePage(new URL(path,base).href)).details,id); },
    async getChapters({mangaId:id}) {
      const path = normalizeId(id); if (!path) throw parseError('MangaShi manga id is invalid.');
      const result = [], seen = new Set(), visited = new Set(); let url = new URL(path,base).href, htmx = false;
      for (let count = 0; count < 100; count++) {
        const data = requireRecord(htmx ? await html(url,chaptersProjection,{htmx:true}) : (await titlePage(url)).chapters,'MangaShi chapters');
        for (const row of requireArray(data.items,'MangaShi chapter links')) {
          const id = normalizeId(row.href,true), title = string(normalizeText(row.title)); if (!id || !title || seen.has(id)) continue; seen.add(id);
          const match = id.match(/\/glava[-_](\d+(?:[.,]\d+)?)/iu) ?? title.match(/(?:глава|гл\.?|chapter)\s*(\d+(?:[.,]\d+)?)/iu), date = row.text?.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/u);
          result.push(chapter({id,title,number:match ? Number(match[1].replace(',','.')) : -1,uploadedAt:date ? new Date(Date.UTC(Number(date[3]),Number(date[2])-1,Number(date[1]))).toISOString() : null}));
        }
        if (!string(data.next)) break; url = new URL(data.next,base).href; if (visited.has(url)) break; visited.add(url); htmx = true;
      }
      return result;
    },
    async getPages({chapterId:id}) {
      const path = normalizeId(id,true); if (!path) throw parseError('MangaShi chapter id is invalid.');
      const images = requireArray(await html(new URL(path,base).href,{selector:'img.reader-image',all:true,fields:{lazy:{attr:'data-src'},src:{attr:'src'}}}),'MangaShi reader');
      const urls = [...new Set(images.map(row => resolve(row.lazy ?? row.src)).filter(Boolean))]; if (!urls.length) throw parseError('MangaShi reader pages are missing.');
      return urls.map((imageUrl,index) => ({index,imageUrl}));
    },
    async getRecommendations({mangaId:id,page = 1}) {
      const normalized = Math.max(1,page), path = normalizeId(id); if (normalized > 1 || !path) return {items:[],page:normalized,hasNextPage:false};
      const data = (await titlePage(new URL(path,base).href)).related;
      return {items:data == null ? [] : parseListing(data.items,path),page:normalized,hasNextPage:false};
    },
  };
}
