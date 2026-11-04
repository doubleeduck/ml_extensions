import createAstraManga from './sources/astramanga.mjs';
import createPureManga from './sources/puremanga.mjs';
import createComX from './sources/comx.mjs';
import createInkStory from './sources/inkstory.mjs';
import createLibGroup from './engines/libgroup.mjs';
import createRemanga from './sources/remanga.mjs';
import createGrouple from './engines/grouple.mjs';
import createSenkuro from './engines/senkuro.mjs';
import createMangaShi from './sources/mangashi.mjs';

const factories = new Map([
  ['ru.puremanga',createPureManga],
  ['ru.astramanga',createAstraManga],
  ['ru.comx',createComX],
  ['ru.inkstory',createInkStory],
  ['ru.mangalib',createLibGroup],
  ['ru.remanga',createRemanga],
  ['ru.readmanga',createGrouple],
  ['ru.mintmanga',createGrouple],
  ['ru.seimanga',createGrouple],
  ['ru.selfmanga',createGrouple],
  ['ru.usagi',createGrouple],
  ['ru.rumix',createGrouple],
  ['ru.senkuro',createSenkuro],
  ['ru.mangashi',createMangaShi],
]);
export default function createSource(context) {
  const factory = factories.get(context.sourceId);
  if (!factory) throw Object.assign(Error('Source ID is not registered in this package.'),{code:'source_unavailable',phase:'factory'});
  return factory(context);
}
