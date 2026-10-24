import createInkStory from './sources/inkstory.mjs';
import createMangaDex from './engines/mangadex.mjs';
import createLibGroup from './engines/libgroup.mjs';
import createRemanga from './sources/remanga.mjs';
import createGrouple from './engines/grouple.mjs';
import createSenkuro from './engines/senkuro.mjs';
import createMangaFox from './sources/mangafox.mjs';
import createMangaKakalot from './sources/mangakakalot.mjs';
import createWeebCentral from './sources/weebcentral.mjs';
import createChan from './engines/chan.mjs';
import createMangaShi from './sources/mangashi.mjs';
import createDesu from './sources/desu.mjs';
import createShikimori from './sources/shikimori.mjs';
import createAniList from './sources/anilist.mjs';
import createMyAnimeList from './sources/myanimelist.mjs';

const factories = new Map([
  ['ru.inkstory',createInkStory],
  ['ru.mangadex',createMangaDex],
  ['en.mangadex',createMangaDex],
  ['ru.mangalib',createLibGroup],
  ['ru.remanga',createRemanga],
  ['ru.readmanga',createGrouple],
  ['ru.mintmanga',createGrouple],
  ['ru.seimanga',createGrouple],
  ['ru.selfmanga',createGrouple],
  ['ru.usagi',createGrouple],
  ['ru.rumix',createGrouple],
  ['ru.senkuro',createSenkuro],
  ['en.mangafox',createMangaFox],
  ['en.mangakakalot',createMangaKakalot],
  ['en.weebcentral',createWeebCentral],
  ['ru.mangachan',createChan],
  ['ru.mangashi',createMangaShi],
  ['ru.desu',createDesu],
  ['ru.shikimori',createShikimori],
  ['en.anilist',createAniList],
  ['en.myanimelist',createMyAnimeList],
]);
export default function createSource(context) {
  const factory = factories.get(context.sourceId);
  if (!factory) throw Object.assign(Error('Source ID is not registered in this package.'),{code:'source_unavailable',phase:'factory'});
  return factory(context);
}
