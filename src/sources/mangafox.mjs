import {recentRequest} from '../core/recent.mjs';
import {chapter,filter,manga,normalizeText,parseError,record,string} from '../core/data.mjs';
import {requireArray,requireRecord,urlWithQuery} from '../core/http.mjs';

const desktop = 'https://fanfox.net', mobile = 'https://m.fanfox.net';
const words = [['cw','Contains'],['bw','Begins with'],['ew','Ends with']];
const genres = ['Action','Adventure','Comedy','Drama','Fantasy','Martial arts','Shounen','Horror','Supernatural','Harem',
  'Psychological','Romance','School life','Shoujo','Mystery','Sci-fi','Seinen','Tragedy','Ecchi','Sports','Slice of life',
  'Mature','Shoujo ai','Webtoons','Doujinshi','One shot','Smut','Yaoi','Josei','Historical','Shounen ai','Gender bender',
  'Adult','Yuri','Mecha','Lolicon','Shotacon'];
export function buildFilters() {
  return [filter('singleSelect','type','Type',[['0','Any'],['1','Japanese manga'],['2','Korean manhwa'],['3','Chinese manhua'],['4','European manga'],['5','American manga'],['6','Hong Kong manga'],['7','Other manga']]),
    filter('singleSelect','st','Completed series',[['0','Either'],['2','Completed only'],['1','Ongoing only']]),
    filter('singleSelect','author_method','Author match',words),filter('text','author','Author name'),
    filter('singleSelect','artist_method','Artist match',words),filter('text','artist','Artist name'),
    filter('singleSelect','rating_method','Rating rule',[['eq','Is'],['lt','Less than'],['gt','More than']]),
    filter('singleSelect','rating','Rating',[['','Any star'],...Array.from({length:6},(_,value) => [String(value),`${value} star${value === 1 ? '' : 's'}`])]),
    filter('singleSelect','released_method','Release year rule',[['eq','On'],['lt','Before'],['gt','After']]),
    {...filter('text','released','Release year'),caption:'Example: 2024'},
    {...filter('triStateMultiSelect','genre','Genres',genres.map((label,index) => [String(index+1),label])),caption:'Tap a genre again to switch between include and exclude.'}];
}
const first = (filters,key) => string(filters[key]?.[0]);
export function directoryUrl(page = 1, latest = false) {
  return `${desktop}${page <= 1 ? '/directory/' : `/directory/${page}.html`}${latest ? '?latest' : ''}`;
}
export function searchUrl({page = 1,searchTerm = '',selectedFilters = {}} = {}) {
  const query = {stype:'1',sort:''};
  if (page > 1) query.page = String(page);
  if (searchTerm.trim()) Object.assign(query,{title:searchTerm.trim(),name:searchTerm.trim(),name_method:'cw'});
  for (const key of ['type','st']) { const value = first(selectedFilters,key); if (value && value !== '0') query[key] = value; }
  for (const key of ['author','artist','rating','released']) {
    const value = first(selectedFilters,key);
    if (value) { query[key] = value; query[`${key}_method`] = first(selectedFilters,`${key}_method`) ?? (['author','artist'].includes(key) ? 'cw' : 'eq'); }
  }
  for (const [prefix,key] of [['include:','genres'],['exclude:','nogenres']]) {
    const values = (selectedFilters.genre ?? []).filter(value => value.startsWith(prefix)).map(value => value.slice(prefix.length));
    if (values.length) query[key] = values.join(',');
  }
  return urlWithQuery('/search',desktop,query);
}
export function mangaId(input) {
  const value = string(input); if (!value) return null;
  let path; try { path = new URL(value,desktop).pathname; } catch { return null; }
  return path.match(/^\/manga\/([^/?#]+)\/?/u)?.[1] ?? (!value.includes('/') ? value : null);
}
export function chapterPath(input) {
  const value = string(input); if (!value) return null;
  try { const path = new URL(value,desktop).pathname; return path.startsWith('/manga/') && path.endsWith('.html') ? path : null; }
  catch { return null; }
}
const texts = values => [...new Set(requireArray(values,'MangaFox text values').map(normalizeText).filter(Boolean))];
const image = {selector:'img',fields:{original:{attr:'data-original'},lazy:{attr:'data-src'},src:{attr:'src'},alt:{attr:'alt'}}};
const tile = {all:true,fields:{
  link:{selector:'.manga-list-4-item-title a[href*="/manga/"], .manga-list-1-item-title a[href*="/manga/"], a[href*="/manga/"]',fields:{href:{attr:'href'},title:{attr:'title'},text:{text:true}}},
  title4:{selector:'.manga-list-4-item-title a',attr:'title'},title1:{selector:'.manga-list-1-item-title a',attr:'title'},image,
  authors:{selector:'.manga-list-4-item-tip a[href*="/search/author/"], .manga-list-1-item-author a, a[href*="/search/author/"]',all:true,text:true},
}};
export const listingProjection = {fields:{one:{...tile,selector:'.manga-list-1-list li'},four:{...tile,selector:'.manga-list-4-list li'}}};
export function parseListing(input,{search = false} = {}) {
  const data = requireRecord(input,'MangaFox listing'), result = [], seen = new Set();
  for (const value of [...(search ? [] : requireArray(data.one,'MangaFox directory')), ...requireArray(data.four,'MangaFox search listing')]) {
    const row = requireRecord(value,'MangaFox listing row'), link = record(row.link), cover = record(row.image);
    const id = mangaId(link.href), title = normalizeText(link.title ?? row.title4 ?? row.title1 ?? link.text ?? cover.alt);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const rawImage = string(cover.original ?? cover.lazy ?? cover.src);
    result.push(manga({id,title,coverUrl:rawImage ? new URL(rawImage,desktop).href : null,author:texts(row.authors).join(', ') || null}));
  }
  return result;
}
const info = {fields:{title:{selector:'.detail-info-right-title-font',text:true},heading:{selector:'h1',text:true},
  authors:{selector:'.detail-info-right-say a',all:true,text:true},status:{selector:'.detail-info-right-title-tip',text:true},
  tags:{selector:'.detail-info-right-tag-list a, .detail-info-right-tag a, a[href*="/search/genre/"]',all:true,text:true},
  rows:{selector:'.detail-info-right-say p, .detail-info-right-title-tip li, p, li',all:true,fields:{text:{text:true},links:{selector:'a',all:true,text:true}}},
}};
export const detailsProjection = {fields:{info:{...info,selector:'.detail-info-right'},body:{...info,selector:'body'},heading:{selector:'h1',text:true},
  cover:{selector:'.detail-info-cover-img',fields:{src:{attr:'src'},lazy:{attr:'data-src'}}},
  coverFallback:{selector:'.detail-info-cover img',fields:{src:{attr:'src'},lazy:{attr:'data-src'}}},
  full:{selector:'.fullcontent',text:true},summary:{selector:'.detail-info-right-content',text:true},show:{selector:'#show',text:true}}};
const label = value => normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/gu,' ').trim();
function detailValues(rows, labels) {
  const result = [];
  for (const value of requireArray(rows,'MangaFox detail rows')) {
    const row = requireRecord(value,'MangaFox detail row'), text = normalizeText(row.text), normalized = label(text);
    const match = labels.find(key => normalized === key || normalized.startsWith(`${key} `));
    if (!match) continue;
    const links = texts(row.links);
    if (links.length) result.push(...links);
    else result.push(text.includes(':') ? text.slice(text.indexOf(':')+1).trim() : text.split(' ').slice(match.split(' ').length).join(' ').trim());
  }
  return [...new Set(result.map(normalizeText).filter(Boolean))];
}
export function parseDetails(input,id,realUrl) {
  const data = requireRecord(input,'MangaFox details'), root = requireRecord(data.info ?? data.body,'MangaFox info');
  const title = normalizeText(root.title ?? root.heading ?? data.heading);
  if (!title) throw parseError('MangaFox title is missing.');
  const cover = record(data.cover), fallback = record(data.coverFallback), image = string(cover.src ?? cover.lazy ?? fallback.src ?? fallback.lazy);
  const statusText = normalizeText(root.status ?? detailValues(root.rows,['status']).join(', ')).toLowerCase();
  return manga({id:mangaId(realUrl) ?? id,title,coverUrl:image ? new URL(image,desktop).href : null,
    description:string(normalizeText(data.full ?? data.summary ?? data.show)),author:texts(root.authors).join(', ') || null,
    artist:detailValues(root.rows,['artist','artists']).join(', ') || null,
    secondaryTitle:detailValues(root.rows,['alternative name','alternative names','other name','other names']).join(', ') || null,
    releaseYear:detailValues(root.rows,['released','release','year']).join(', ') || null,tags:texts(root.tags),
    status:statusText.includes('ongoing') ? 'ongoing' : statusText.includes('complete') ? 'completed' : statusText.includes('hiatus') ? 'hiatus' : statusText.includes('cancel') ? 'cancelled' : null});
}
export const chaptersProjection = {selector:'ul.detail-main-list li a[href*="/manga/"]',all:true,fields:{href:{attr:'href'},
  title:{selector:'.title3, .title',text:true},text:{text:true},date:{selector:'.detail-main-list-main p:last-child',text:true},dateFallback:{selector:'.title2',text:true}}};
export function chapterDate(raw,now = new Date()) {
  const text = normalizeText(raw), lower = text.toLowerCase();
  const local = (year,month,day) => new Date(year,month,day).toISOString();
  if (lower === 'today') return local(now.getFullYear(),now.getMonth(),now.getDate());
  if (lower === 'yesterday') { const day = new Date(now.getTime()-86400000); return local(day.getFullYear(),day.getMonth(),day.getDate()); }
  const match = text.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/u);
  if (match) { const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(match[1].toLowerCase()); return month < 0 ? null : local(Number(match[3]),month,Number(match[2])); }
  if (!/^\d{4}-\d{2}-\d{2}/u.test(text)) return null;
  const time = Date.parse(text); return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
export function parseChapters(input) {
  const result = [], seen = new Set();
  for (const value of requireArray(input,'MangaFox chapters')) {
    const row = requireRecord(value,'MangaFox chapter'), id = chapterPath(row.href);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const title = normalizeText(row.title ?? row.text) || 'Chapter';
    const number = Number(title.match(/(?:chapter|ch\.?|episode|ep\.?|vol\.?)\s*(\d+(?:\.\d+)?)/iu)?.[1] ?? title.match(/(\d+(?:\.\d+)?)/u)?.[1] ?? 0);
    result.push(chapter({id,title,number,uploadedAt:chapterDate(row.date ?? row.dateFallback)}));
  }
  if (!result.length) throw parseError('MangaFox chapters were not found.');
  return result;
}
export default function createMangaFox(ctx) {
  const titleRequest = recentRequest(input => ctx.http.request(input));
  async function html(url,projection,{mobilePage = false,reuse = false} = {}) {
    const origin = mobilePage ? mobile : desktop;
    const response = await (reuse ? titleRequest : input => ctx.http.request(input))({method:'GET',url,responseType:'text',userAgentProfile:mobilePage ? 'mobileSafari' : 'browser',
      headers:{Accept:'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9',Origin:origin,Referer:`${origin}/`}});
    if (typeof response.body !== 'string' || !response.body.trim()) throw Object.assign(Error('MangaFox returned an empty page.'),{code:'invalid_response',phase:'http'});
    return {url:response.url ?? url,data:await ctx.html.extract(response.body,{...projection,baseUrl:response.url ?? url})};
  }
  const titleUrl = id => `${desktop}/manga/${id}/`;
  return {
    async getFilters() { return buildFilters(); },
    async getPopular({page = 1} = {}) { return parseListing((await html(directoryUrl(page),listingProjection)).data); },
    async getLatest({page = 1} = {}) { return parseListing((await html(directoryUrl(page,true),listingProjection)).data); },
    async search(query) {
      const hasFilters = Object.values(query.selectedFilters ?? {}).some(values => values.some(value => value.trim()));
      if (!query.searchTerm?.trim() && !hasFilters) return this.getPopular(query);
      return parseListing((await html(searchUrl(query),listingProjection)).data,{search:true});
    },
    async getDetails({mangaId:id}) { const page = await html(titleUrl(id),detailsProjection,{reuse:true}); return parseDetails(page.data,id,page.url); },
    async getChapters({mangaId:id}) { return parseChapters((await html(titleUrl(id),chaptersProjection,{reuse:true})).data); },
    async getPages({chapterId}) {
      const path = chapterPath(chapterId); if (!path) throw parseError('MangaFox chapter id is missing.');
      const {data} = await html(new URL(path.replace('/manga/','/roll_manga/'),mobile).href,{selector:'#viewer img',all:true,fields:{original:{attr:'data-original'},src:{attr:'src'}}},{mobilePage:true});
      const images = requireArray(data,'MangaFox page images').map(value => {const image = requireRecord(value,'MangaFox image'); return string(image.original ?? image.src);})
        .filter(Boolean).map(value => new URL(value,mobile).href).filter(value => !value.includes('/mobile/images/MF-Loading'));
      if (!images.length) throw parseError('MangaFox pages were not found.');
      return images.map((imageUrl,index) => ({index,imageUrl}));
    },
  };
}
