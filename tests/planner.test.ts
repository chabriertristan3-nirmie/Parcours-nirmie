import {
  computeCapacity,
  planRoutes,
  applyFilters,
  estimateTimeModel,
  stopsForBudget,
  effectiveSizing,
} from '../services/routePlanner';
import { pathLengthM, haversineM, destinationPoint, bearingDeg, tracePathLengthM } from '../services/geo';
import { safetyExclusion } from '../services/osmService';
import { pickModel, describeApiError } from '../services/geminiService';
import { applyRoutedPath, straightPath } from '../services/routingService';
import {
  buildTrace,
  isNumberedRoad,
  placeStops,
  sliceTrace,
  usesForbiddenMode,
} from '../services/stopPlacement';
import {
  makeRng,
  randomLoopShape,
  sectorName,
  shapeWaypoints,
  spreadBearing,
  spreadStartPoints,
} from '../services/loopPlanner';
import {
  CityInfo,
  DEFAULT_ROUTE_CONFIG,
  POI,
  POI_THEMES,
  PoiTheme,
  RouteConfig,
} from '../types';

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
      maneuvers: [
        {
          name: `rue ${i + 1}`,
          ref: '',
          mode: 'walking',
          path: [[from.lat, from.lng], midpoint, [step.lat, step.lng]] as [number, number][],
        },
      ],
    };
  });
  const totalDistanceM = legs.reduce((sum, l) => sum + l.distanceM, 0);
  const routed = applyRoutedPath(
    route,
    { legs, totalDistanceM, waypointNames: [], waypointLocations: [] },
    config
  );

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

console.log('\n== Longueur d\'un tracé ==');
{
  const a = { lat: 45.9, lng: 6.13 };
  const b = destinationPoint(a, 90, 1000);
  // Régression : le facteur de voirie (x1,3) ne s'applique qu'aux distances à
  // vol d'oiseau, jamais à un tracé qui suit déjà les rues.
  const traced = tracePathLengthM([[a.lat, a.lng], [b.lat, b.lng]]);
  check('tracé de 1 km mesuré 1 km (pas de facteur de voirie)',
    Math.abs(traced - 1000) < 2, `${Math.round(traced)} m`);
  const straightLeg = pathLengthM([a, b], false);
  check('distance arrêt-à-arrêt toujours corrigée x1,3',
    Math.abs(straightLeg - 1300) < 3, `${Math.round(straightLeg)} m`);
}

console.log('\n== Boucles libres : formes aléatoires ==');
{
  const start = { lat: 45.9, lng: 6.13 };

  // Même graine, même boucle : c'est ce qui rend l'aléatoire testable.
  const a = randomLoopShape(makeRng(42), 0);
  const b = randomLoopShape(makeRng(42), 0);
  check('graine identique => forme identique',
    JSON.stringify(a) === JSON.stringify(b));

  const c = randomLoopShape(makeRng(43), 0);
  check('graine différente => forme différente',
    JSON.stringify(a) !== JSON.stringify(c));

  // Cent formes tirées : bornes et cohérence interne.
  const rng = makeRng(7);
  const shapes = Array.from({ length: 100 }, (_, i) => randomLoopShape(rng, i * 3));
  check('3 à 6 jalons par boucle',
    shapes.every(s => s.waypointCount >= 3 && s.waypointCount <= 6),
    `min ${Math.min(...shapes.map(s => s.waypointCount))}, max ${Math.max(...shapes.map(s => s.waypointCount))}`);
  check('un facteur de rayon et un décalage par jalon',
    shapes.every(s => s.radiusFactors.length === s.waypointCount &&
                      s.bearingOffsets.length === s.waypointCount));
  check('rayons déformés mais bornés (75-125 %)',
    shapes.every(s => s.radiusFactors.every(f => f >= 0.75 && f <= 1.25)));
  check('décalages angulaires sous un quart de secteur',
    shapes.every(s => s.bearingOffsets.every(o => Math.abs(o) <= (360 / s.waypointCount) * 0.25 + 1e-9)));
  check('les formes varient vraiment',
    new Set(shapes.map(s => JSON.stringify(s))).size === 100);

  // Les jalons doivent former un vrai tour autour du départ.
  const shape = randomLoopShape(makeRng(11), 0);
  const wps = shapeWaypoints(start, shape, 1000);
  check('un jalon posé par point de la forme', wps.length === shape.waypointCount);
  const distances = wps.map(w => haversineM(start, w));
  check('tous les jalons dans la fourchette de rayon',
    distances.every(d => d >= 740 && d <= 1260),
    distances.map(d => Math.round(d)).join(', '));

  // Les caps doivent couvrir le tour, sans que deux jalons se croisent.
  const bearings = wps.map(w => bearingDeg(start, w)).sort((x, y) => x - y);
  const gaps = bearings.map((b, i) => i === 0 ? b + 360 - bearings[bearings.length - 1] : b - bearings[i - 1]);
  check('aucun jalon ne double son voisin', gaps.every(g => g > 0),
    gaps.map(g => Math.round(g)).join(', '));

  // Le rayon est le seul levier : doubler le rayon double les distances.
  const doubled = shapeWaypoints(start, shape, 2000);
  check('la forme est indépendante de la taille',
    doubled.every((w, i) => Math.abs(haversineM(start, w) / distances[i] - 2) < 0.01));
}

console.log('\n== Boucles libres : répartition des directions ==');
{
  const rng = makeRng(3);
  const total = 4;
  const bearings = Array.from({ length: total }, (_, i) => spreadBearing(i, total, rng));
  check('chaque boucle démarre dans son propre secteur',
    bearings.every((b, i) => b >= i * (360 / total) && b < (i + 1) * (360 / total)),
    bearings.map(b => Math.round(b)).join('°, ') + '°');

  const again = Array.from({ length: total }, (_, i) => spreadBearing(i, total, makeRng(99)));
  check('relancer donne d\'autres directions',
    JSON.stringify(bearings) !== JSON.stringify(again));
}

console.log('\n== Cadrage par le temps ==');
{
  const pois = makeCity(60, 17);
  const base = cfg({ sizingMode: 'duration', paceKmh: 4.2 });

  const model = estimateTimeModel(pois, base);
  check('visite moyenne mesurée sur les lieux retenus',
    Math.abs(model.avgVisitMinutes - 20) < 0.01, `${model.avgVisitMinutes.toFixed(1)} min`);
  check('trajet type déduit de la densité de la ville',
    model.avgLegMinutes > 0 && model.avgLegMinutes < 30,
    `${model.avgLegMinutes.toFixed(1)} min entre deux lieux voisins`);

  // Le cœur de la promesse : le temps seul décide du nombre d'arrêts.
  const stops45 = stopsForBudget(45, model);
  const stops90 = stopsForBudget(90, model);
  const stops180 = stopsForBudget(180, model);
  check('plus de temps => plus d\'arrêts',
    stops45 < stops90 && stops90 < stops180, `${stops45} / ${stops90} / ${stops180} arrêts`);

  // Vérification par le calcul inverse : le parcours déduit tient-il vraiment
  // dans le budget ?
  [60, 90, 150, 240].forEach(budget => {
    const n = stopsForBudget(budget, model);
    const spent = n * model.avgVisitMinutes + (n - 1) * model.avgLegMinutes;
    check(`${budget} min => ${n} arrêts, soit ${Math.round(spent)} min réels`,
      Math.abs(spent - budget) <= (model.avgVisitMinutes + model.avgLegMinutes) / 2 + 0.01);
  });

  // Un budget intenable : deux arrêts sont le minimum, et deux visites de
  // 20 min dépassent déjà 30 min. Le plancher doit tenir, et l'écart être
  // visible pour que l'interface puisse en avertir.
  const floored = stopsForBudget(30, model);
  const flooredSpent = floored * model.avgVisitMinutes + (floored - 1) * model.avgLegMinutes;
  check('budget trop court => plancher de 2 arrêts, pas de parcours vide',
    floored === 2, `${floored} arrêts`);
  check('le dépassement est mesurable par l\'interface',
    flooredSpent > 30, `${Math.round(flooredSpent)} min pour 30 min demandées`);

  // Et la capacité doit suivre le temps, sans toucher à rien d'autre.
  const short = computeCapacity(pois, cfg({ sizingMode: 'duration', targetMinutes: 45 }));
  const long = computeCapacity(pois, cfg({ sizingMode: 'duration', targetMinutes: 180 }));
  check('parcours courts => la ville en porte davantage',
    short.maxRoutes > long.maxRoutes,
    `45 min : ${short.maxRoutes} parcours, 3 h : ${long.maxRoutes} parcours`);
  check('la durée annoncée retombe sur le budget demandé',
    Math.abs(short.estimatedMinutes - 45) < 25 && Math.abs(long.estimatedMinutes - 180) < 40,
    `${short.estimatedMinutes} min et ${long.estimatedMinutes} min`);

  // La distance de marche découle des trajets modélisés, avec une marge — et
  // jamais d'un « temps restant » qui pourrait être négatif.
  const sizing = effectiveSizing(pois, cfg({ sizingMode: 'duration', targetMinutes: 120 }));
  const legMinutes = (sizing.stopsTarget - 1) * model.avgLegMinutes;
  check('distance déduite des trajets entre arrêts',
    sizing.maxDistanceKm !== null &&
      Math.abs(sizing.maxDistanceKm - ((legMinutes * 1.4) / 60) * 4.2) < 0.15,
    `${sizing.maxDistanceKm} km pour ${Math.round(legMinutes)} min de trajets`);
  check('la distance déduite laisse de la place au planificateur',
    (sizing.maxDistanceKm ?? 0) > 0.5, `${sizing.maxDistanceKm} km`);

  // Un budget serré ne doit jamais produire une contrainte absurde.
  [30, 45, 60, 120, 240].forEach(budget => {
    const sz = effectiveSizing(pois, cfg({ sizingMode: 'duration', targetMinutes: budget }));
    check(`budget ${budget} min : distance exploitable`,
      (sz.maxDistanceKm ?? 0) >= 0.5, `${sz.maxDistanceKm} km pour ${sz.stopsTarget} arrêts`);
  });
  check('bornes d\'arrêts encadrant la cible',
    sizing.stopsMin <= sizing.stopsTarget && sizing.stopsTarget <= sizing.stopsMax,
    `${sizing.stopsMin} / ${sizing.stopsTarget} / ${sizing.stopsMax}`);

  // Le mode par arrêts ne doit pas être affecté.
  const manual = cfg({ sizingMode: 'stops', stopsMin: 5, stopsTarget: 7, stopsMax: 9, maxDistanceKm: 3 });
  const untouched = effectiveSizing(pois, manual);
  check('mode par arrêts : les réglages passent tels quels',
    untouched.stopsMin === 5 && untouched.stopsTarget === 7 &&
    untouched.stopsMax === 9 && untouched.maxDistanceKm === 3);

  // Et la planification doit respecter les bornes déduites du temps.
  const planned = planRoutes(pois, 'Testville', cfg({ sizingMode: 'duration', targetMinutes: 90 }));
  const s90 = effectiveSizing(pois, cfg({ sizingMode: 'duration', targetMinutes: 90 }));
  check('parcours générés dans les bornes déduites',
    planned.length > 0 &&
    planned.every(r => r.steps.length >= s90.stopsMin && r.steps.length <= s90.stopsMax),
    `${planned.length} parcours de ${planned.map(r => r.steps.length).join(', ')} arrêts`);
}

console.log('\n== Par le temps, avec un nombre d\'arrêts imposé ==');
{
  const pois = makeCity(60, 17);
  const base = cfg({ sizingMode: 'duration', paceKmh: 4.2 });
  const model = estimateTimeModel(pois, base);

  // La consigne prime sur la déduction : les trois bornes valent le nombre
  // demandé, sans marge — sinon ce ne serait pas « imposé ».
  [3, 6, 11].forEach(n => {
    const sz = effectiveSizing(pois, cfg({
      sizingMode: 'duration', targetMinutes: 120, stopsOverride: n,
    }));
    check(`${n} arrêts imposés : les bornes s'y tiennent exactement`,
      sz.stopsMin === n && sz.stopsTarget === n && sz.stopsMax === n,
      `${sz.stopsMin} / ${sz.stopsTarget} / ${sz.stopsMax}`);
  });

  // Ce qui s'ajuste, c'est la distance : plus d'arrêts imposés, plus de trajet.
  const few = effectiveSizing(pois, cfg({
    sizingMode: 'duration', targetMinutes: 120, stopsOverride: 3,
  }));
  const many = effectiveSizing(pois, cfg({
    sizingMode: 'duration', targetMinutes: 120, stopsOverride: 10,
  }));
  check('plus d\'arrêts imposés => plus de distance allouée',
    (many.maxDistanceKm ?? 0) > (few.maxDistanceKm ?? 0),
    `${few.maxDistanceKm} km pour 3 arrêts, ${many.maxDistanceKm} km pour 10`);

  // Le temps reste maître de la distance quand les arrêts ne bougent pas.
  const tight = effectiveSizing(pois, cfg({
    sizingMode: 'duration', targetMinutes: 90, stopsOverride: 6,
  }));
  const roomy = effectiveSizing(pois, cfg({
    sizingMode: 'duration', targetMinutes: 300, stopsOverride: 6,
  }));
  check('à arrêts égaux, plus de temps => plus de distance',
    (roomy.maxDistanceKm ?? 0) > (tight.maxDistanceKm ?? 0),
    `${tight.maxDistanceKm} km en 1 h 30, ${roomy.maxDistanceKm} km en 5 h`);

  // Un budget serré ne doit jamais produire une distance nulle ou négative :
  // marcher entre n arrêts prend un temps incompressible, c'est le plancher.
  [20, 30, 45].forEach(budget => {
    const sz = effectiveSizing(pois, cfg({
      sizingMode: 'duration', targetMinutes: budget, stopsOverride: 12,
    }));
    check(`12 arrêts en ${budget} min : distance encore exploitable`,
      (sz.maxDistanceKm ?? 0) >= 0.5, `${sz.maxDistanceKm} km`);
  });

  // Une consigne intenable doit rester visible : l'écran s'appuie sur
  // `estimatedMinutes` pour avertir, il faut donc qu'il dépasse franchement.
  const overloaded = computeCapacity(pois, cfg({
    sizingMode: 'duration', targetMinutes: 60, stopsOverride: 12,
  }));
  check('consigne intenable : le dépassement est mesurable',
    overloaded.estimatedMinutes > 60 * 1.15,
    `${overloaded.estimatedMinutes} min pour 60 min demandées`);
  check('les arrêts annoncés sont bien ceux imposés',
    overloaded.stopsTarget === 12, `${overloaded.stopsTarget} arrêts`);

  // Repasser en automatique doit rendre la main au temps.
  const auto = effectiveSizing(pois, cfg({
    sizingMode: 'duration', targetMinutes: 120, stopsOverride: null,
  }));
  check('sans consigne, les arrêts redeviennent déduits du temps',
    auto.stopsTarget === stopsForBudget(120, model) && auto.stopsMin < auto.stopsMax,
    `${auto.stopsMin} / ${auto.stopsTarget} / ${auto.stopsMax}`);

  // Et la consigne ne doit rien changer au mode par arrêts.
  const byStops = effectiveSizing(pois, cfg({
    sizingMode: 'stops', stopsMin: 5, stopsTarget: 7, stopsMax: 9,
    maxDistanceKm: 3, stopsOverride: 12,
  }));
  check('mode par arrêts : la consigne du mode temps est ignorée',
    byStops.stopsTarget === 7 && byStops.maxDistanceKm === 3);

  // Enfin, la génération réelle doit produire des parcours de cette taille.
  const planned = planRoutes(pois, 'Testville', cfg({
    sizingMode: 'duration', targetMinutes: 150, stopsOverride: 5,
  }));
  check('parcours générés avec exactement le nombre d\'arrêts imposé',
    planned.length > 0 && planned.every(r => r.steps.length === 5),
    `${planned.length} parcours de ${planned.map(r => r.steps.length).join(', ')} arrêts`);
}

console.log('\n== Parcours libres : départs répartis dans la commune ==');
{
  // Commune type : ~7 km nord-sud, ~9 km est-ouest.
  const city: CityInfo = {
    name: 'Antibes',
    displayName: 'Antibes, Alpes-Maritimes',
    lat: 43.58,
    lng: 7.12,
    bbox: [43.548, 43.612, 7.062, 7.178],
  };
  const free = (o: Partial<RouteConfig> = {}): RouteConfig => ({
    ...DEFAULT_ROUTE_CONFIG, kind: 'free', targetDistanceKm: 3.5, ...o,
  });

  const starts = spreadStartPoints(city, free(), 4);
  check('un départ par boucle', starts.length === 4);
  check('aucun départ n\'en double un autre',
    new Set(starts.map(s => `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`)).size === 4);

  // Le grief de départ : quatre boucles de 3,5 km parties du même point se
  // recouvrent. Il faut au moins un rayon de boucle entre deux départs.
  const loopRadiusM = (3.5 * 1000) / (2 * Math.PI);
  const gaps = starts.flatMap((a, i) =>
    starts.slice(i + 1).map(b => haversineM(a, b)));
  check('des départs assez éloignés pour donner des boucles distinctes',
    Math.min(...gaps) > loopRadiusM,
    `${Math.round(Math.min(...gaps))} m au plus près, rayon de boucle ${Math.round(loopRadiusM)} m`);

  // …mais qui restent dans la commune, sinon on trace ailleurs qu'ici.
  const [south, north, west, east] = city.bbox;
  check('tous les départs à l\'intérieur de la commune',
    starts.every(s => s.lat > south && s.lat < north && s.lng > west && s.lng < east));

  // Le territoire est plus large que haut : la répartition doit le suivre.
  const latSpan = Math.max(...starts.map(s => s.lat)) - Math.min(...starts.map(s => s.lat));
  const lngSpan = Math.max(...starts.map(s => s.lng)) - Math.min(...starts.map(s => s.lng));
  check('la répartition épouse la forme de la commune',
    lngSpan > latSpan, `${lngSpan.toFixed(4)}° est-ouest contre ${latSpan.toFixed(4)}° nord-sud`);

  check('chaque départ est situé en clair',
    starts.every(s => /^Secteur (nord|sud|est|ouest|nord-est|nord-ouest|sud-est|sud-ouest) d'Antibes$/.test(s.label)),
    starts.map(s => s.label).join(' · '));
  check('les secteurs nommés correspondent aux caps',
    sectorName(0) === 'nord' && sectorName(90) === 'est' &&
    sectorName(225) === 'sud-ouest' && sectorName(359) === 'nord');
  check('élision correcte devant une consonne',
    spreadStartPoints({ ...city, name: 'Nîmes' }, free(), 2)[0].label.endsWith('de Nîmes'));

  // Les départs ne bougent pas d'un appel à l'autre : l'écran de réglages peut
  // donc annoncer exactement ceux qui serviront.
  check('répartition déterministe',
    JSON.stringify(spreadStartPoints(city, free(), 4)) === JSON.stringify(starts));

  // Un départ imposé reste un départ imposé.
  const pinned = { lat: 43.6, lng: 7.13, label: 'Ma position' };
  const forced = spreadStartPoints(city, free({ start: pinned }), 3);
  check('un départ choisi à la main l\'emporte sur la répartition',
    forced.length === 3 && forced.every(s => s.label === 'Ma position' && s.lat === 43.6));

  const centred = spreadStartPoints(city, free({ spreadStarts: false }), 3);
  check('« depuis le centre » ramène tout au centre-ville',
    centred.every(s => s.lat === city.lat && s.lng === city.lng),
    centred[0].label);

  const single = spreadStartPoints(city, free(), 1);
  check('une seule boucle part du centre, pas d\'un secteur',
    single.length === 1 && single[0].lat === city.lat);

  // Une ville géocodée à l'adresse près n'a pas d'emprise : la répartition doit
  // quand même écarter les départs, sinon les boucles se superposent à nouveau.
  const pointCity: CityInfo = { ...city, bbox: [43.58, 43.58, 7.12, 7.12] };
  const tiny = spreadStartPoints(pointCity, free(), 3);
  const tinyGaps = tiny.flatMap((a, i) => tiny.slice(i + 1).map(b => haversineM(a, b)));
  check('emprise nulle : les départs sont quand même écartés',
    Math.min(...tinyGaps) > loopRadiusM * 0.8,
    `${Math.round(Math.min(...tinyGaps))} m au plus près`);

  // Plus la boucle est longue, plus il faut d'écart entre deux départs.
  const longLoops = spreadStartPoints(pointCity, free({ targetDistanceKm: 12 }), 3);
  const longGap = haversineM(longLoops[0], longLoops[1]);
  check('des boucles plus longues écartent davantage les départs',
    longGap > Math.min(...tinyGaps), `${Math.round(longGap)} m contre ${Math.round(Math.min(...tinyGaps))} m`);
}

console.log('\n== Parcours libres : où se posent les arrêts ==');
{
  // Un tracé réaliste : un chemin de parc, un pont sur une départementale, un
  // bord de fleuve, une rue. Chaque manœuvre fait ~200 m.
  const leg = (name: string, ref: string, mode: string, fromLat: number, toLat: number) => ({
    name, ref, mode,
    path: [[fromLat, 7.12], [(fromLat + toLat) / 2, 7.12], [toLat, 7.12]] as [number, number][],
  });
  const maneuvers = [
    leg('allée des Tilleuls', '', 'walking', 43.5800, 43.5818),
    leg('', 'D 6007', 'walking', 43.5818, 43.5836),
    leg('quai de la Sèvre', '', 'walking', 43.5836, 43.5854),
    leg('rue du Marché', '', 'walking', 43.5854, 43.5872),
  ];

  const trace = buildTrace(maneuvers);
  check('le tracé est mesuré de bout en bout',
    trace.points.length === 9 && Math.abs(trace.totalM - 800) < 20,
    `${trace.points.length} points, ${Math.round(trace.totalM)} m`);
  check('les jonctions entre manœuvres ne sont pas comptées deux fois',
    new Set(trace.points.map(p => p.join(','))).size === trace.points.length);

  const onTrace = (p: { lat: number; lng: number }) =>
    trace.points.some(q => haversineM({ lat: q[0], lng: q[1] }, p) < 1);

  // Le cœur du correctif : un arrêt est un point DU TRACÉ, pas un point
  // théorique posé à la boussole qui tomberait dans le fleuve ou un champ.
  const stops = placeStops(trace, 3);
  check('trois arrêts posés', stops.length === 3);
  check('chaque arrêt est sur le tracé, donc sur une voie praticable',
    stops.every(onTrace), stops.map(s => s.streetName || '(sans nom)').join(' · '));
  check('les arrêts sont répartis, pas groupés',
    stops.every((s, i) => i === 0 || s.distanceM - stops[i - 1].distanceM > trace.totalM / 8),
    stops.map(s => `${Math.round(s.distanceM)} m`).join(', '));
  check('aucun arrêt sur le départ ni sur l\'arrivée',
    stops.every(s => s.distanceM > 0 && s.distanceM < trace.totalM));

  // La départementale traverse le tracé : aucun arrêt ne doit y tomber.
  const onRoad = (s: { lat: number }) => s.lat > 43.5818 && s.lat < 43.5836;
  check('aucun arrêt sur la départementale',
    !stops.some(onRoad),
    stops.map(s => s.lat.toFixed(4)).join(', '));

  check('une route numérotée est reconnue',
    ['D 6007', 'N7', 'A 8', 'M 6007', 'E 15'].every(isNumberedRoad) &&
    !isNumberedRoad('') && !isNumberedRoad('rue du Marché') && !isNumberedRoad('V 65'));

  // Un tracé qui prend le bac ou le train n'est pas une boucle à pied.
  check('un tronçon en bac est détecté',
    usesForbiddenMode([...maneuvers, leg('bac', '', 'ferry', 43.587, 43.589)]));
  check('un tronçon en train est détecté',
    usesForbiddenMode([leg('ligne', '', 'train', 43.58, 43.59)]));
  check('un parcours entièrement à pied passe',
    !usesForbiddenMode(maneuvers));

  // Une longue traversée de départementale, plus large que la moitié d'un
  // intervalle : la recherche doit tout de même en sortir.
  const crossing = buildTrace([
    leg('rue des Halles', '', 'walking', 43.5800, 43.5820),
    leg('', 'D 6007', 'walking', 43.5820, 43.5880),
    leg('chemin du Bois', '', 'walking', 43.5880, 43.5900),
  ]);
  const crossed = placeStops(crossing, 1);
  check('une longue départementale est contournée, pas subie',
    crossed.length === 1 && (crossed[0].lat <= 43.5820 || crossed[0].lat >= 43.5880),
    `arrêt à ${Math.round(crossed[0].distanceM)} m sur ${crossed[0].streetName || '(sans nom)'}`);

  // Tout le tracé est une départementale : aucun arrêt n'est posé. La règle
  // prime sur le remplissage — l'appelant rejette alors la boucle.
  const allRoad = buildTrace([leg('', 'D 12', 'walking', 43.58, 43.60)]);
  check('tracé entièrement à trafic : aucun arrêt posé',
    placeStops(allRoad, 3).length === 0);

  // Une seule fenêtre praticable sur tout le tracé : les deux arrêts ne
  // doivent pas s'y superposer. Le second n'est pas posé, plutôt que de créer
  // deux repères au même endroit avec un segment vide entre eux.
  const narrow = buildTrace([
    leg('', 'D 12', 'walking', 43.5800, 43.5836),
    leg('passage du Gué', '', 'walking', 43.5836, 43.5838),
    leg('', 'D 12', 'walking', 43.5838, 43.5890),
  ]);
  const squeezed = placeStops(narrow, 2);
  check('fenêtre praticable unique : un seul arrêt, pas deux superposés',
    squeezed.length === 1 && squeezed[0].streetName === 'passage du Gué',
    `${squeezed.length} arrêt(s) à ${squeezed.map(s => Math.round(s.distanceM)).join(', ')} m`);

  // Quoi qu'il arrive, les arrêts posés sont strictement ordonnés et espacés :
  // c'est ce que suppose le découpage en segments du mode live.
  const ordered = placeStops(crossing, 3);
  check('les arrêts restent ordonnés et espacés même sous contrainte',
    ordered.every((s, i) => i === 0 || s.distanceM > ordered[i - 1].distanceM + 1),
    ordered.map(s => `${Math.round(s.distanceM)} m`).join(', '));

  // Un point de jonction appartient à la voie que l'on aborde, pas à celle que
  // l'on quitte — sinon le début de chaque rue hériterait du nom de la
  // précédente, et de son interdiction.
  const junction = trace.maneuverOf[trace.cumulativeM.findIndex(c => c >= 600)];
  check('les jonctions sont attribuées à la voie abordée',
    trace.maneuvers[junction].name === 'rue du Marché',
    trace.maneuvers[junction].name);

  // Les segments entre arrêts doivent couvrir le tracé sans trou : c'est ce
  // que suit le mode live de l'application.
  const slices = stops.map((s, i) =>
    sliceTrace(trace, i === 0 ? 0 : stops[i - 1].distanceM, s.distanceM));
  check('les segments entre arrêts suivent le tracé',
    slices.every(sl => sl.length >= 2) &&
    Math.abs(slices.reduce((sum, sl) => sum + tracePathLengthM(sl), 0) -
      stops[stops.length - 1].distanceM) < 5,
    slices.map(sl => `${Math.round(tracePathLengthM(sl))} m`).join(' + '));
  check('chaque segment démarre où le précédent s\'arrête',
    slices.every((sl, i) => i === 0 ||
      haversineM(
        { lat: slices[i - 1][slices[i - 1].length - 1][0], lng: slices[i - 1][slices[i - 1].length - 1][1] },
        { lat: sl[0][0], lng: sl[0][1] }) < 1));
}

console.log('\n== Règles de sécurité : eau, rail, routes, champs ==');
{
  const excluded = (tags: Record<string, string>) => safetyExclusion(tags) !== null;

  check('un cours d\'eau est écarté', excluded({ waterway: 'river', name: 'La Sèvre' }));
  check('un plan d\'eau est écarté', excluded({ natural: 'water', name: 'Étang' }));
  check('un bassin est écarté', excluded({ landuse: 'reservoir', name: 'Retenue' }));
  check('une épave est écartée', excluded({ historic: 'wreck', name: 'Épave' }));
  check('une voie ferrée est écartée', excluded({ railway: 'rail' }));
  check('un quai de gare est écarté', excluded({ railway: 'platform' }));
  check('une emprise ferroviaire est écartée', excluded({ landuse: 'railway' }));
  check('une nationale est écartée', excluded({ highway: 'trunk', name: 'N 7' }));
  check('une départementale à trafic est écartée', excluded({ highway: 'primary' }));
  check('une bretelle est écartée', excluded({ highway: 'secondary_link' }));
  check('un champ est écarté', excluded({ landuse: 'farmland' }));
  check('une vigne est écartée', excluded({ landuse: 'vineyard' }));
  check('une carrière est écartée', excluded({ landuse: 'quarry' }));
  check('une friche est écartée', excluded({ natural: 'scrub' }));

  // …sans écarter ce qui doit rester : les règles seraient inutiles si elles
  // vidaient l'inventaire.
  check('un musée passe', !excluded({ tourism: 'museum', name: 'Musée Picasso' }));
  check('une plage passe', !excluded({ natural: 'beach', name: 'Plage de la Salis' }));
  check('un parc passe', !excluded({ leisure: 'park', name: 'Jardin Thuret' }));
  check('une gare patrimoniale passe',
    !excluded({ railway: 'station', historic: 'building', name: 'Gare de 1863' }));
  check('un barrage visitable passe', !excluded({ waterway: 'dam', name: 'Barrage' }));
  check('une rue piétonne passe', !excluded({ highway: 'pedestrian', name: 'Rue Sainte' }));
}

console.log(failures === 0 ? '\nTous les tests passent.\n' : `\n${failures} test(s) en échec.\n`);
process.exit(failures === 0 ? 0 : 1);
