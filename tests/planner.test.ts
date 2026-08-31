import { computeCapacity, planRoutes, applyFilters } from '../services/routePlanner';
import { pathLengthM, haversineM, destinationPoint, bearingDeg } from '../services/geo';
import { safetyExclusion } from '../services/osmService';
import { pickModel, describeApiError } from '../services/geminiService';
import { applyRoutedPath, straightPath } from '../services/routingService';
import { anchorsFor } from '../services/loopPlanner';
import { DEFAULT_ROUTE_CONFIG, POI, POI_THEMES, PoiTheme, RouteConfig } from '../types';

let failures = 0;
const check = (label: string, condition: boolean, detail = '') => {
  console.log(`${condition ? '  OK  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures++;
};

/** Ville synthétique : POI répartis dans un carré de ~3 km de côté. */
const makeCity = (n: number, seed = 1): POI[] => {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  return Array.from({ length: n }, (_, i) => ({
    id: `poi-${i}`,
    name: `Lieu ${i}`,
    theme: POI_THEMES[i % POI_THEMES.length] as PoiTheme,
    subtype: 'Test',
    lat: 45.9 + (rand() - 0.5) * 0.027,
    lng: 6.13 + (rand() - 0.5) * 0.038,
    notoriety: Math.round(rand() * 100),
    visitMinutes: 20,
    source: 'osm' as const,
  }));
};

const cfg = (over: Partial<RouteConfig> = {}): RouteConfig => ({ ...DEFAULT_ROUTE_CONFIG, ...over });

console.log('\n== Capacité ==');
{
  const pois = makeCity(60);
  const c = computeCapacity(pois, cfg({ stopsMin: 4, stopsTarget: 6 }));
  check('60 POI / min 4 => 15 parcours max', c.maxRoutes === 15, `${c.maxRoutes}`);
  check('60 POI / cible 6 => 10 recommandés', c.recommendedRoutes === 10, `${c.recommendedRoutes}`);

  const reuse = computeCapacity(pois, cfg({ stopsMin: 4, reusePois: true }));
  check('réutilisation => capacité doublée', reuse.maxRoutes === 30, `${reuse.maxRoutes}`);

  const small = computeCapacity(makeCity(3), cfg({ stopsMin: 4 }));
  check('3 POI / min 4 => 0 parcours', small.maxRoutes === 0, `${small.maxRoutes}`);

  const themed = computeCapacity(pois, cfg({ themeMode: 'thematic', stopsMin: 4 }));
  check('mode thématique => capacité <= mode mélangé', themed.maxRoutes <= c.maxRoutes,
    `thématique ${themed.maxRoutes} vs mélangé ${c.maxRoutes}`);
}

console.log('\n== Planification : respect des bornes ==');
{
  const pois = makeCity(80, 7);
  const config = cfg({ stopsMin: 4, stopsTarget: 6, stopsMax: 8, maxDistanceKm: 3 });
  const routes = planRoutes(pois, 'Testville', config);

  check('des parcours sont produits', routes.length > 0, `${routes.length} parcours`);
  check('nombre <= capacité max',
    routes.length <= computeCapacity(pois, config).maxRoutes,
    `${routes.length} / ${computeCapacity(pois, config).maxRoutes}`);

  const badStops = routes.filter(r => r.steps.length < 4 || r.steps.length > 8);
  check('toutes les tailles dans [min, max]', badStops.length === 0,
    badStops.map(r => r.steps.length).join(','));

  const tooLong = routes.filter(r => r.summary.totalDistanceKm > 3.001);
  check('budget de distance respecté', tooLong.length === 0,
    tooLong.map(r => r.summary.totalDistanceKm).join(','));

  const dupes = routes.flatMap(r => r.steps.map(s => s.id));
  check('aucun POI réutilisé (reuse off)', new Set(dupes).size === dupes.length,
    `${dupes.length - new Set(dupes).size} doublons`);

  const numbering = routes.every(r => r.steps.every((s, i) => s.stepNumber === i + 1));
  check('étapes numérotées de 1 à N', numbering);

  const coherent = routes.every(r => {
    const recomputed = pathLengthM(r.steps, r.summary.loop) / 1000;
    return Math.abs(recomputed - r.summary.totalDistanceKm) < 0.06;
  });
  check('distance annoncée = distance calculée', coherent);

  const durations = routes.every(r =>
    r.summary.totalMinutes === Math.round(r.summary.walkingMinutes + r.summary.visitMinutes));
  check('durée totale = marche + visites', durations);
}

console.log('\n== Ordonnancement géographique ==');
{
  const pois = makeCity(40, 3);
  const routes = planRoutes(pois, 'Testville', cfg({ stopsMin: 5, stopsTarget: 7, stopsMax: 7 }));

  // L'ordre optimisé doit battre un ordre arbitraire dans la grande majorité des cas.
  let better = 0;
  routes.forEach(r => {
    const optimized = pathLengthM(r.steps, false);
    const shuffled = [...r.steps].sort((a, b) => a.id.localeCompare(b.id));
    if (optimized <= pathLengthM(shuffled, false)) better++;
  });
  check('ordre optimisé >= ordre arbitraire', better === routes.length,
    `${better}/${routes.length}`);

  // Deux parcours ne doivent pas se superposer exactement.
  const centers = routes.map(r => ({
    lat: r.steps.reduce((s, p) => s + p.lat, 0) / r.steps.length,
    lng: r.steps.reduce((s, p) => s + p.lng, 0) / r.steps.length,
  }));
  let minGap = Infinity;
  for (let i = 0; i < centers.length; i++)
    for (let j = i + 1; j < centers.length; j++)
      minGap = Math.min(minGap, haversineM(centers[i], centers[j]));
  check('parcours géographiquement distincts', centers.length < 2 || minGap > 50,
    `écart min ${Math.round(minGap)} m`);
}

console.log('\n== Mode boucle & thématique ==');
{
  const pois = makeCity(70, 11);
  const loops = planRoutes(pois, 'Testville', cfg({ loop: true, stopsMin: 4, stopsMax: 7 }));
  const loopOk = loops.every(r => {
    const closed = pathLengthM(r.steps, true) / 1000;
    return Math.abs(closed - r.summary.totalDistanceKm) < 0.06;
  });
  check('boucle : retour au départ compté', loops.length > 0 && loopOk);

  const themed = planRoutes(pois, 'Testville', cfg({ themeMode: 'thematic', stopsMin: 4, stopsMax: 6 }));
  const pure = themed.every(r => new Set(r.steps.map(s => s.theme)).size === 1);
  check('thématique : un seul thème par parcours', themed.length > 0 && pure,
    `${themed.length} parcours`);
  const themesUsed = new Set(themed.map(r => r.summary.theme));
  check('thématique : plusieurs thèmes couverts', themesUsed.size > 1, `${themesUsed.size} thèmes`);
}

console.log('\n== routeCount explicite ==');
{
  const pois = makeCity(100, 5);
  const routes = planRoutes(pois, 'Testville', cfg({ routeCount: 3, stopsMin: 4, stopsMax: 7 }));
  check('routeCount=3 => exactement 3 parcours', routes.length === 3, `${routes.length}`);

  const huge = planRoutes(pois, 'Testville', cfg({ routeCount: 999, stopsMin: 4 }));
  check('routeCount démesuré => borné par les POI disponibles', huge.length < 999, `${huge.length}`);
}

console.log('\n== Filtres ==');
{
  const pois = makeCity(50, 9);
  const filtered = applyFilters(pois, { themes: ['Patrimoine & Histoire'], minNotoriety: 50, search: '' });
  check('filtre thème + notoriété',
    filtered.every(p => p.theme === 'Patrimoine & Histoire' && p.notoriety >= 50),
    `${filtered.length} POI`);
  const searched = applyFilters(pois, { themes: [], minNotoriety: 0, search: 'lieu 1' });
  check('recherche textuelle', searched.length > 0 && searched.every(p => p.name.toLowerCase().includes('lieu 1')));
}

console.log('\n== Cas limites ==');
{
  check('liste vide => aucun parcours', planRoutes([], 'X', cfg()).length === 0);
  check('1 POI => aucun parcours', planRoutes(makeCity(1), 'X', cfg()).length === 0);
  const tiny = planRoutes(makeCity(4), 'X', cfg({ stopsMin: 4, stopsTarget: 4, stopsMax: 4, maxDistanceKm: null }));
  check('exactement assez de POI => 1 parcours', tiny.length === 1, `${tiny.length}`);
}

console.log('\n== Règles de sécurité ==');
{
  const excluded: [string, Record<string, string>][] = [
    ['accès privé', { tourism: 'attraction', name: 'X', access: 'private' }],
    ['accès interdit', { historic: 'castle', name: 'X', access: 'no' }],
    ['clientèle uniquement', { leisure: 'garden', name: 'X', access: 'customers' }],
    ['zone militaire (tag military)', { historic: 'fort', name: 'X', military: 'base' }],
    ['zone militaire (landuse)', { tourism: 'attraction', name: 'X', landuse: 'military' }],
    ['site dangereux signalé', { tourism: 'viewpoint', name: 'X', hazard: 'cliff' }],
    ['grotte', { name: 'X', natural: 'cave_entrance' }],
    ['sommet', { name: 'X', natural: 'peak' }],
    ['falaise', { name: 'X', natural: 'cliff' }],
    ["site à l'abandon", { tourism: 'theme_park', name: 'X', abandoned: 'yes' }],
    ['site en travaux', { historic: 'building', name: 'X', construction: 'yes' }],
    ['passage à niveau', { name: 'X', railway: 'level_crossing' }],
    ['installation électrique', { name: 'X', power: 'substation' }],
  ];
  excluded.forEach(([label, tags]) => {
    check(`exclu : ${label}`, safetyExclusion(tags) !== null, safetyExclusion(tags) || '');
  });

  const allowed: [string, Record<string, string>][] = [
    ['musée public', { tourism: 'museum', name: 'X', wikidata: 'Q1' }],
    ['château ouvert', { historic: 'castle', name: 'X', access: 'yes' }],
    ['parc sans tag access', { leisure: 'park', name: 'X' }],
    ['point de vue aménagé', { tourism: 'viewpoint', name: 'X' }],
    ['ruines touristiques entretenues', { historic: 'ruins', name: 'X', tourism: 'attraction' }],
  ];
  allowed.forEach(([label, tags]) => {
    check(`admis : ${label}`, safetyExclusion(tags) === null, safetyExclusion(tags) || '');
  });
}

console.log('\n== Choix du modèle Gemini ==');
{
  // Cas réel : la clé n'ouvre pas le modèle de l'export AI Studio.
  const sansGemini3 = ['gemini-2.5-flash', 'gemini-2.5-pro', 'text-embedding-004'];
  check('retombe sur un modèle disponible', pickModel(sansGemini3) === 'gemini-2.5-flash',
    String(pickModel(sansGemini3)));

  const avecGemini3 = ['gemini-2.5-flash', 'gemini-3-flash-preview'];
  check('préfère le modèle souhaité quand il existe',
    pickModel(avecGemini3) === 'gemini-3-flash-preview', String(pickModel(avecGemini3)));

  const inconnus = ['gemini-9-turbo', 'gemini-9-pro'];
  check('modèles inconnus : prend un pro plutôt que rien',
    pickModel(inconnus) === 'gemini-9-pro', String(pickModel(inconnus)));

  check('ignore les modèles inadaptés',
    pickModel(['text-embedding-004', 'imagen-3.0', 'gemini-tts']) === null,
    String(pickModel(['text-embedding-004', 'imagen-3.0', 'gemini-tts'])));

  check('liste vide => aucun modèle', pickModel([]) === null);
}

console.log('\n== Messages d\'erreur API ==');
{
  const cases: [string, string, RegExp][] = [
    ['clé invalide', 'API key not valid. Please pass a valid API key.', /clé entière/i],
    ['403', 'PERMISSION_DENIED: the caller does not have permission', /Accès refusé/i],
    ['quota', 'RESOURCE_EXHAUSTED: quota exceeded', /Quota/i],
    ['réseau', 'Failed to fetch', /joindre l'API Google/i],
  ];
  cases.forEach(([label, raw, expected]) => {
    const msg = describeApiError(new Error(raw));
    check(`erreur ${label} traduite`, expected.test(msg), msg.slice(0, 60));
  });
}

console.log('\n== Tracé par les rues ==');
{
  const pois = makeCity(6, 21);
  const config = cfg({ stopsMin: 4, stopsTarget: 5, stopsMax: 5, maxDistanceKm: null });
  const route = planRoutes(pois, 'Testville', config)[0];

  check('sans routage : géométrie en lignes droites', route.geometrySource === 'straight');
  check('sans routage : un point de tracé par arrêt',
    route.path.length === route.steps.length, `${route.path.length}`);
  check('chaque étape sauf la première porte un segment',
    route.steps.slice(1).every(s => s.pathFromPrev.length === 2) &&
    route.steps[0].pathFromPrev.length === 0);

  // Réponse OSRM simulée : chaque segment fait un détour, donc plus long que
  // la ligne droite. Les extrémités des segments se recouvrent, comme en vrai.
  const legs = route.steps.slice(1).map((step, i) => {
    const from = route.steps[i];
    const midpoint: [number, number] = [
      (from.lat + step.lat) / 2 + 0.0008,
      (from.lng + step.lng) / 2,
    ];
    // Un vrai détour par les rues : 40 % de plus que la ligne droite.
    return {
      distanceM: Math.round(haversineM(from, step) * 1.4),
      durationS: 400,
      path: [[from.lat, from.lng], midpoint, [step.lat, step.lng]] as [number, number][],
    };
  });
  const totalDistanceM = legs.reduce((sum, l) => sum + l.distanceM, 0);
  const routed = applyRoutedPath(route, { legs, totalDistanceM }, config);

  check('après routage : géométrie marquée comme réelle', routed.geometrySource === 'osrm');
  check('distances réelles reprises des segments',
    routed.steps.slice(1).every((s, i) => s.distanceFromPrevM === legs[i].distanceM));
  check('première étape sans distance ni tracé',
    routed.steps[0].distanceFromPrevM === 0 && routed.steps[0].pathFromPrev.length === 0);
  check('distance totale = somme des segments',
    Math.abs(routed.summary.totalDistanceKm - totalDistanceM / 1000) < 0.05,
    `${routed.summary.totalDistanceKm} km`);

  // 3 points par segment, moins les jonctions partagées entre segments.
  const expectedPoints = legs.length * 3 - (legs.length - 1);
  check('tracé assemblé sans point de jonction dupliqué',
    routed.path.length === expectedPoints, `${routed.path.length} vs ${expectedPoints}`);

  const consecutiveDupes = routed.path.filter(
    (p, i) => i > 0 && p[0] === routed.path[i - 1][0] && p[1] === routed.path[i - 1][1]
  );
  check('aucun point répété dans le tracé', consecutiveDupes.length === 0);

  check('durée recalculée à la vitesse choisie',
    routed.summary.walkingMinutes ===
      Math.round((totalDistanceM / 1000 / config.paceKmh) * 60),
    `${routed.summary.walkingMinutes} min`);
  check('durée totale cohérente',
    routed.summary.totalMinutes ===
      routed.summary.walkingMinutes + routed.summary.visitMinutes);

  // Le tracé réel doit être plus long que la ligne droite : c'est le détour.
  check('tracé réel plus long que la ligne droite',
    totalDistanceM > pathLengthM(route.steps, false),
    `${Math.round(totalDistanceM)} m vs ${Math.round(pathLengthM(route.steps, false))} m`);
}

console.log('\n== Tracé de secours ==');
{
  const pois = makeCity(4, 33);
  const line = straightPath(pois, false);
  check('ligne droite : un point par arrêt', line.length === 4, `${line.length}`);
  check('ordre [lat, lng] respecté',
    line[0][0] === pois[0].lat && line[0][1] === pois[0].lng);

  const loop = straightPath(pois, true);
  check('boucle : le tracé revient au départ',
    loop.length === 5 && loop[4][0] === loop[0][0] && loop[4][1] === loop[0][1]);
}

console.log('\n== Géométrie du cercle (base des boucles) ==');
{
  const center = { lat: 45.9, lng: 6.13 };
  const north = destinationPoint(center, 0, 1000);
  const east = destinationPoint(center, 90, 1000);

  check('point à 1 km : distance respectée',
    Math.abs(haversineM(center, north) - 1000) < 1,
    `${Math.round(haversineM(center, north))} m`);
  check('cap nord => latitude plus haute, longitude stable',
    north.lat > center.lat && Math.abs(north.lng - center.lng) < 0.0001);
  check('cap est => longitude plus grande', east.lng > center.lng);
  check('cap retrouvé depuis les deux points',
    Math.abs(bearingDeg(center, east) - 90) < 0.5,
    `${bearingDeg(center, east).toFixed(1)}°`);

  // Quatre jalons doivent former un carré autour du centre.
  const ring = [0, 90, 180, 270].map((a) => destinationPoint(center, a, 800));
  const equidistant = ring.every((p) => Math.abs(haversineM(center, p) - 800) < 1);
  check('les quatre jalons sont équidistants du départ', equidistant);
}

console.log('\n== Sélection des repères par ambiance ==');
{
  const scan = {
    city: { name: 'X', displayName: 'X', lat: 45.9, lng: 6.13, bbox: [0, 0, 0, 0] as [number, number, number, number] },
    pois: [
      { ...makeCity(1)[0], id: 'p1', theme: 'Nature & Jardins' as PoiTheme, notoriety: 60 },
      { ...makeCity(1)[0], id: 'p2', theme: 'Patrimoine & Histoire' as PoiTheme, notoriety: 70 },
      { ...makeCity(1)[0], id: 'p3', theme: 'Nature & Jardins' as PoiTheme, notoriety: 10 },
      { ...makeCity(1)[0], id: 'p4', theme: 'Panoramas & Points de vue' as PoiTheme, notoriety: 50 },
    ],
    cycleRoutes: [],
    scannedAt: new Date().toISOString(),
    notes: [],
    excludedCount: 0,
  };

  const nature = anchorsFor(scan, 'nature');
  check('ambiance nature : nature et panoramas uniquement',
    nature.every(p => p.theme === 'Nature & Jardins' || p.theme === 'Panoramas & Points de vue'),
    nature.map(p => p.id).join(','));
  check('ambiance nature : les lieux mineurs écartés',
    !nature.some(p => p.id === 'p3'), nature.map(p => p.id).join(','));

  const heritage = anchorsFor(scan, 'heritage');
  check('ambiance patrimoine : patrimoine retenu',
    heritage.length === 1 && heritage[0].id === 'p2', heritage.map(p => p.id).join(','));

  const any = anchorsFor(scan, 'any');
  check('ambiance indifférente : tous les lieux notables',
    any.length === 3, `${any.length}`);
}

console.log(failures === 0 ? '\nTous les tests passent.\n' : `\n${failures} test(s) en échec.\n`);
process.exit(failures === 0 ? 0 : 1);
