import { computeCapacity, planRoutes, applyFilters } from '../services/routePlanner';
import { pathLengthM, haversineM } from '../services/geo';
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

console.log(failures === 0 ? '\nTous les tests passent.\n' : `\n${failures} test(s) en échec.\n`);
process.exit(failures === 0 ? 0 : 1);
