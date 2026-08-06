/**
 * Tracé réel des parcours, en suivant rues et chemins.
 *
 * On interroge les serveurs OSRM de la communauté OpenStreetMap (FOSSGIS),
 * qui exposent un profil piéton et un profil vélo. Aucune clé n'est requise.
 * En cas d'échec, l'appelant retombe sur des lignes droites : un parcours sans
 * tracé exact reste utilisable, un parcours manquant ne l'est pas.
 */

import { GeneratedRoute, PathPoint, POI, RouteConfig, TravelMode } from '../types';

const ENDPOINTS: Record<TravelMode, string> = {
  walk: 'https://routing.openstreetmap.de/routed-foot/route/v1/foot',
  bike: 'https://routing.openstreetmap.de/routed-bike/route/v1/bike',
};

/** Au-delà, le serveur refuse la requête ; nos parcours restent bien en deçà. */
const MAX_STOPS_PER_REQUEST = 100;

const REQUEST_TIMEOUT_MS = 20000;

export interface RoutedLeg {
  distanceM: number;
  durationS: number;
  path: PathPoint[];
}

export interface RoutedPath {
  legs: RoutedLeg[];
  totalDistanceM: number;
}

/** GeoJSON renvoie `[lng, lat]`, l'application travaille en `[lat, lng]`. */
const toPathPoints = (coordinates: [number, number][]): PathPoint[] =>
  coordinates.map(([lng, lat]) => [lat, lng] as PathPoint);

/**
 * Supprime le doublon de jonction entre deux segments consécutifs : la fin
 * d'une manœuvre et le début de la suivante sont le même point.
 */
const concatSegments = (segments: PathPoint[][]): PathPoint[] => {
  const merged: PathPoint[] = [];
  for (const segment of segments) {
    for (const point of segment) {
      const last = merged[merged.length - 1];
      if (last && last[0] === point[0] && last[1] === point[1]) continue;
      merged.push(point);
    }
  }
  return merged;
};

/**
 * Demande le tracé passant par tous les arrêts, dans l'ordre.
 * Retourne `null` si le service est indisponible ou ne trouve pas de chemin.
 */
export const fetchRoutedPath = async (
  stops: { lat: number; lng: number }[],
  mode: TravelMode,
  loop: boolean
): Promise<RoutedPath | null> => {
  if (stops.length < 2) return null;

  const waypoints = loop ? [...stops, stops[0]] : stops;
  if (waypoints.length > MAX_STOPS_PER_REQUEST) return null;

  const coords = waypoints.map((s) => `${s.lng},${s.lat}`).join(';');
  const url = `${ENDPOINTS[mode]}/${coords}?overview=full&geometries=geojson&steps=true`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;

    const json = await response.json();
    if (json.code !== 'Ok' || !json.routes?.[0]) return null;

    const route = json.routes[0];
    const legs: RoutedLeg[] = (route.legs || []).map((leg: any) => {
      // Le tracé fin d'un segment est la suite de ses manœuvres.
      const segments: PathPoint[][] = (leg.steps || [])
        .map((step: any) => step.geometry?.coordinates)
        .filter(Boolean)
        .map((c: [number, number][]) => toPathPoints(c));

      return {
        distanceM: Math.round(leg.distance ?? 0),
        durationS: Math.round(leg.duration ?? 0),
        path: concatSegments(segments),
      };
    });

    // Un segment sans géométrie rendrait le mode live inutilisable.
    if (legs.length === 0 || legs.some((leg) => leg.path.length < 2)) return null;

    return { legs, totalDistanceM: Math.round(route.distance ?? 0) };
  } catch {
    // Réseau coupé, serveur saturé, délai dépassé : repli sur lignes droites.
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

/** Tracé de secours : les arrêts reliés en ligne droite. */
export const straightPath = (stops: POI[], loop: boolean): PathPoint[] => {
  const points = stops.map((s) => [s.lat, s.lng] as PathPoint);
  return loop && points.length > 1 ? [...points, points[0]] : points;
};

/**
 * Recalcule un parcours à partir de son tracé réel : distances, durées et
 * géométrie par étape. La vitesse reste celle choisie par l'utilisateur —
 * on ne garde du routeur que les distances, qui sont des faits.
 */
export const applyRoutedPath = (
  route: GeneratedRoute,
  routed: RoutedPath,
  config: RouteConfig
): GeneratedRoute => {
  const { legs } = routed;

  const steps = route.steps.map((step, i) => {
    // Le segment i-1 mène à l'étape i ; la première étape n'en a pas.
    const leg = i === 0 ? null : legs[i - 1];
    const distanceM = leg?.distanceM ?? 0;
    return {
      ...step,
      distanceFromPrevM: distanceM,
      durationFromPrevS: Math.round((distanceM / 1000 / config.paceKmh) * 3600),
      pathFromPrev: leg?.path ?? [],
    };
  });

  const totalM = routed.totalDistanceM;
  const walkingMinutes = Math.round((totalM / 1000 / config.paceKmh) * 60);
  const visitMinutes = route.summary.visitMinutes;

  return {
    ...route,
    steps,
    path: concatSegments(legs.map((leg) => leg.path)),
    geometrySource: 'osrm',
    summary: {
      ...route.summary,
      totalDistanceKm: Math.round((totalM / 1000) * 10) / 10,
      walkingMinutes,
      totalMinutes: walkingMinutes + visitMinutes,
    },
  };
};

/**
 * Calcule les tracés de tous les parcours d'un pack.
 *
 * Les appels sont séquentiels et espacés : ces serveurs sont mis à disposition
 * gratuitement par la communauté, on ne les inonde pas.
 */
export const routeAll = async (
  routes: GeneratedRoute[],
  config: RouteConfig,
  onProgress?: (done: number, total: number) => void
): Promise<{ routes: GeneratedRoute[]; failures: number }> => {
  const result: GeneratedRoute[] = [];
  let failures = 0;

  for (const route of routes) {
    const loop = route.summary.loop;
    // Une boucle ferme le circuit : un segment de plus que le nombre d'arrêts
    // moins un, soit exactement le nombre d'arrêts.
    const expectedLegs = loop ? route.steps.length : route.steps.length - 1;

    const routed = await fetchRoutedPath(route.steps, config.travelMode, loop);
    if (routed && routed.legs.length === expectedLegs) {
      result.push(applyRoutedPath(route, routed, config));
    } else {
      failures++;
      result.push(route);
    }
    onProgress?.(result.length, routes.length);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return { routes: result, failures };
};
