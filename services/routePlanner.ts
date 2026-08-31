/**
 * Planificateur de parcours.
 *
 * Tout est déterministe : à partir d'un lot de POI et de réglages, on sait
 * exactement combien de parcours sortiront et par où ils passeront. L'IA
 * n'intervient qu'ensuite, pour écrire les textes (voir geminiService).
 */

import {
  Capacity,
  GeneratedRoute,
  PathPoint,
  POI,
  PoiFilters,
  PoiTheme,
  RouteConfig,
  RouteStep,
  POI_THEMES,
} from '../types';
import {
  STREET_FACTOR,
  centroid,
  distanceToNearestM,
  haversineM,
  orderStops,
  pathLengthM,
} from './geo';
import { straightPath } from './routingService';

/** Nombre de parcours dans lesquels un même POI peut apparaître. */
const maxUsagePerPoi = (config: RouteConfig) => (config.reusePois ? 2 : 1);

// --------------------------------------------------------------------------
// Filtres
// --------------------------------------------------------------------------

const normalize = (value: string) =>
  value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export const applyFilters = (pois: POI[], filters: PoiFilters): POI[] => {
  const needle = normalize(filters.search.trim());

  return pois.filter((poi) => {
    if (filters.themes.length > 0 && !filters.themes.includes(poi.theme)) return false;
    if (poi.notoriety < filters.minNotoriety) return false;
    if (needle && !normalize(`${poi.name} ${poi.subtype}`).includes(needle)) return false;
    return true;
  });
};

// --------------------------------------------------------------------------
// Cadrage par le temps
// --------------------------------------------------------------------------

/** Ce que « coûte » en temps un arrêt moyen dans cette ville. */
export interface TimeModel {
  /** Durée de visite moyenne d'un lieu retenu. */
  avgVisitMinutes: number;
  /** Temps de trajet typique entre deux lieux voisins. */
  avgLegMinutes: number;
}

/** Valeurs de repli quand le lot est trop maigre pour rien mesurer. */
const FALLBACK_TIME_MODEL: TimeModel = { avgVisitMinutes: 20, avgLegMinutes: 5 };

/**
 * Marge sur le budget de marche déduit du temps.
 *
 * Le trajet médian décrit un cas typique ; certains enchaînements sont plus
 * longs. Sans cette marge, la contrainte de distance rejetterait des parcours
 * pourtant conformes au temps demandé.
 */
const WALK_BUDGET_MARGIN = 1.4;

/**
 * Mesure le rythme réel de la ville : combien de temps prend une visite, et
 * combien de temps sépare deux arrêts consécutifs.
 *
 * On mesure la distance au DEUXIÈME plus proche voisin, pas au premier : dans
 * une chaîne d'arrêts, le lieu suivant n'est presque jamais le plus proche —
 * celui-ci vient souvent d'être visité. Le premier voisin sous-estimerait
 * systématiquement les trajets réels.
 *
 * Et on prend la médiane plutôt que la moyenne : une poignée de lieux isolés
 * en périphérie fausserait la moyenne sans rien dire de la marche en ville.
 */
export const estimateTimeModel = (pois: POI[], config: RouteConfig): TimeModel => {
  if (pois.length < 2) return FALLBACK_TIME_MODEL;

  const avgVisitMinutes =
    pois.reduce((sum, p) => sum + p.visitMinutes, 0) / pois.length;

  const neighbourM = pois
    .map((poi) => {
      const distances = pois
        .filter((other) => other !== poi)
        .map((other) => haversineM(poi, other))
        .sort((a, b) => a - b);
      return distances[Math.min(1, distances.length - 1)];
    })
    .filter((d) => Number.isFinite(d))
    .sort((a, b) => a - b);

  if (neighbourM.length === 0) return FALLBACK_TIME_MODEL;

  const medianM = neighbourM[Math.floor(neighbourM.length / 2)];
  const avgLegMinutes = ((medianM * STREET_FACTOR) / 1000 / config.paceKmh) * 60;

  return { avgVisitMinutes, avgLegMinutes };
};

/**
 * Combien d'arrêts tiennent dans un budget de temps ?
 *
 * Un parcours de n arrêts coûte n visites et n-1 trajets, d'où
 * `budget = n × visite + (n-1) × trajet`, que l'on renverse.
 */
export const stopsForBudget = (budgetMinutes: number, model: TimeModel): number => {
  const perStop = model.avgVisitMinutes + model.avgLegMinutes;
  if (perStop <= 0) return 2;
  return Math.max(2, Math.round((budgetMinutes + model.avgLegMinutes) / perStop));
};

/** Bornes de taille effectivement appliquées à un parcours. */
export interface Sizing {
  stopsMin: number;
  stopsTarget: number;
  stopsMax: number;
  maxDistanceKm: number | null;
}

/**
 * Les bornes réellement utilisées, quel que soit le mode de cadrage.
 *
 * En mode `duration`, tout découle du temps disponible : le nombre d'arrêts,
 * puis la distance de marche que le temps restant permet une fois les visites
 * déduites. C'est ce qui permet de ne régler qu'un seul curseur.
 */
export const effectiveSizing = (pois: POI[], config: RouteConfig): Sizing => {
  if (config.sizingMode !== 'duration') {
    return {
      stopsMin: config.stopsMin,
      stopsTarget: config.stopsTarget,
      stopsMax: config.stopsMax,
      maxDistanceKm: config.maxDistanceKm,
    };
  }

  const model = estimateTimeModel(pois, config);
  const target = stopsForBudget(config.targetMinutes, model);

  // Le budget de marche vient du modèle de trajets, pas du temps « restant » :
  // si les visites mangent tout le budget, un reste négatif donnerait une
  // distance absurde qui étranglerait la planification.
  const walkMinutes = (target - 1) * model.avgLegMinutes * WALK_BUDGET_MARGIN;

  return {
    // Une marge de part et d'autre : tous les quartiers n'ont pas la même
    // densité, un parcours un peu plus court reste dans l'esprit du budget.
    stopsMin: Math.max(2, Math.round(target * 0.75)),
    stopsTarget: target,
    stopsMax: Math.max(3, Math.round(target * 1.3)),
    maxDistanceKm: Math.max(0.5, Math.round((walkMinutes / 60) * config.paceKmh * 10) / 10),
  };
};

/** Applique le cadrage effectif : le reste du code n'a plus à s'en soucier. */
const sized = (pois: POI[], config: RouteConfig): RouteConfig => ({
  ...config,
  ...effectiveSizing(pois, config),
});

// --------------------------------------------------------------------------
// Capacité
// --------------------------------------------------------------------------

/**
 * Combien de parcours cette sélection de POI peut-elle porter ?
 *
 * C'est le remplacement direct des anciens quotas figés (11 / 16 / 26) :
 * le nombre sort du terrain, pas d'une case cochée.
 */
export const computeCapacity = (pois: POI[], rawConfig: RouteConfig): Capacity => {
  const config = sized(pois, rawConfig);
  const byTheme: Record<string, number> = {};
  POI_THEMES.forEach((theme) => {
    byTheme[theme] = pois.filter((p) => p.theme === theme).length;
  });

  const budget = pois.length * maxUsagePerPoi(config);

  // Au maximum on remplit les parcours au minimum d'arrêts ; à la cible on
  // obtient des parcours plus riches, donc moins nombreux.
  let maxRoutes = Math.floor(budget / Math.max(1, config.stopsMin));
  let recommendedRoutes = Math.floor(budget / Math.max(1, config.stopsTarget));

  if (config.themeMode === 'thematic') {
    // Un parcours ne pioche que dans un thème : les thèmes trop maigres ne
    // produisent rien, et leurs POI sont perdus pour le compte.
    const perTheme = POI_THEMES.map((theme) => {
      const count = byTheme[theme] * maxUsagePerPoi(config);
      return {
        max: Math.floor(count / Math.max(1, config.stopsMin)),
        recommended: Math.floor(count / Math.max(1, config.stopsTarget)),
      };
    });
    maxRoutes = perTheme.reduce((sum, t) => sum + t.max, 0);
    recommendedRoutes = perTheme.reduce((sum, t) => sum + t.recommended, 0);
  }

  // Durée annoncée : ce que coûtent réellement stopsTarget arrêts dans cette
  // ville. En mode `duration` elle retombe sur le budget demandé, ce qui rend
  // l'estimation vérifiable d'un coup d'œil.
  const model = estimateTimeModel(pois, config);
  const estimatedEffortMinutes = (config.stopsTarget - 1) * model.avgLegMinutes;
  const estimatedMinutes =
    config.stopsTarget * model.avgVisitMinutes + estimatedEffortMinutes;

  return {
    poolSize: pois.length,
    maxRoutes,
    recommendedRoutes: Math.min(recommendedRoutes, maxRoutes),
    leftovers: Math.max(0, pois.length - maxRoutes * config.stopsMin),
    byTheme,
    stopsTarget: config.stopsTarget,
    estimatedMinutes: Math.round(estimatedMinutes),
    estimatedEffortMinutes: Math.round(estimatedEffortMinutes),
    maxDistanceKm: config.maxDistanceKm,
  };
};

// --------------------------------------------------------------------------
// Constitution d'un parcours
// --------------------------------------------------------------------------

interface Candidate {
  poi: POI;
  used: number;
}

/**
 * Choisit le point de départ d'un nouveau parcours : un lieu marquant, mais
 * éloigné des parcours déjà tracés pour couvrir toute la ville plutôt que de
 * tourner autour du même quartier.
 */
const pickSeed = (available: Candidate[], usedCenters: { lat: number; lng: number }[]): Candidate => {
  const sorted = [...available].sort((a, b) => b.poi.notoriety - a.poi.notoriety);
  if (usedCenters.length === 0) return sorted[0];

  // On note chaque candidat sur sa notoriété et son éloignement (plafonné à
  // 2 km : au-delà, plus loin n'est pas mieux).
  let best = sorted[0];
  let bestScore = -Infinity;

  for (const candidate of sorted.slice(0, 40)) {
    const spread = Math.min(2000, distanceToNearestM(candidate.poi, usedCenters));
    const score = candidate.poi.notoriety + (spread / 2000) * 60;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
};

/**
 * Fait grandir un parcours autour de sa graine, en ajoutant à chaque tour le
 * POI le plus proche du groupe, tant que le budget de marche le permet.
 */
const growCluster = (seed: Candidate, available: Candidate[], config: RouteConfig): Candidate[] => {
  const cluster: Candidate[] = [seed];
  const pool = available.filter((c) => c !== seed);
  const budgetM = config.maxDistanceKm !== null ? config.maxDistanceKm * 1000 : Infinity;

  while (cluster.length < config.stopsMax && pool.length > 0) {
    const members = cluster.map((c) => c.poi);

    let bestIdx = -1;
    let bestDist = Infinity;
    pool.forEach((candidate, i) => {
      const d = distanceToNearestM(candidate.poi, members);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    });
    if (bestIdx === -1) break;

    const next = pool[bestIdx];
    const tentative = orderStops([...members, next.poi], config.loop);
    const length = pathLengthM(tentative, config.loop);

    if (length > budgetM) {
      // Trop long : si le minimum est déjà atteint on s'arrête, sinon on écarte
      // ce candidat et on tente le suivant.
      if (cluster.length >= config.stopsMin) break;
      pool.splice(bestIdx, 1);
      continue;
    }

    cluster.push(next);
    pool.splice(bestIdx, 1);

    // Une fois la cible atteinte, on ne continue que si le parcours reste
    // court — c'est ce qui donne des parcours denses en centre-ville.
    if (cluster.length >= config.stopsTarget && length > budgetM * 0.6) break;
  }

  return cluster;
};

const titleFor = (stops: POI[], city: string, themeMode: string): string => {
  const anchor = [...stops].sort((a, b) => b.notoriety - a.notoriety)[0];
  if (themeMode === 'thematic') return `${stops[0].theme} — autour de ${anchor.name}`;
  return `${city} : de ${stops[0].name} à ${stops[stops.length - 1].name}`;
};

const dominantTheme = (stops: POI[]): string => {
  const counts = new Map<PoiTheme, number>();
  stops.forEach((s) => counts.set(s.theme, (counts.get(s.theme) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
};

/** Transforme une liste ordonnée de POI en parcours complet et chiffré. */
export const buildRoute = (
  stops: POI[],
  city: string,
  config: RouteConfig,
  index: number
): GeneratedRoute => {
  const ordered = orderStops(stops, config.loop);

  // Estimations à vol d'oiseau corrigé. Si le routage par les rues est activé,
  // routingService remplacera ensuite ces valeurs par les distances réelles.
  const steps: RouteStep[] = ordered.map((poi, i) => {
    const distanceFromPrevM =
      i === 0 ? 0 : Math.round(pathLengthM([ordered[i - 1], poi], false));
    return {
      ...poi,
      stepNumber: i + 1,
      distanceFromPrevM,
      durationFromPrevS: Math.round((distanceFromPrevM / 1000 / config.paceKmh) * 3600),
      pathFromPrev:
        i === 0
          ? []
          : ([
              [ordered[i - 1].lat, ordered[i - 1].lng],
              [poi.lat, poi.lng],
            ] as PathPoint[]),
    };
  });

  const totalM = pathLengthM(ordered, config.loop);
  const walkingMinutes = (totalM / 1000 / config.paceKmh) * 60;
  const visitMinutes = ordered.reduce((sum, poi) => sum + poi.visitMinutes, 0);

  return {
    id: `route-${Date.now()}-${index}`,
    createdAt: new Date().toISOString(),
    summary: {
      title: titleFor(ordered, city, config.themeMode),
      city,
      theme: dominantTheme(ordered),
      travelMode: config.travelMode,
      totalDistanceKm: Math.round((totalM / 1000) * 10) / 10,
      walkingMinutes: Math.round(walkingMinutes),
      visitMinutes,
      totalMinutes: Math.round(walkingMinutes + visitMinutes),
      stopsCount: ordered.length,
      loop: config.loop,
    },
    steps,
    path: straightPath(ordered, config.loop),
    geometrySource: 'straight',
  };
};

// --------------------------------------------------------------------------
// Planification complète
// --------------------------------------------------------------------------

/**
 * Découpe le lot de POI en autant de parcours que demandé — ou que possible.
 *
 * `config.routeCount === null` signifie « donne-moi tout ce que la ville peut
 * porter ». C'est le mode par défaut.
 */
export const planRoutes = (
  pois: POI[],
  city: string,
  rawConfig: RouteConfig
): GeneratedRoute[] => {
  // Le cadrage par le temps est résolu une fois pour toutes : la planification
  // ne raisonne plus qu'en nombre d'arrêts et en kilomètres.
  const config = sized(pois, rawConfig);
  if (pois.length < config.stopsMin) return [];

  const capacity = computeCapacity(pois, config);
  const target = config.routeCount ?? capacity.maxRoutes;
  if (target <= 0) return [];

  const candidates: Candidate[] = pois.map((poi) => ({ poi, used: 0 }));
  const maxUsage = maxUsagePerPoi(config);
  const routes: GeneratedRoute[] = [];
  const centers: { lat: number; lng: number }[] = [];

  // En mode thématique on tourne sur les thèmes, pour ne pas produire dix
  // parcours patrimoine avant le premier parcours nature.
  const themeQueue = POI_THEMES.filter((theme) =>
    candidates.some((c) => c.poi.theme === theme)
  );
  let themeCursor = 0;
  let exhaustedThemes = 0;

  while (routes.length < target) {
    let available = candidates.filter((c) => c.used < maxUsage);
    let lockedTheme: PoiTheme | null = null;

    if (config.themeMode === 'thematic') {
      if (themeQueue.length === 0) break;
      lockedTheme = themeQueue[themeCursor % themeQueue.length];
      themeCursor++;
      available = available.filter((c) => c.poi.theme === lockedTheme);

      if (available.length < config.stopsMin) {
        // Ce thème est épuisé. Si tous le sont, on arrête.
        exhaustedThemes++;
        if (exhaustedThemes >= themeQueue.length) break;
        continue;
      }
      exhaustedThemes = 0;
    }

    if (available.length < config.stopsMin) break;

    const seed = pickSeed(available, centers);
    const cluster = growCluster(seed, available, config);

    if (cluster.length < config.stopsMin) {
      // Graine trop isolée pour bâtir un parcours : on la retire du jeu pour
      // ne pas la retenter indéfiniment.
      seed.used = maxUsage;
      continue;
    }

    cluster.forEach((c) => {
      c.used += 1;
    });

    const route = buildRoute(
      cluster.map((c) => c.poi),
      city,
      config,
      routes.length
    );
    routes.push(route);
    centers.push(centroid(route.steps));
  }

  return routes;
};

/**
 * Distance entre le point de départ choisi par l'utilisateur et un parcours.
 * Sert à trier les propositions par proximité.
 */
export const distanceFromStart = (
  route: GeneratedRoute,
  start: { lat: number; lng: number }
): number => haversineM(start, route.steps[0]);
