import {compareText, filter, manga, record, records, string} from '../core/data.mjs';
import {finiteNumber, requireArray, requireRecord, urlWithQuery} from '../core/http.mjs';

const sortOptions = [['popularity','Popularity'],['aired_on','Latest'],['ranked','Ranked'],['chapters','Chapters'],
  ['volumes','Volumes'],['status','Status'],['kind','Type'],['name','Title'],['random','Random']];
const kindOptions = [['manga','Manga'],['manhwa','Manhwa'],['manhua','Manhua'],['one_shot','One shot'],['doujin','Doujinshi']];
const statusOptions = [['ongoing','Publishing'],['released','Finished'],['paused','On hiatus'],['discontinued','Discontinued']];
const posterFields = 'poster { originalUrl mainUrl previewUrl }';
const catalogFields = `id name russian kind status score airedOn {year} ${posterFields}`;
const catalogQuery = `query MangaCatalog($page:PositiveInt!,$order:OrderEnum!,$search:String,$kind:MangaKindString,$status:MangaStatusString,$genre:String) {
  mangas(page:$page,limit:24,order:$order,search:$search,kind:$kind,status:$status,genre:$genre) { ${catalogFields} } }`;
const detailsQuery = `query MangaDetails($ids:String!) { mangas(ids:$ids,limit:1) { ${catalogFields} english japanese synonyms description genres {name russian} } }`;
function candidates(item, keys) {
  return keys.flatMap(key => Array.isArray(item[key]) ? item[key] : [item[key]]).map(string).filter(Boolean);
}
export function parseManga(value) {
  const item = requireRecord(value,'Shikimori manga');
  const title = candidates(item,['russian','english','name','japanese'])[0];
  if (item.id == null || !title) return null;
  const rawCover = string(record(item.poster).originalUrl ?? record(item.poster).mainUrl ?? record(item.poster).previewUrl ?? record(item.image).original ?? record(item.image).preview);
  const cover = rawCover && !/\/assets\/globals\/missing_[^/]+$/u.test(new URL(rawCover,'https://shikimori.io').pathname) ? rawCover : null;
  const score = finiteNumber(item.score,null);
  const kind = string(item.kind);
  return manga({id:String(item.id),title,
    coverUrl:cover ? new URL(cover,'https://shikimori.io').href : null,
    description:string(item.description),
    secondaryTitle:candidates(item,['english','name','japanese','synonyms']).find(value => value !== title) ?? null,
    status:string(item.status),type:kind ? kind.split('_').map(part => part ? part[0].toUpperCase()+part.slice(1) : '').join(' ') : null,
    rating:score,releaseYear:record(item.airedOn).year != null ? String(item.airedOn.year) : typeof item.aired_on === 'string' && item.aired_on.trim().length >= 4 ? item.aired_on.trim().slice(0,4) : null,
    tags:records(item.genres).map(item => string(item.russian ?? item.name)).filter(Boolean)});
}

export default function createShikimori(ctx) {
  let genres = null;
  async function json(path, query = {}) {
    const response = await ctx.http.request({method:'GET',url:urlWithQuery(`/api/${path}`,'https://shikimori.io',query),
      responseType:'json',headers:{Accept:'application/json'}});
    return response.body;
  }
  async function withPosters(input) {
    const rows = requireArray(input,'Shikimori mangas');
    if (!rows.length) return [];
    const ids = [...new Set(rows.map(row => String(requireRecord(row,'Shikimori manga').id ?? '')).filter(id => /^\d+$/u.test(id)))];
    if (!ids.length) return rows.map(parseManga).filter(Boolean);
    // REST-only orderings and recommendations retain their order, with one
    // poster batch for the complete page rather than one request per title.
    const posters = new Map((await graph(`query MangaPosters($ids:String!,$limit:PositiveInt!) { mangas(ids:$ids,limit:$limit) { id ${posterFields} } }`,{ids:ids.join(','),limit:ids.length}))
      .map(row => { const item = requireRecord(row,'Shikimori poster'); return [String(item.id),item.poster]; }));
    return rows.map(row => parseManga({...row,poster:posters.get(String(row.id))})).filter(Boolean);
  }
  async function graph(query,variables) {
    const response = await ctx.http.request({method:'POST',url:'https://shikimori.io/api/graphql',responseType:'json',headers:{Accept:'application/json','Content-Type':'application/json'},body:{query,variables}});
    const root = requireRecord(response.body,'Shikimori GraphQL response');
    if (Array.isArray(root.errors) && root.errors.length) throw Object.assign(new Error('Shikimori GraphQL query failed'),{code:'invalid_response',phase:'graphql'});
    return requireArray(requireRecord(root.data,'Shikimori GraphQL data').mangas,'Shikimori mangas');
  }
  const one = list => Array.isArray(list) ? string(list[0]) : null;
  async function browse({page = 1, order, searchTerm = '', selectedFilters = {}}) {
    const query = {order,page:Math.max(1,page)};
    if (searchTerm.trim()) query.search = searchTerm.trim();
    for (const field of ['kind','status','genre']) {
      const value = one(selectedFilters[field]); if (value) query[field] = value;
    }
    // These two REST orderings are absent from GraphQL's OrderEnum.
    if (order === 'chapters' || order === 'volumes') {
      const {genre,...rest} = query;
      return withPosters(requireArray(await json('mangas',{...rest,limit:24,...(genre ? {genre_v2:genre} : {})}),'Shikimori catalog'));
    }
    return (await graph(catalogQuery,query)).map(parseManga).filter(Boolean);
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
      return [{...filter('sort','sort','Sort',sortOptions),supportsDirection:false},filter('singleSelect','kind','Type',kindOptions),
        filter('singleSelect','status','Status',statusOptions),filter('singleSelect','genre','Genre',genres)];
    },
    async getPopular({page = 1} = {}) { return browse({page,order:'popularity'}); },
    async getLatest({page = 1} = {}) { return browse({page,order:'aired_on'}); },
    async search(query) {
      return browse({...query,order:one(query.selectedFilters?.sort)?.split(':')[0].trim() || 'popularity'});
    },
    async getDetails({mangaId}) {
      if (!/^\d+$/u.test(mangaId)) throw Object.assign(new Error('Shikimori manga ID is invalid'),{code:'parse_error'});
      const [item] = (await graph(detailsQuery,{ids:mangaId})).map(parseManga).filter(Boolean);
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
      const items = (await withPosters(all.slice(start,start+24))).filter(item => !seen.has(item.id) && seen.add(item.id));
      return {items,page:normalized,hasNextPage:start+24 < all.length};
    },
  };
}
