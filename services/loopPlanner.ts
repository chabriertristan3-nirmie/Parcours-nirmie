/**
 * Parcours libres : des boucles à la distance voulue, sans arrêt imposé.
 *
 * Le principe est inverse de celui des parcours touristiques. Ici la distance
 * commande : on pose des jalons sur un cercle autour du départ, on demande à
 * OSRM l'itinéraire qui les relie, et on ajuste le rayon jusqu'à tomber sur la
 * longueur demandée. Les lieux de l'inventaire ne servent qu'à attirer la
 * boucle vers ce qui est agréable — on passe devant, on ne s'arrête pas.
 */

import {
  Ambience,
  CityScan,
  GeneratedRoute,
  PathPoint,
  POI,
  PoiTheme,
  RouteConfig,
  RouteStep,
  StartPoint,
} from '../types';
import { bearingDeg, destinationPoint, haversineM, tracePathLengthM } from './geo';
import { fetchRoutedPath } from './routingService';

/** Thèmes vers lesquels attirer la boucle, selon l'ambiance demandée. */
const AMBIENCE_THEMES: Record<Ambience, PoiTheme[] | null> = {
  any: null,
  nature: ['Nature & Jardins', 'Panoramas & Points de vue'],
  heritage: ['Patrimoine & Histoire', 'Places & Vie locale'],
};

/** Nombre de jalons posés sur le cercle. Quatre donnent une boucle franche. */
const WAYPOINTS_PER_LOOP = 4;

/** Ouverture, de part et d'autre d'un jalon, où l'on cherche un lieu agréable. */
const SECTOR_HALF_WIDTH_DEG = 42;

/**
 * Écart au rayon toléré pour un repère, en proportion de ce rayon.
 * Au-delà, le lieu déformerait trop la boucle : on garde le jalon géométrique.
 */
const ANCHOR_RADIUS_TOLERANCE = 0.35;

/** Écart accepté entre la distance obtenue et celle demandée. */
const DISTANCE_TOLERANCE = 0.12;

/** Tentatives d'ajustement du rayon avant de garder la meilleure boucle. */
const MAX_ATTEMPTS = 5;

/**
 * Les rues ne suivent pas le cercle : le trajet réel est plus long que la
 * circonférence théorique. On part donc d'un rayon volontairement réduit.
 */
const INITIAL_RADIUS_FACTOR = 0.82;

export const anchorsFor = (scan: CityScan, ambience: Ambience): POI[] => {
  const themes = AMBIENCE_THEMES[ambience];
  const pool = themes ? scan.pois.filter((p) => themes.includes(p.theme)) : scan.pois;
  // Les lieux notables font de meilleurs repères qu'une fontaine anonyme.
  return pool.filter((p) => p.notoriety >= 30);
};

/** Écart angulaire entre deux caps, entre 0 et 180°. */
const angleGap = (a: number, b: number): number => {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
};

/**
 * Meilleur lieu agréable dans une direction donnée.
 *
 * Chercher le lieu le plus proche du point du cercle rate presque tout : les
 * lieux ne tombent jamais pile sur le cercle. On raisonne donc par secteur —
 * « qu'y a-t-il vers le nord-est ? » — et on retient celui dont la distance au
 * départ colle le mieux au rayon voulu, pour ne pas déformer la boucle.
 */
export const anchorInSector = (
  start: { lat: number; lng: number },
  anchors: POI[],
  radiusM: number,
  sectorBearingDeg: number,
  used: Set<string>
): POI | null => {
  let best: POI | null = null;
  let bestGap = Infinity;

  for (const anchor of anchors) {
    if (used.has(anchor.id)) continue;
    if (angleGap(bearingDeg(start, anchor), sectorBearingDeg) > SECTOR_HALF_WIDTH_DEG) continue;

    const gap = Math.abs(haversineM(start, anchor) - radiusM);
    if (gap < bestGap) {
      bestGap = gap;
      best = anchor;
    }
  }

  return best && bestGap <= radiusM * ANCHOR_RADIUS_TOLERANCE ? best : null;
};

/** Jalons répartis sur un cercle, à partir d'une orientation donnée. */
const circleWaypoints = (
  center: { lat: number; lng: number },
  radiusM: number,
  startAngleDeg: number
): { lat: number; lng: number }[] =>
  Array.from({ length: WAYPOINTS_PER_LOOP }, (_, i) =>
    destinationPoint(center, startAngleDeg + (i * 360) / WAYPOINTS_PER_LOOP, radiusM)
  );

/**
 * Position d'un lieu le long du tracé : indice du point de tracé le plus
 * proche. Permet de replacer les repères dans l'ordre du parcours.
 */
const nearestPathIndex = (path: PathPoint[], point: { lat: number; lng: number }): number => {
  let bestIndex = 0;
  let bestDist = Infinity;
  path.forEach(([lat, lng], i) => {
    const d = haversineM({ lat, lng }, point);
    if (d < bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  });
  return bestIndex;
};

interface LoopAttempt {
  path: PathPoint[];
  distanceM: number;
  anchors: POI[];
  error: number;
}

/**
 * Trace une boucle et ajuste son rayon jusqu'à approcher la distance visée.
 * Retourne la meilleure tentative, ou `null` si le routeur n'a rien renvoyé.
 */
const planOneLoop = async (
  start: StartPoint,
  config: RouteConfig,
  anchors: POI[],
  startAngleDeg: number,
  usedAnchors: Set<string>
): Promise<LoopAttempt | null> => {
  const targetM = config.targetDistanceKm * 1000;
  let radiusM = (targetM / (2 * Math.PI)) * INITIAL_RADIUS_FACTOR;
  let best: LoopAttempt | null = null;

  /**
   * Une tentative à un rayon donné. `withAnchors` permet de couper
   * l'accrochage aux lieux : il rend la boucle plus agréable, mais fausse la
   * correction du rayon puisqu'il déplace les jalons de plusieurs centaines de
   * mètres. On s'en passe pour converger, on le remet une fois la bonne
   * dimension trouvée.
   */
  const attemptAt = async (radius: number, withAnchors: boolean) => {
    const chosen: POI[] = [];
    const claimed = new Set(usedAnchors);

    const waypoints = circleWaypoints(start, radius, startAngleDeg).map((point, i) => {
      if (!withAnchors) return point;
      const sectorBearing = startAngleDeg + (i * 360) / WAYPOINTS_PER_LOOP;
      const anchor = anchorInSector(start, anchors, radius, sectorBearing, claimed);
      if (!anchor) return point;
      claimed.add(anchor.id);
      chosen.push(anchor);
      return { lat: anchor.lat, lng: anchor.lng };
    });

    const routed = await fetchRoutedPath([start, ...waypoints], config.travelMode, true);
    if (!routed) return null;

    const path = routed.legs.flatMap((leg, i) => (i === 0 ? leg.path : leg.path.slice(1)));
    return {
      path,
      distanceM: routed.totalDistanceM,
      anchors: chosen,
      error: Math.abs(routed.totalDistanceM - targetM) / targetM,
    };
  };

  // Phase 1 : trouver le bon rayon, sur une géométrie pure et prévisible.
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const result = await attemptAt(radiusM, false);
    if (!result) return best;

    if (!best || result.error < best.error) best = result;
    if (result.error <= DISTANCE_TOLERANCE) break;

    // Le rayon corrige proportionnellement à l'écart constaté.
    radiusM *= targetM / result.distanceM;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  // Phase 2 : au bon rayon, on attire la boucle vers les lieux agréables.
  // Détourner par un lieu rallonge le circuit : si l'écart devient trop grand,
  // on resserre le rayon et on retente une fois avant de renoncer aux repères.
  const acceptable = (candidate: LoopAttempt) =>
    candidate.error <= Math.max(DISTANCE_TOLERANCE, best?.error ?? 1);

  if (anchors.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const anchored = await attemptAt(radiusM, true);

    if (anchored && acceptable(anchored)) return anchored;

    if (anchored) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const corrected = await attemptAt(radiusM * (targetM / anchored.distanceM), true);
      if (corrected && acceptable(corrected)) return corrected;
      // Ni l'un ni l'autre ne tient la distance : la longueur prime sur le décor.
    }
  }

  return best;
};

/**
 * Construit les étapes d'une boucle : le départ, puis les repères croisés,
 * remis dans l'ordre du tracé et mesurés le long de celui-ci.
 */
const buildFreeSteps = (
  start: StartPoint,
  path: PathPoint[],
  anchors: POI[],
  config: RouteConfig
): RouteStep[] => {
  const departure: POI = {
    id: `start-${Math.round(start.lat * 1e5)}-${Math.round(start.lng * 1e5)}`,
    name: start.label,
    theme: 'Places & Vie locale',
    subtype: 'Départ',
    lat: start.lat,
    lng: start.lng,
    notoriety: 0,
    // Un parcours libre ne comporte aucun temps de visite : c'est de l'effort.
    visitMinutes: 0,
    source: 'manual',
  };

  const ordered = anchors
    .map((poi) => ({ poi, index: nearestPathIndex(path, poi) }))
    .sort((a, b) => a.index - b.index);

  const entries = [{ poi: departure, index: 0 }, ...ordered];

  return entries.map((entry, i) => {
    const segment = i === 0 ? [] : path.slice(entries[i - 1].index, entry.index + 1);
    const distanceM = i === 0 ? 0 : Math.round(tracePathLengthM(segment));
    return {
      ...entry.poi,
      visitMinutes: 0,
      stepNumber: i + 1,
      distanceFromPrevM: distanceM,
      durationFromPrevS: Math.round((distanceM / 1000 / config.paceKmh) * 3600),
      pathFromPrev: segment,
    };
  });
};

const loopTitle = (city: string, anchors: POI[], distanceKm: number, index: number): string => {
  const landmark = [...anchors].sort((a, b) => b.notoriety - a.notoriety)[0];
  if (landmark) return `Boucle de ${distanceKm} km par ${landmark.name}`;
  return `Boucle de ${distanceKm} km à ${city} — n°${index + 1}`;
};

/**
 * Produit les boucles libres demandées.
 *
 * Chaque boucle part dans une direction différente pour éviter de proposer
 * cinq fois le même circuit. Les repères déjà utilisés sont réservés, ce qui
 * écarte les boucles les unes des autres.
 */
export const planFreeRoutes = async (
  scan: CityScan,
  config: RouteConfig,
  onProgress?: (done: number, total: number) => void
): Promise<{ routes: GeneratedRoute[]; failures: number }> => {
  const start: StartPoint = config.start ?? {
    lat: scan.city.lat,
    lng: scan.city.lng,
    label: `Centre de ${scan.city.name}`,
  };

  const total = Math.max(1, config.routeCount ?? 3);
  const anchors = anchorsFor(scan, config.ambience);
  const usedAnchors = new Set<string>();
  const routes: GeneratedRoute[] = [];
  let failures = 0;

  for (let i = 0; i < total; i++) {
    // Les jalons étant répartis tous les 360/4 = 90°, faire tourner une boucle
    // de 90° ou de 180° redonnerait le même circuit. On répartit donc les
    // boucles à l'intérieur d'un seul secteur pour qu'elles diffèrent vraiment.
    const startAngle = (i * 360) / (total * WAYPOINTS_PER_LOOP);
    const attempt = await planOneLoop(start, config, anchors, startAngle, usedAnchors);
    onProgress?.(i + 1, total);

    if (!attempt || attempt.path.length < 2) {
      failures++;
      continue;
    }
    attempt.anchors.forEach((a) => usedAnchors.add(a.id));

    const steps = buildFreeSteps(start, attempt.path, attempt.anchors, config);
    const distanceKm = Math.round((attempt.distanceM / 1000) * 10) / 10;
    const walkingMinutes = Math.round((attempt.distanceM / 1000 / config.paceKmh) * 60);

    routes.push({
      id: `loop-${Date.now()}-${i}`,
      createdAt: new Date().toISOString(),
      summary: {
        title: loopTitle(scan.city.name, attempt.anchors, distanceKm, i),
        city: scan.city.name,
        theme: config.ambience === 'nature' ? 'Nature & Jardins' : 'Patrimoine & Histoire',
        travelMode: config.travelMode,
        kind: 'free',
        totalDistanceKm: distanceKm,
        walkingMinutes,
        // Un parcours libre ne s'arrête nulle part : l'effort est la durée.
        visitMinutes: 0,
        totalMinutes: walkingMinutes,
        stopsCount: steps.length,
        loop: true,
      },
      steps,
      path: attempt.path,
      geometrySource: 'osrm',
    });
  }

  return { routes, failures };
};
