import {chapter,filter,isoDate,manga,normalizeText,parseError,record,string} from '../core/data.mjs';
import {finiteNumber,requireArray,requireRecord,urlWithQuery} from '../core/http.mjs';

const hosts = ['www.mangakakalot.gg','www.mangakakalove.com'];
const genreLabels = ['All','Action','Adult','Adventure','Comedy','Cooking','Doujinshi','Drama','Ecchi','Fantasy','Gender bender','Harem',
  'Historical','Horror','Isekai','Josei','Manhua','Manhwa','Martial arts','Mature','Mecha','Medical','Mystery','One shot','Psychological',
  'Romance','School life','Sci fi','Seinen','Shoujo','Shoujo ai','Shounen','Shounen ai','Slice of life','Smut','Sports','Supernatural','Tragedy','Webtoons','Yaoi','Yuri'];
export function buildFilters() {
  const caption = 'Ignored when text search is used.';
  return [{...filter('sort','sort','Order by',[['latest','Latest'],['newest','Newest'],['topview','Top read']]),caption},
    {...filter('singleSelect','status','Status',[['all','All'],['completed','Completed'],['ongoing','Ongoing'],['drop','Dropped']]),caption},
    {...filter('singleSelect','genre','Category',genreLabels.map(label => [label.toLowerCase().replaceAll(' ','-'),label])),caption}];
}
export function searchPath({searchTerm = '',page = 1,selectedFilters = {}} = {}) {
  const query = searchTerm.trim();
  if (query) return {path:`/search/story/${query.toLowerCase().replace(/[^a-z0-9]+/gu,'_').replace(/^_+|_+$/gu,'')}`,params:{page:Math.max(1,page)}};
  const genre = selectedFilters.genre?.[0] ?? 'all';
  return {path:genre && genre !== 'all' ? `/genre/${genre}` : '/genre',params:{page:Math.max(1,page),type:selectedFilters.sort?.[0] ?? 'latest',state:selectedFilters.status?.[0] ?? 'all'}};
}
export function mangaId(raw) {
  const value = string(raw); if (!value) return null;
  return new URL(value,'https://www.mangakakalot.gg').pathname.match(/\/manga\/([^/?#]+)/u)?.[1] ?? (!value.includes('/') ? value : null);
}
const imageFields = {src:{attr:'src'},lazy:{attr:'data-src'}};
const resolveImage = (value,base) => { const row = record(value), raw = string(row.src ?? row.lazy); return raw ? new URL(raw,base).href : null; };
export const listingProjection = {selector:'div.truyen-list > div.list-truyen-item-wrap, div.comic-list > .list-comic-item-wrap, .panel_story_list .story_item',all:true,fields:{
  heading:{selector:'h3 a',fields:{href:{attr:'href'},title:{text:true}}},story:{selector:'.story_name a',fields:{href:{attr:'href'},title:{text:true}}},
  fallback:{selector:'a[href*="/manga/"]',fields:{href:{attr:'href'},title:{text:true}}},image:{selector:'img',fields:imageFields}}};
export function parseListing(input,base) {
  const result = [], seen = new Set();
  for (const value of requireArray(input,'MangaBox listing')) {
    const row = requireRecord(value,'MangaBox card'), link = record(row.heading ?? row.story ?? row.fallback), id = mangaId(link.href), title = string(normalizeText(link.title));
    if (!id || !title || seen.has(id)) continue;
    seen.add(id); result.push(manga({id,title,coverUrl:resolveImage(row.image,base)}));
  }
  return result;
}
const infoProjection = {fields:{title:{selector:'h1, h2',text:true}}};
export const detailsProjection = {fields:{top:{selector:'div.manga-info-top',...infoProjection},panel:{selector:'div.panel-story-info',...infoProjection},
  image:{selector:'div.manga-info-pic img, span.info-image img',fields:imageFields},description:{selector:'div#noidungm, div#panel-story-info-description, div#contentBox',text:true},
  alternative:{selector:'.story-alternative',text:true},items:{selector:'div.manga-info-top li',all:true,fields:{text:{text:true},links:{selector:'a',all:true,text:true}}},
  rows:{selector:'table tr',all:true,fields:{cells:{selector:'td',all:true,fields:{text:{text:true},links:{selector:'a',all:true,text:true}}}}}}};
function tableText(rows,label) {
  for (const row of rows) {
    const cells = requireArray(row.cells,'MangaBox cells'); if (cells.length < 2 || !normalizeText(cells[0].text).toLowerCase().includes(label)) continue;
    const value = cells.slice(1).map(cell => normalizeText(cell.text)).filter(Boolean).join(', '); if (value) return value;
  }
  return null;
}
export function parseDetails(input,id,base,realUrl) {
  const root = requireRecord(input,'MangaBox details'), title = string(normalizeText(record(root.top ?? root.panel).title));
  if (!title) throw parseError('Mangakakalot title is missing.');
  const items = requireArray(root.items,'MangaBox info'), rows = requireArray(root.rows,'MangaBox table');
  const links = label => [...new Set([
    ...items.filter(item => normalizeText(item.text).toLowerCase().includes(label)).flatMap(item => item.links),
    ...rows.filter(row => normalizeText(record(row.cells?.[0]).text).toLowerCase().includes(label)).flatMap(row => row.cells.slice(1).flatMap(cell => cell.links)),
  ].map(normalizeText).filter(Boolean))];
  const authors = links('author'), status = normalizeText(tableText(rows,'status') ?? items.find(item => normalizeText(item.text).toLowerCase().includes('status'))?.text).toLowerCase();
  const description = normalizeText(root.description).replace(/^\s*.+?\s+summary:\s*/iu,'');
  const secondary = string(normalizeText(root.alternative ?? tableText(rows,'alternative')));
  return manga({id:mangaId(realUrl) ?? id,title,coverUrl:resolveImage(root.image,base),description:!description || description === '-' ? null : description,
    secondaryTitle:secondary === title ? null : secondary,author:authors.join(', ') || null,artist:authors.join(', ') || null,
    status:status.includes('ongoing') ? 'ongoing' : status.includes('completed') ? 'completed' : status.includes('drop') ? 'dropped' : null,tags:links('genres')});
}
export function parseChapters(input,id) {
  const payload = requireRecord(input,'MangaBox chapter response'); if (payload.success !== true) return [];
  return requireArray(record(payload.data).chapters ?? [],'MangaBox chapters').map(value => {
    const row = requireRecord(value,'MangaBox chapter'), slug = string(row.chapter_slug == null ? null : String(row.chapter_slug));
    if (!slug) throw parseError('Mangakakalot chapter slug is missing.');
    const title = string(normalizeText(row.chapter_name == null ? null : String(row.chapter_name))) ?? 'Chapter';
    return chapter({id:`/manga/${id}/${slug}`,title,number:finiteNumber(row.chapter_num,finiteNumber(title.match(/(\d+(?:\.\d+)?)/u)?.[1])),uploadedAt:isoDate(row.updated_at)});
  });
}
export const pagesProjection = {fields:{scripts:{selector:'script',all:true,text:true,normalizeWhitespace:false},images:{selector:'div.container-chapter-reader > img',all:true,fields:imageFields}}};
export function parsePages(input,base) {
  const data = requireRecord(input,'MangaBox reader'), script = requireArray(data.scripts,'MangaBox scripts').join('\n');
  function array(name) {
    for (const match of script.matchAll(/([A-Za-z0-9_]+)\s*=\s*\[([^\]]+)\]/gmu)) {
      if (match[1] !== name) continue;
      return match[2].split(',').map(value => value.trim().replaceAll('\\/','/').replace(/^["']|["']$/gu,'').replace(/\/$/u,'')).filter(Boolean);
    }
    return [];
  }
  const cdns = [...array('cdns'),...array('backupImage')], images = array('chapterImages');
  let urls;
  if (cdns.length && images.length) urls = images.map(value => /^https?:\/\//u.test(value) ? value : new URL(value.replace(/^\/+/u,''),`${cdns[0].replace(/\/$/u,'')}/`).href);
  else urls = requireArray(data.images,'MangaBox fallback pages').map(value => resolveImage(value,base)).filter(Boolean);
  if (!urls.length) throw parseError('Mangakakalot pages were not found.');
  return urls.map((imageUrl,index) => ({index,imageUrl}));
}
export default function createMangaKakalot(ctx) {
  let active = 0;
  const base = () => `https://${hosts[active]}`;
  async function request(path,params = {},json = false) {
    let last;
    for (const index of [active,...hosts.map((_,index) => index).filter(index => index !== active)]) {
      const origin = `https://${hosts[index]}`, target = new URL(urlWithQuery(path,origin,params));
      target.protocol = 'https:'; target.hostname = hosts[index]; target.port = '';
      const url = target.href;
      try {
        const response = await ctx.http.request({method:'GET',url,responseType:'text',userAgentProfile:'browser',headers:{
          Accept:json ? 'application/json,text/plain,*/*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9',Origin:origin,Referer:`${origin}/`}});
        active = index;
        if (typeof response.body !== 'string' || !response.body.trim()) throw Object.assign(Error('Empty MangaBox payload.'),{code:'invalid_response',phase:'http'});
        if (json) { try { return requireRecord(JSON.parse(response.body),'MangaBox payload'); } catch { throw parseError('Invalid MangaBox JSON.'); } }
        return response;
      } catch (error) {
        // Never retry cancellation, credentials, challenges, rate limits or a bad parser response on another mirror.
        if (!['network','offline','timeout','not_found'].includes(error.code) && !(error.httpStatus >= 500)) throw error;
        last = error;
      }
    }
    throw last;
  }
  async function html(path,params,projection) { const response = await request(path,params); return {data:await ctx.html.extract(response.body,{...projection,baseUrl:response.url ?? new URL(path,base()).href}),url:response.url ?? new URL(path,base()).href}; }
  const listing = async (path,params) => parseListing((await html(path,params,listingProjection)).data,base());
  return {
    async getFilters() { return buildFilters(); },
    async getPopular({page = 1} = {}) { return listing('/manga-list/hot-manga',{page:Math.max(1,page)}); },
    async getLatest({page = 1} = {}) { return listing('/manga-list/latest-manga',{page:Math.max(1,page)}); },
    async search(query) { const {path,params} = searchPath(query); return listing(path,params); },
    async getDetails({mangaId:id}) { const page = await html(`/manga/${id}`,{},detailsProjection); return parseDetails(page.data,id,base(),page.url); },
    async getChapters({mangaId:id}) { return parseChapters(await request(`/api/manga/${id}/chapters`,{limit:'-1'},true),id); },
    async getPages({chapterId:id}) { return parsePages((await html(id,{},pagesProjection)).data,base()); },
  };
}
