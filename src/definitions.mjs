/** Signed, declarative registrations. IDs are the existing persistent app IDs. */
const browse = ['browse','latest','search','filters'];
const origin = host => `https://${host}`;
const sourceBranding = {
  "astramanga": {"icon":"assets/source_logos/astramanga.png","accentColor":"#8B5CF6"},
  "comx": {"icon":"assets/source_logos/comx.png","accentColor":"#E5484D"},
  "inkstory": {
    "icon": "assets/source_logos/inkstory.png",
    "accentColor": "#2979EF"
  },
  "mangadex": {
    "icon": "assets/source_logos/mangadex.png",
    "accentColor": "#FF6740"
  },
  "mangalib": {
    "icon": "assets/source_logos/mangalib.png",
    "accentColor": "#32B09B"
  },
  "remanga": {
    "icon": "assets/source_logos/remanga.png",
    "accentColor": "#3C83F6"
  },
  "readmanga": {
    "icon": "assets/source_logos/readmanga.png",
    "accentColor": "#EF6A6A"
  },
  "mintmanga": {
    "icon": "assets/source_logos/mintmanga.png",
    "accentColor": "#7CC173"
  },
  "seimanga": {
    "icon": "assets/source_logos/seimanga.png",
    "accentColor": "#F06D8E"
  },
  "selfmanga": {
    "icon": "assets/source_logos/selfmanga.png",
    "accentColor": "#6C86F2"
  },
  "usagi": {
    "icon": "assets/source_logos/usagi.png",
    "accentColor": "#B76CE3"
  },
  "rumix": {
    "icon": "assets/source_logos/rumix.png",
    "accentColor": "#4FA3E6"
  },
  "senkuro": {
    "icon": "assets/source_logos/senkuro.png",
    "accentColor": "#6A8AF6"
  },
  "mangafox": {
    "icon": "assets/source_logos/mangafox.png",
    "accentColor": "#F59B42"
  },
  "mangakakalot": {
    "icon": "assets/source_logos/mangakakalot.png",
    "accentColor": "#F48A46"
  },
  "weebcentral": {
    "icon": "assets/source_logos/weebcentral.png",
    "accentColor": "#4EA2FF"
  },
  "mangachan": {
    "icon": "assets/source_logos/mangachan.png",
    "accentColor": "#EE6F2D"
  },
  "mangashi": {
    "icon": "assets/source_logos/mangashi.png",
    "accentColor": "#E5484D"
  },
  "desu": {
    "icon": "assets/source_logos/desu.png",
    "accentColor": "#176093"
  },
  "shikimori": {
    "icon": "assets/source_logos/shikimori.png",
    "accentColor": "#4B7FAA"
  },
  "anilist": {
    "icon": "assets/source_logos/anilist.png",
    "accentColor": "#3DB4F2"
  },
  "myanimelist": {
    "icon": "assets/source_logos/myanimelist.png",
    "accentColor": "#2E51A2"
  }
};
function source(id,name,host,module,extra = {}) {
  const base = origin(host), {origins = [],images = [],auth = null,recommendations = false,custom = false,refresh = false,
    template = '/{id}',encoding = 'pathSegment',idPart,capabilities = browse,parameters = {},settings,metadataOnly = false,bindings = {},nsfw = false,media = {},network = {}} = extra;
  return {id,name,language:id.split('.')[0],baseUrl:base,engine:extra.engine ?? 'Handwritten JS',status:'experimental',isNsfw:nsfw,
    branding:sourceBranding[id.split('.').at(-1)],
    supportsCustomBaseUrl:custom,supportsFilterRefresh:refresh,capabilities:[...capabilities,...(recommendations ? ['recommendations'] : []),...(auth ? ['account'] : [])],
    features:{webLinks:true,auth:auth != null,authCompletion:auth?.completionUrl != null,recommendations},
    web:{mangaUrlTemplate:template,idEncoding:encoding,...(idPart ? {idPart} : {})},parameters,
    filterBindings:bindings,metadataOnly,...(extra.presentation ? {presentation:extra.presentation} : {}),...(settings ? {settings} : {}),...(auth ? {auth} : {}),
    network:{origins:[base,...origins].filter((value,index,all) => all.indexOf(value) === index),imageOrigins:[base,...images].filter((value,index,all) => all.indexOf(value) === index),
      authOrigins:auth?.cookieOrigins ?? [base],allowSubdomains:true,methods:['GET','POST','HEAD'],maxConcurrentRequests:6,...network},
    media:{userAgentProfile:'browser',refererOrigin:base,sendOrigin:false,...media},
    // Build-only dispatcher mapping; not a source-manifest property.
    _module:module};
}
const cookieAuth = (host,login = '/login/') => ({profileId:'host.cookie.v1',loginUrl:new URL(login,origin(host)).href,
  cookieOrigins:[origin(host)],sessionExport:{headers:['Cookie'],values:[]}});
const libApis = ['api.cdnlibs.org','api2.mangalib.me','hapi.hentaicdn.org','api.imglib.info'].map(origin);
// Cookie Domain roots are explicit grants, not shared cookie jars. Every
// instance still receives only the browser/HTTP session belonging to its ID.
const libCookieRoots = ['cdnlibs.org','mangalib.me','hentaicdn.org','imglib.info'].map(origin);
const libImages = ['mixlib.me','imglib.info','mangalib.me','hentaicdn.org','cdnlib.org','cdnlibs.org','mangalib.org','mangalib.net'].map(origin);
const enumSetting = (key,label,options,value) => ({key,label,type:'enum',default:value,options:options.map(([value,label]) => ({value,label}))});
const titleLanguage = enumSetting('titleLanguage','Язык названия',[['eng','Английский'],['rus','Русский']],'eng');
const libSettings = {version:1,legacyNamespace:'libgroup',roles:{titleLanguage:'titleLanguage'},fields:[titleLanguage,
  enumSetting('chapterMode','Ветки перевода',[['ms_mixing','Основная'],['ms_combining','Все ветки']],'ms_mixing'),
  {key:'showAlternativeBranchSource',label:'Показывать загрузившего, если нет команды',type:'boolean',default:false},
  enumSetting('imageServer','Сервер изображений',[['auto','Автоматически'],['main','Основной'],['secondary','Дополнительный'],['compress','Сжатые изображения']],'compress'),
  enumSetting('apiDomain','API сервер',libApis.map(url => [url,new URL(url).host]),'https://api2.mangalib.me')]};
const libgroup = (id,name,host,siteId,nsfw = false) => source(id,name,host,'engines/libgroup.mjs',{engine:'LibGroup JS',nsfw,refresh:true,recommendations:true,
  parameters:{siteId:String(siteId)},settings:libSettings,origins:libApis,images:libImages,
  auth:{...cookieAuth(host,'/ru'),profileId:'host.session.v1',rules:{bearer:true,cookieAll:['XSRF-TOKEN','mangalib_session','remember_web_*'],tokenStorageKeys:['auth'],tokenPath:['token','access_token'],tokenTypePath:['token','token_type'],tokenType:'bearer'},cookieOrigins:[...new Set([origin(host),...libApis,...libCookieRoots])],sessionExport:{headers:['Cookie','Authorization','X-XSRF-TOKEN'],values:['accessToken','csrfToken']}},
  template:'/ru/manga/{id}',bindings:{author:'authors',artist:'artists',tags:'tags'},media:{sendOrigin:true}});
const groupleCookieRoots = {'a.zazaza.me':'zazaza.me','2.mintmanga.one':'mintmanga.one','1.seimanga.me':'seimanga.me','1.selfmanga.live':'selfmanga.live'};
const grouple = (id,name,host,nsfw = false) => {
  const authOrigin = 'https://3.grouple.co';
  const login = new URL('/internal/auth/login',authOrigin);
  return source(id,name,host,'engines/grouple.mjs',{engine:'GroupLe JS',nsfw,custom:true,refresh:true,recommendations:true,
  template:'/{id}',encoding:'path',settings:{version:1,legacyNamespace:'libgroup',roles:{titleLanguage:'titleLanguage'},fields:[titleLanguage]},
  auth:{...cookieAuth(host),profileId:'host.session.v1',rules:{cookieAll:['remember_me'],tokenStorageKeys:['gwt']},loginUrl:login.href,cookieOrigins:[origin(host),...(groupleCookieRoots[host] ? [origin(groupleCookieRoots[host])] : []),authOrigin,'https://grouple.co'],completionUrl:origin(host),successUrl:`${authOrigin}/`,sessionExport:{headers:['Cookie'],values:[]}},
  origins:[authOrigin],images:['https://one-way.work','https://manga1.ru','https://manga2.ru','https://manga3.ru','https://mangap.ru','https://mangapoisk.org','https://readmanga.io'],media:{sendOrigin:true}});
};
const senkuro = () => {
  const host = 'senkuro.me', api = 'api.senkuro.me';
  return source('ru.senkuro','Senkuro',host,'engines/senkuro.mjs',{engine:'Senkuro GraphQL JS',nsfw:false,refresh:true,recommendations:true,
    capabilities:['browse','latest','search','filters'],origins:[origin(api)],images:['https://senkuro.me','https://senkuro.com','https://senkognito.com','https://senkuro.net'],
    auth:{...cookieAuth(host,'/'),profileId:'host.session.v1',rules:{bearer:true,tokenStorageKeys:['auth','token','accessToken','access_token'],tokenFields:['access_token','accessToken','token','jwt']},cookieOrigins:[origin(host),origin(api)],sessionExport:{headers:['Cookie','Authorization'],values:['accessToken']}},
    template:'/manga/{id}',idPart:{separator:',,',index:1}});
};
const metadata = (id,name,host,module,extra = {}) => source(id,name,host,module,{...extra,metadataOnly:true,recommendations:true,auth:cookieAuth(host,extra.login ?? '/login'),template:extra.template ?? '/manga/{id}'});
export const registrations = [
  source('ru.astramanga','AstraManga','astramanga.org','sources/astramanga.mjs',{engine:'AstraManga API/SSR JS',custom:true,refresh:true,recommendations:true,
    origins:['https://api.astramanga.org'],images:['https://img.astramanga.org'],parameters:{apiBaseUrl:'https://api.astramanga.org'},template:'/manga/{id}',bindings:{tags:'genres'},
    network:{transportProfile:'host.platform.v1'},auth:{profileId:'host.cookie.v1',loginUrl:'https://astramanga.org/',cookieOrigins:['https://astramanga.org','https://api.astramanga.org'],rules:{cookieAll:['access_token']},sessionExport:{headers:['Cookie'],values:[]}}}),
  source('ru.comx','Com-X','com-x.life','sources/comx.mjs',{engine:'Com-X HTML/JSON JS',custom:true,refresh:true,recommendations:true,
    images:['https://img.com-x.life','https://rus.com-x.life'],template:'/{id}-manga.html',bindings:{tags:'g',author:'a',artist:'artist'},network:{transportProfile:'host.platform.v1'},
    auth:{profileId:'host.cookie.v1',loginUrl:'https://com-x.life/',cookieOrigins:['https://com-x.life','https://img.com-x.life','https://rus.com-x.life'],rules:{cookieAll:['dle_user_id','dle_password']},sessionExport:{headers:['Cookie'],values:[]}},
    settings:{version:1,fields:[enumSetting('imageServer','Сервер изображений',[['auto','Автоматически'],['global','Основной'],['ru','Для России']],'auto')]}}),
  source('ru.inkstory','InkStory','inkstory.net','sources/inkstory.mjs',{engine:'InkStory API/HTML JS',custom:true,refresh:true,recommendations:true,
    template:'/{id}',encoding:'path',origins:['https://api.inuko.me'],images:['https://inuko.me','https://inkstory.net'],bindings:{tags:'genre'},media:{transform:{algorithm:'xor',origin:'https://static.inuko.me',pathPrefix:'/chapters/',stemLength:36,markerOffset:14,marker:'x',key:[85,121,83,107,112,48,66,122,80,104,119,108,118,80,50,86]}}}),
  ...['ru','en'].map(language => source(`${language}.mangadex`,'MangaDex','mangadex.org','engines/mangadex.mjs',{engine:'MangaDex API JS',recommendations:true,parameters:{translatedLanguage:language},origins:['https://api.mangadex.org'],images:['https://uploads.mangadex.org','https://mangadex.network'],template:'/title/{id}',bindings:{tags:'tags'}})),
  libgroup('ru.mangalib','MangaLib','mangalib.me',1),
  source('ru.remanga','ReManga','remanga.org','sources/remanga.mjs',{engine:'ReManga API JS',custom:true,refresh:true,recommendations:true,
    parameters:{apiBaseUrl:'https://api.remanga.org'},origins:['https://api.remanga.org'],images:['https://reimg.org','https://reimg2.org'],
    template:'/manga/{id}/main',bindings:{tags:'categories'},
    auth:{profileId:'host.session.v1',loginUrl:'https://remanga.org/',cookieOrigins:['https://remanga.org','https://api.remanga.org'],
      rules:{bearer:true,cookieAll:['auth:token'],tokenCookieNames:['auth:token']},sessionExport:{headers:['Cookie','Authorization'],values:[]}},
    settings:{version:1,fields:[enumSetting('branchMode','Ветки перевода',[['main','Основная'],['all','Все ветки']],'main'),
      enumSetting('imageServer','Сервер изображений',[['original','Автоматически'],['primary','Основной'],['reserve','Резервный']],'original')]}}),
  grouple('ru.readmanga','ReadManga','a.zazaza.me'),grouple('ru.mintmanga','MintManga','2.mintmanga.one'),grouple('ru.seimanga','SeiManga','1.seimanga.me'),
  grouple('ru.selfmanga','SelfManga','1.selfmanga.live'),grouple('ru.usagi','Usagi','a.zazaza.me'),grouple('ru.rumix','RuMIX','rumix.me'),
  senkuro(),
  source('en.mangafox','MangaFox','fanfox.net','sources/mangafox.mjs',{origins:['https://m.fanfox.net'],images:['https://fanfox.net','https://mangafox.me','https://mangafox.la','https://mfcdn.net'],template:'/manga/{id}/',bindings:{author:'author',artist:'artist',tags:'genres'},
    media:{refererOrigin:'https://m.fanfox.net',userAgentProfile:'mobileSafari'},network:{cookieDefaults:[{origin:'https://fanfox.net',name:'isAdult',value:'1'},{origin:'https://m.fanfox.net',name:'isAdult',value:'1'},{origin:'https://m.fanfox.net',name:'readway',value:'2'}]}}),
  source('en.mangakakalot','Mangakakalot','www.mangakakalot.gg','sources/mangakakalot.mjs',{engine:'MangaBox HTML/API JS',origins:['https://mangakakalot.gg','https://www.mangakakalove.com','https://mangakakalove.com'],images:['https://2xstorage.com','https://mangakakalot.gg','https://mangakakalove.com','https://manganelo.com','https://manganato.com'],template:'/manga/{id}',
    // Explicit parent Domain grants for this source's own anti-bot cookies;
    // no account/raw session export and no shared browser jar.
    network:{authOrigins:['https://www.mangakakalot.gg','https://mangakakalot.gg','https://www.mangakakalove.com','https://mangakakalove.com']}}),
  source('en.weebcentral','Weeb Central','weebcentral.com','sources/weebcentral.mjs',{recommendations:true,images:['https://planeptune.us','https://weebcentral.com','https://compsci88.com','https://scans.lastation.us'],template:'/series/{id}',bindings:{author:'author',artist:'author',tags:'tag'}}),
  source('ru.mangachan','MangaChan','im.manga-chan.me','engines/chan.mjs',{recommendations:true,template:'/{id}',encoding:'path',images:['https://manga-chan.me'],network:{authOrigins:['https://im.manga-chan.me','https://manga-chan.me']},bindings:{tags:'genres'}}),
  source('ru.mangashi','MangaShi','manga-shi.org','sources/mangashi.mjs',{refresh:true,recommendations:true,auth:cookieAuth('manga-shi.org'),template:'/{id}',encoding:'path',images:['https://manga-shi.org'],bindings:{tags:'tags'}}),
  source('ru.desu','Desu','desu.uno','sources/desu.mjs',{custom:true,refresh:true,recommendations:true,template:'/{id}',encoding:'path',images:['https://desu.uno','https://desu.me'],bindings:{tags:'genres'}}),
  metadata('ru.shikimori','Shikimori','shikimori.io','sources/shikimori.mjs',{template:'/mangas/{id}',login:'/users/sign_in',images:['https://shikimori.io','https://shikimori.one']}),
  metadata('en.anilist','AniList','anilist.co','sources/anilist.mjs',{origins:['https://graphql.anilist.co'],images:['https://anilist.co'],login:'/login'}),
  metadata('en.myanimelist','MyAnimeList','myanimelist.net','sources/myanimelist.mjs',{origins:['https://api.myanimelist.net'],images:['https://myanimelist.net'],login:'/login.php',network:{authOrigins:['https://myanimelist.net','https://api.myanimelist.net']}}),
];
export function sourceDefinitions() { return registrations.map(({_module,...definition}) => definition); }
export function manifestDefinition({version,publisherKeyId}) {
  return {schemaVersion:1,extensionId:'official.mangalaunch.sources',name:'MangaLaunch Unofficial Extensions',version,publisherKeyId,
    icon:'assets/icon.png',sourceApiVersion:1,minAppVersion:'1.0.0',minRuntimeAbi:1,entrypoint:'src/index.mjs',license:'LicenseRef-Proprietary',permissions:['http','html','sourceSettings','sourceSession'],sources:sourceDefinitions(),files:{}};
}
