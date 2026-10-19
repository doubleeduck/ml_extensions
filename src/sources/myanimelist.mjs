import {filter, manga, normalizeText, parseError, record, records, string} from '../core/data.mjs';
import {finiteNumber, requireArray, requireRecord, urlWithQuery} from '../core/http.mjs';

const api = 'https://api.myanimelist.net/v2', site = 'https://myanimelist.net';
const searchFields = 'id,title,synopsis,main_picture,alternative_titles,media_type,status,start_date,genres,mean,nsfw';
const rankingOptions = [['all','All'],['bypopularity','Popularity'],['favorite','Favourites'],['manga','Manga'],
  ['novels','Novels'],['oneshots','One shots'],['doujin','Doujinshi'],['manhwa','Manhwa'],['manhua','Manhua']];
const typeOptions = [['manga|1','Manga'],['one_shot|3','One shot'],['doujinshi|4','Doujinshi'],['light_novel|2','Light novel'],
  ['novel|8','Novel'],['manhwa|5','Manhwa'],['manhua|6','Manhua']];
const statusOptions = [['currently_publishing|1','Publishing'],['finished|2','Finished'],['on_hiatus|4','On hiatus'],
  ['discontinued|5','Discontinued'],['not_yet_published|3','Not yet published']];
const values = input => (Array.isArray(input) ? input : []).map(value => value.trim()).filter(Boolean);
const selected = (filters,key) => values(filters[key])[0] ?? null;
const displayType = input => string(input)?.split('_').map(part => part ? part[0].toUpperCase()+part.slice(1) : '').join(' ') ?? null;
const displayStatus = input => ({currently_publishing:'ongoing',finished:'completed',on_hiatus:'hiatus',
  discontinued:'cancelled',not_yet_published:'not yet released'}[input] ?? string(input));
const first = (list, excluding = null) => list.map(string).find(value => value && value !== excluding) ?? null;
function contributors(item,role) {
  return [...new Set(records(item.authors).filter(author => string(author.role) === role)
    .map(author => `${string(author.first_name) ?? ''} ${string(author.last_name) ?? ''}`.trim()).filter(Boolean))].join(', ') || null;
}
export function parseManga(input) {
  const item = requireRecord(input,'MyAnimeList manga'), title = string(item.title);
  if (item.id == null || !title) return null;
  const alternatives = record(item.alternative_titles), picture = record(item.main_picture);
  const nsfw = string(item.nsfw)?.toLowerCase(), date = string(item.start_date);
  return manga({id:String(item.id),title,coverUrl:string(picture.large ?? picture.medium),description:string(item.synopsis),
    secondaryTitle:first([alternatives.en,alternatives.ja,...(Array.isArray(alternatives.synonyms) ? alternatives.synonyms : [])],title),
    author:contributors(item,'Story'),artist:contributors(item,'Art'),status:displayStatus(item.status),type:displayType(item.media_type),
    ageRating:!nsfw || nsfw === 'white' ? null : '18+',rating:finiteNumber(item.mean,null),
    releaseYear:date && date.length >= 4 ? date.slice(0,4) : null,
    tags:records(item.genres).map(genre => string(genre.name)).filter(Boolean)});
}
const imageProjection = {selector:'img',fields:{dataSrc:{attr:'data-src'},dataSet:{attr:'data-srcset'},src:{attr:'src'},srcSet:{attr:'srcset'}}};
export const browseProjection = {fields:{
  tiles:{selector:'.seasonal-anime.js-seasonal-anime',all:true,fields:{
    href:{selector:'h2.h2_manga_title a.link-title',attr:'href'},title:{selector:'h2.h2_manga_title a.link-title',text:true},
    info:{selector:'.prodsrc .item',all:true,text:true},publishing:{selector:'.prodsrc .item.publishing',text:true},
    synopsis1:{selector:'.synopsis .preline',text:true},synopsis2:{selector:'.synopsis',text:true},
    synopsis3:{selector:'.information .synopsis',text:true},genres:{selector:'.genres a',all:true,text:true},image:imageProjection}},
  rows:{selector:'table tbody tr',all:true,fields:{links:{selector:'a[href*="/manga/"]',all:true,fields:{href:{attr:'href'},title:{text:true}}},
    description:{selector:'td:nth-child(2)',text:true},type:{selector:'td:nth-child(3)',text:true},
    rating:{selector:'td:last-child',text:true},image:imageProjection}},
}};
function cover(input) {
  const image = record(input);
  const fromSet = value => string(value)?.split(',')[0].trim().split(/\s+/u)[0] ?? null;
  const candidate = first([image.dataSrc,fromSet(image.dataSet),image.src,fromSet(image.srcSet)]);
  return candidate ? new URL(candidate,site).href : null;
}
export function parseBrowse(input) {
  const data = requireRecord(input,'MyAnimeList HTML catalog');
  const tiles = requireArray(data.tiles,'MyAnimeList tiles').map(value => {
    const item = requireRecord(value,'MyAnimeList tile'), id = string(item.href)?.match(/\/manga\/(\d+)/u)?.[1];
    const title = string(item.title); if (!id || !title) return null;
    const info = requireArray(item.info,'MyAnimeList tile metadata').map(string).filter(Boolean), typeAndYear = info[0];
    return manga({id,title,coverUrl:cover(item.image),description:first([item.synopsis1,item.synopsis2,item.synopsis3]),
      status:first([item.publishing,info[1]]),type:string(typeAndYear?.split(',')[0]),
      releaseYear:typeAndYear?.match(/\b(?:19|20)\d{2}\b/u)?.[0] ?? null,tags:requireArray(item.genres,'MyAnimeList tile genres').map(string).filter(Boolean)});
  }).filter(Boolean);
  if (tiles.length) return tiles;
  return requireArray(data.rows,'MyAnimeList search rows').map(value => {
    const item = requireRecord(value,'MyAnimeList row'), links = requireArray(item.links,'MyAnimeList links');
    const link = links.find(value => string(record(value).title)) ?? links[0], id = string(record(link).href)?.match(/\/manga\/(\d+)/u)?.[1];
    const title = string(record(link).title); if (!id || !title) return null;
    const text = string(item.description), description = text?.startsWith(title) ? string(text.slice(title.length)) : text;
    return manga({id,title,coverUrl:cover(item.image),description,type:string(item.type),rating:finiteNumber(item.rating,null)});
  }).filter(Boolean);
}
export function browseUrl({page = 1,searchTerm = '',selectedFilters = {}}) {
  const query = {};
  if (page > 1) query.show = (page-1)*50;
  if (searchTerm.trim()) query.q = searchTerm.trim();
  for (const key of ['type','status']) {
    const value = string(selected(selectedFilters,key)?.split('|')[1]); if (value) query[key] = value;
  }
  const genres = values(selectedFilters.genre); if (genres.length) query['genre[]'] = genres;
  return urlWithQuery('/manga.php',site,query);
}

export default function createMyAnimeList(ctx) {
  let genres = null;
  async function json(path, query) {
    // X-MAL-CLIENT-ID is app-owned configuration. The host inserts it only for
    // this source's approved API endpoint, never from arbitrary JS headers.
    const response = await ctx.http.request({method:'GET',url:urlWithQuery(`${api}/${path}`,api,query),
      responseType:'json',headers:{Accept:'application/json'}});
    return requireRecord(response.body,'MyAnimeList response');
  }
  async function html(url, projection) {
    const response = await ctx.http.request({method:'GET',url,responseType:'text',headers:{Accept:'text/html,application/xhtml+xml'}});
    return ctx.html.extract(response.body,{baseUrl:response.url,...projection});
  }
  const nodes = body => requireArray(body.data,'MyAnimeList data').map(value => parseManga(requireRecord(value,'MyAnimeList list node').node)).filter(Boolean);
  async function ranking(page, type) {
    const query = {ranking_type:type,limit:24,offset:Math.max(0,page-1)*24};
    try {
      const items = nodes(await json('manga/ranking',{...query,fields:searchFields}));
      if (items.length || page > 1) return items;
    } catch (error) {
      if (!['network','offline','timeout'].includes(error.code) && ![400,500,502,503,504].includes(error.httpStatus)) throw error;
    }
    return nodes(await json('manga/ranking',query));
  }
  return {
    async getFilters({refresh = false} = {}) {
      if (genres === null || refresh) {
        const entries = requireArray(await html(`${site}/manga.php`,{selector:'[name="genre[]"]',all:true,
          fields:{value:{attr:'value'},label:{ascend:1,text:true}}}),'MyAnimeList genre controls');
        const seen = new Set();
        genres = entries.map(value => { const item = requireRecord(value,'MyAnimeList genre');
          return [string(item.value),string(item.label)?.replace(/\s*\(\d[\d,]*\)\s*$/u,'')]; })
          .filter(([id,label]) => id && label && !seen.has(id) && seen.add(id));
      }
      const sort = filter('sort','ranking','Sort',rankingOptions); sort.caption = 'Used when browsing without a search query.';
      return [sort,filter('singleSelect','type','Type',typeOptions),filter('singleSelect','status','Status',statusOptions),
        filter('multiSelect','genre','Genres',genres)];
    },
    async getPopular({page = 1} = {}) { return ranking(Math.max(1,page),'bypopularity'); },
    async getLatest({page = 1} = {}) { return ranking(Math.max(1,page),'all'); },
    async search(query) {
      const filters = query.selectedFilters ?? {}, term = query.searchTerm.trim(), page = Math.max(1,query.page ?? 1);
      if (['type','status','genre'].some(key => values(filters[key]).length)) return parseBrowse(await html(browseUrl(query),browseProjection));
      if (!term) return ranking(page,selected(filters,'ranking')?.split(':')[0].trim() || 'all');
      return nodes(await json('manga',{q:term.slice(0,64),limit:24,offset:(page-1)*24,fields:searchFields}));
    },
    async getDetails({mangaId}) {
      const item = parseManga(await json(`manga/${encodeURIComponent(mangaId)}`,{fields:`${searchFields},recommendations`}));
      if (!item) throw parseError('MyAnimeList title is missing'); return item;
    },
    async getChapters() { return []; },
    async getPages() { throw parseError('MyAnimeList titles do not provide chapters for reading'); },
    async getRecommendations({mangaId,page = 1}) {
      const normalized = Math.max(1,page); if (normalized > 1) return {items:[],page:normalized,hasNextPage:false};
      const entries = requireArray(await html(`${site}/manga/${encodeURIComponent(mangaId)}`,
        {selector:'#manga_recommendation li.btn-anime',all:true,fields:{title:{attr:'title'},label:{selector:'.title',text:true},
          href:{selector:'a[href*="/recommendations/manga/"]',attr:'href'},image:imageProjection}}),'MyAnimeList recommendations');
      const seen = new Set([mangaId]);
      const items = entries.map(value => {const item = requireRecord(value,'MyAnimeList recommendation');
        const id = string(item.href)?.match(/\/recommendations\/manga\/\d+-(\d+)/u)?.[1], title = normalizeText(item.title ?? item.label);
        if (!id || !title || seen.has(id)) return null; seen.add(id);
        return manga({id,title,coverUrl:cover(item.image)});}).filter(Boolean);
      return {items,page:normalized,hasNextPage:false};
    },
  };
}
