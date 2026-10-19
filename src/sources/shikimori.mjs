import {compareText, filter, manga, record, records, string} from '../core/data.mjs';
import {finiteNumber, requireArray, requireRecord, urlWithQuery} from '../core/http.mjs';

const sortOptions = [['popularity','Popularity'],['aired_on','Latest'],['ranked','Ranked'],['chapters','Chapters'],
  ['volumes','Volumes'],['status','Status'],['kind','Type'],['name','Title'],['random','Random']];
const kindOptions = [['manga','Manga'],['manhwa','Manhwa'],['manhua','Manhua'],['one_shot','One shot'],['doujin','Doujinshi']];
const statusOptions = [['ongoing','Publishing'],['released','Finished'],['paused','On hiatus'],['discontinued','Discontinued']];
function candidates(item, keys) {
  return keys.flatMap(key => Array.isArray(item[key]) ? item[key] : [item[key]]).map(string).filter(Boolean);
}
export function parseManga(value) {
  const item = requireRecord(value,'Shikimori manga');
  const title = candidates(item,['russian','english','name','japanese'])[0];
  if (item.id == null || !title) return null;
  const cover = string(record(item.image).original ?? record(item.image).preview);
  const score = finiteNumber(item.score,null);
  const kind = string(item.kind);
  return manga({id:String(item.id),title,
    coverUrl:cover ? new URL(cover,'https://shikimori.io').href : null,
    description:string(item.description),
    secondaryTitle:candidates(item,['english','name','japanese','synonyms']).find(value => value !== title) ?? null,
    status:string(item.status),type:kind ? kind.split('_').map(part => part ? part[0].toUpperCase()+part.slice(1) : '').join(' ') : null,
    rating:score,releaseYear:typeof item.aired_on === 'string' && item.aired_on.trim().length >= 4 ? item.aired_on.trim().slice(0,4) : null,
    tags:records(item.genres).map(item => string(item.russian ?? item.name)).filter(Boolean)});
}

export default function createShikimori(ctx) {
  let genres = null;
  async function json(path, query = {}) {
    const response = await ctx.http.request({method:'GET',url:urlWithQuery(`/api/${path}`,'https://shikimori.io',query),
      responseType:'json',headers:{Accept:'application/json'}});
    return response.body;
  }
  const one = list => Array.isArray(list) ? string(list[0]) : null;
  async function browse({page = 1, order, searchTerm = '', selectedFilters = {}}) {
    const query = {order,page:Math.max(1,page),limit:24};
    if (searchTerm.trim()) query.search = searchTerm.trim();
    for (const [field,parameter] of [['kind','kind'],['status','status'],['genre','genre_v2']]) {
      const value = one(selectedFilters[field]); if (value) query[parameter] = value;
    }
    return requireArray(await json('mangas',query),'Shikimori catalog').map(parseManga).filter(Boolean);
  }
  return {
    async getFilters({refresh = false} = {}) {
      if (genres === null || refresh) {
        const seen = new Set();
        genres = records(requireArray(await json('genres'),'genres'))
          .filter(item => string(item.entry_type)?.toLowerCase() === 'manga')
          .map(item => [item.id == null ? '' : String(item.id).trim(),string(item.russian ?? item.name)])
          .filter(([id,label]) => id && label && !seen.has(id) && seen.add(id))
          .sort((left,right) => compareText(left[1].toLowerCase(),right[1].toLowerCase()));
      }
      return [filter('sort','sort','Sort',sortOptions),filter('singleSelect','kind','Type',kindOptions),
        filter('singleSelect','status','Status',statusOptions),filter('singleSelect','genre','Genre',genres)];
    },
    async getPopular({page = 1} = {}) { return browse({page,order:'popularity'}); },
    async getLatest({page = 1} = {}) { return browse({page,order:'aired_on'}); },
    async search(query) {
      return browse({...query,order:one(query.selectedFilters?.sort)?.split(':')[0].trim() || 'popularity'});
    },
    async getDetails({mangaId}) {
      const item = parseManga(await json(`mangas/${encodeURIComponent(mangaId)}`));
      if (!item) throw Object.assign(new Error('Shikimori title is missing'),{code:'parse_error'});
      return item;
    },
    // This is a metadata-only catalog, not a readable source with fake chapters.
    async getChapters() { return []; },
    async getPages() { throw Object.assign(new Error('Shikimori titles do not provide chapters for reading'),{code:'parse_error'}); },
    async getRecommendations({mangaId,page = 1}) {
      const normalized = Math.max(1,page), start = (normalized-1)*24;
      const all = requireArray(await json(`mangas/${encodeURIComponent(mangaId)}/similar`),'recommendations');
      const seen = new Set([mangaId]);
      const items = all.slice(start,start+24).map(parseManga).filter(item => item && !seen.has(item.id) && seen.add(item.id));
      return {items,page:normalized,hasNextPage:start+24 < all.length};
    },
  };
}
