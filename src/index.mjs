import createInkStory from './sources/inkstory.mjs';
import createMangaDex from './engines/mangadex.mjs';
import createLibGroup from './engines/libgroup.mjs';
import createGrouple from './engines/grouple.mjs';
import createSenkuro from './engines/senkuro.mjs';
import createIMHentai from './sources/imhentai.mjs';
import createPururin from './sources/pururin.mjs';
import createMangaFox from './sources/mangafox.mjs';
import createMangaKakalot from './sources/mangakakalot.mjs';
import createWeebCentral from './sources/weebcentral.mjs';
import createChan from './engines/chan.mjs';
import createMangaShi from './sources/mangashi.mjs';
import createDesu from './sources/desu.mjs';
import createShikimori from './sources/shikimori.mjs';
import createAniList from './sources/anilist.mjs';
import createMyAnimeList from './sources/myanimelist.mjs';
import createNudeMoon from './sources/nudemoon.mjs';

const factories = new Map([
  ['ru.inkstory',createInkStory],...['ru.mangadex','en.mangadex'].map(id => [id,createMangaDex]),
  ...['ru.mangalib','ru.hentailib','ru.yaoilib'].map(id => [id,createLibGroup]),
  ...['ru.readmanga','ru.mintmanga','ru.seimanga','ru.selfmanga','ru.usagi','ru.rumix','ru.allhentai'].map(id => [id,createGrouple]),
  ...['ru.senkuro','ru.senkognito'].map(id => [id,createSenkuro]),...['all.imhentai','en.imhentai','ru.imhentai'].map(id => [id,createIMHentai]),
  ['all.pururin',createPururin],['en.mangafox',createMangaFox],['en.mangakakalot',createMangaKakalot],['en.weebcentral',createWeebCentral],
  ['ru.hchan',createChan],['ru.mangachan',createChan],['ru.mangashi',createMangaShi],['ru.desu',createDesu],
  ['ru.shikimori',createShikimori],['en.anilist',createAniList],['en.myanimelist',createMyAnimeList],
  ['ru.nudemoon',createNudeMoon],
]);
export default function createSource(context) {
  const factory = factories.get(context.sourceId);
  if (!factory) throw Object.assign(Error('Source ID is not registered in this package.'),{code:'source_unavailable',phase:'factory'});
  return factory(context);
}
