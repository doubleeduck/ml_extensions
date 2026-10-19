// Fictional endpoint contract for the SDK fixture, not a working website parser.
// No Node imports or module-scope account state. Factory creation performs no IO.
const invalid = () => Object.assign(Error('Unexpected example API shape.'),{code:'parse_error',phase:'parse'});
const array = value => { if (!Array.isArray(value)) throw invalid(); return value; };
const text = value => { if (typeof value !== 'string' || !value.trim()) throw invalid(); return value; };
const manga = row => ({id:text(row.id),title:text(row.title),coverUrl:row.cover ?? null,description:row.description ?? null,
  secondaryTitle:null,author:row.author ?? null,artist:row.artist ?? null,status:null,type:null,ageRating:null,rating:null,
  releaseYear:null,pageCount:null,languageFlagUrl:null,tags:array(row.tags ?? [])});
export default function createSource(ctx) {
  async function get(path,query = {}) {
    const url = new URL(path,ctx.baseUrl);
    for (const [key,value] of Object.entries(query)) if (value !== '') url.searchParams.set(key,String(value));
    return (await ctx.http.request({method:'GET',url:url.href,responseType:'json'})).body;
  }
  const list = async (sort,page,query = '') => array((await get('/api/titles',{sort,page,q:query})).items).map(manga);
  return {
    async getPopular({page = 1} = {}) { return list('popular',page); },
    async getLatest({page = 1} = {}) { return list('latest',page); },
    async search({searchTerm = '',page = 1} = {}) { return list('relevance',page,searchTerm); },
    async getFilters() { return []; },
    async getDetails({mangaId}) { return manga(await get(`/api/titles/${encodeURIComponent(mangaId)}`)); },
    async getChapters({mangaId}) {
      return array((await get(`/api/titles/${encodeURIComponent(mangaId)}/chapters`)).items).map(row => {
        if (!Number.isFinite(row.number)) throw invalid();
        return {id:text(row.id),title:text(row.title),number:row.number,uploadedAt:row.uploadedAt ?? null,
          access:{type:'available',availableAt:null,priceLabel:null,message:null}};
      });
    },
    async getPages({chapterId}) {
      return array((await get(`/api/chapters/${encodeURIComponent(chapterId)}/pages`)).images)
        .map((imageUrl,index) => ({index,imageUrl:text(imageUrl)}));
    },
  };
}
