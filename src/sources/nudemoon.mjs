import {chapter,filter,manga,normalizeText,parseError,record,string} from '../core/data.mjs';
import {requireArray,requireRecord,urlWithQuery} from '../core/http.mjs';

const base = 'https://nude-moon.org';
const sorts = [['date','По дате'],['views','По просмотрам'],['com','По отзывам'],['like','По оценкам'],['pages','По количеству страниц']];
const text = selector => ({selector,text:true});
const imageFields = {lazy:{attr:'data-src'},src:{attr:'src'}};
// The search form submits Windows-1251, matching the document charset. Keep
// this source-specific encoding out of the shared UTF-8 URL/SDK primitives.
const cp1251 = 'ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—\u0000™љ›њќћџ\u00a0ЎўЈ¤Ґ¦§Ё©Є«¬\u00ad®Ї°±Ііґµ¶·ё№є»јЅѕї';
export function encodeSearchTerm(value) {
  const hex = byte => `%${byte.toString(16).toUpperCase().padStart(2,'0')}`;
  return Array.from(value,char => {
    const point = char.codePointAt(0);
    if (point < 128) return new URLSearchParams({q:char}).toString().slice(2);
    if (point >= 0x410 && point <= 0x44f) return hex(point-0x350);
    const index = cp1251.indexOf(char);
    if (index >= 0) return hex(index+128);
    // Browser form submission represents characters outside the document
    // encoding as numeric HTML entities instead of corrupting the query.
    return new URLSearchParams({q:`&#${point};`}).toString().slice(2);
  }).join('');
}
// Slugs differ between the home page, catalog and reader. The numeric prefix
// is the persistent ID; the site accepts /ID-manga.html and /ID-online-manga.html.
export function normalizeId(raw) {
  if (!string(raw)) return null;
  if (/^[1-9]\d*$/u.test(raw.trim())) return raw.trim();
  try { return new URL(raw,base).pathname.match(/^\/([1-9]\d*)-[^/]+\.html$/u)?.[1] ?? null; }
  catch { return null; }
}
function requireId(raw) {
  const id = normalizeId(raw); if (!id) throw parseError('Nude Moon manga id is invalid.'); return id;
}
function resolve(raw) {
  if (!string(raw)) return null;
  try { const url = new URL(raw,base); return url.protocol === 'https:' ? url.href : null; }
  catch { return null; }
}
const cover = value => { const image = record(value); return resolve(image.lazy) ?? resolve(image.src); };
export function buildFilters() { return [filter('sort','sort','Сортировка',sorts)]; }
export function catalogUrl({page = 1,searchTerm = '',selectedFilters = {}} = {},forcedSort) {
  const sort = forcedSort ?? string(selectedFilters.sort?.[0]) ?? 'date';
  if (!sorts.some(([value]) => value === sort)) throw parseError('Nude Moon sort is invalid.');
  const term = normalizeText(searchTerm), offset = (Math.max(1,Math.trunc(page))-1)*30;
  if (term) return `${base}/search?stext=${encodeSearchTerm(term)}${offset ? `&rowstart=${offset}` : ''}`;
  return urlWithQuery('/all_manga',base,{[sort]:'',...(offset ? {rowstart:offset} : {})});
}
export const listingProjection = {fields:{title:text('title'),items:{selector:'table.news_pic2',all:true,fields:{
  link:{selector:'a[href$=".html"][title]',fields:{href:{attr:'href'},title:{attr:'title'}}},
  title:text('h2'),image:{selector:'img[src*="/thumb/"], img[data-src*="/thumb/"]',fields:imageFields}}}}};
export function parseListing(input) {
  const data = requireRecord(input,'Nude Moon catalog');
  // The site's search can return HTTP 200 with only its header/footer. Do not
  // confuse that incomplete response with a valid empty result or end of paging.
  if (!normalizeText(data.title).includes('Nude-Moon')) throw parseError('Nude Moon catalog is incomplete.');
  const seen = new Set(), result = [];
  for (const value of requireArray(data.items,'Nude Moon cards')) {
    const row = requireRecord(value,'Nude Moon card'), link = record(row.link), id = normalizeId(link.href), title = normalizeText(row.title) || normalizeText(link.title);
    if (!id || !title || !cover(row.image) || seen.has(id)) continue;
    seen.add(id); result.push(manga({id,title,coverUrl:cover(row.image),ageRating:'18+'}));
  }
  return result;
}
export const detailsProjection = {fields:{title:text('h1'),cover:{selector:'meta[property="og:image"]',attr:'content'},
  description:text('table.shoutbox .description'),authors:{selector:'table.shoutbox a[href*="mangaka/"]',all:true,text:true},
  tags:{selector:'table.shoutbox .tag-links a',all:true,text:true},metadata:{selector:'table.shoutbox .tbl2',all:true,text:true,exclude:'script'},
  reader:{selector:'a[href*="-online-"]',attr:'href'}}};
export function parseDetails(input,id) {
  const data = requireRecord(input,'Nude Moon details'), title = normalizeText(data.title);
  if (!title) throw parseError('Nude Moon title is missing.');
  const metadata = requireArray(data.metadata,'Nude Moon metadata').map(normalizeText).join(' '), count = metadata.match(/Страниц:\s*(\d+)/iu);
  const authors = [...new Set(requireArray(data.authors,'Nude Moon authors').map(normalizeText).filter(Boolean))].join(', ') || null;
  return manga({id:requireId(id),title,coverUrl:resolve(data.cover),description:string(normalizeText(data.description)),author:authors,artist:authors,
    ageRating:'18+',pageCount:count ? Number(count[1]) : null,tags:[...new Set(requireArray(data.tags,'Nude Moon tags').map(normalizeText).filter(Boolean))]});
}
const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
function uploadDate(metadata) {
  const match = metadata.match(/Дата:\s*(\d{1,2})\s+([а-яё]+)\s+(\d{4})/iu), month = match ? months.indexOf(match[2].toLowerCase()) : -1;
  if (!match || month < 0) return null;
  const year = Number(match[3]), day = Number(match[1]), date = new Date(Date.UTC(year,month,day));
  return date.getUTCMonth() === month && date.getUTCDate() === day ? date.toISOString() : null;
}
export const pagesProjection = {fields:{title:text('h1'),images:{selector:'img.border[src*="/manga/"], img.border[data-src*="/manga/"]',all:true,fields:imageFields}}};
export function parsePages(input) {
  const data = requireRecord(input,'Nude Moon reader');
  if (!normalizeText(data.title)) throw parseError('Nude Moon reader is incomplete.');
  const urls = [...new Set(requireArray(data.images,'Nude Moon images').map(cover).filter(Boolean))];
  if (!urls.length) throw parseError('Nude Moon reader pages are missing.');
  return urls.map((imageUrl,index) => ({index,imageUrl}));
}
export default function createNudeMoon(ctx) {
  async function html(url,projection) {
    // The HTTP host decodes the site's declared Windows-1251 charset.
    const response = await ctx.http.request({method:'GET',url,responseType:'text',userAgentProfile:'browser',
      headers:{Accept:'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',Referer:`${base}/`}});
    if (typeof response.body !== 'string' || !response.body.trim()) throw Object.assign(Error('Empty Nude Moon response.'),{code:'invalid_response',phase:'http'});
    return ctx.html.extract(response.body,{...projection,baseUrl:response.url ?? url});
  }
  const details = id => html(`${base}/${requireId(id)}-manga.html`,detailsProjection);
  return {
    async getFilters() { return buildFilters(); },
    async getPopular(query = {}) { return parseListing(await html(catalogUrl(query,'views'),listingProjection)); },
    async getLatest(query = {}) { return parseListing(await html(catalogUrl(query,'date'),listingProjection)); },
    async search(query = {}) { return parseListing(await html(catalogUrl(query),listingProjection)); },
    async getDetails({mangaId:id}) { return parseDetails(await details(id),id); },
    async getChapters({mangaId:id}) {
      const data = await details(id), manga = parseDetails(data,id);
      if (normalizeId(data.reader) !== manga.id) throw parseError('Nude Moon reader link is missing.');
      return [chapter({id:manga.id,title:manga.title,number:1,uploadedAt:uploadDate(data.metadata.map(normalizeText).join(' '))})];
    },
    async getPages({chapterId:id}) {
      // The row view exposes every full-size image, including lazy pages and
      // non-numeric filenames, without evaluating the site's image-switcher JS.
      return parsePages(await html(`${base}/${requireId(id)}-online-manga.html?row`,pagesProjection));
    },
  };
}
