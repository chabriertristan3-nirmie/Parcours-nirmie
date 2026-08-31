/**
 * Utilitaires géométriques : distances réelles, ordonnancement des étapes,
 * mise en forme. Tout est calculé ici, l'IA ne fabrique aucun chiffre.
 */

import { POI } from '../types';

/**
 * Un trajet à pied est plus long que la distance à vol d'oiseau : rues, places,
 * traversées. Ce coefficient approche la distance réellement marchée.
 */
export const STREET_FACTOR = 1.3;

const EARTH_RADIUS_M = 6371000;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Distance à vol d'oiseau entre deux points, en mètres. */
export const haversineM = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** Distance de marche estimée entre deux points, en mètres. */
export const walkingDistanceM = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number => haversineM(a, b) * STREET_FACTOR;

/** Longueur de marche d'une suite de points, en mètres. */
export const pathLengthM = (
  points: { lat: number; lng: number }[],
  loop = false
): number => {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += walkingDistanceM(points[i - 1], points[i]);
  }
  if (loop) total += walkingDistanceM(points[points.length - 1], points[0]);
  return total;
};

/**
 * Longueur d'un tracé donné en paires `[lat, lng]`, en mètres.
 *
 * Un tracé suit déjà les rues : sa longueur est la somme brute de ses
 * segments, SANS le facteur de voirie — celui-ci ne corrige que les distances
 * à vol d'oiseau entre deux arrêts.
 */
export const tracePathLengthM = (points: [number, number][]): number => {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineM(
      { lat: points[i - 1][0], lng: points[i - 1][1] },
      { lat: points[i][0], lng: points[i][1] }
    );
  }
  return total;
};

export const centroid = (points: { lat: number; lng: number }[]) => {
  if (points.length === 0) return { lat: 0, lng: 0 };
  const sum = points.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
    { lat: 0, lng: 0 }
  );
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
};

/** Distance du point le plus proche de `point` dans `group`, en mètres. */
export const distanceToNearestM = (
  point: { lat: number; lng: number },
  group: { lat: number; lng: number }[]
): number => {
  if (group.length === 0) return Infinity;
  return Math.min(...group.map((g) => haversineM(point, g)));
};

/** Chaîne du plus proche voisin depuis un point de départ donné. */
const nearestNeighborOrder = <T extends { lat: number; lng: number }>(
  items: T[],
  startIndex: number
): T[] => {
  const remaining = [...items];
  const ordered: T[] = [remaining.splice(startIndex, 1)[0]];
  while (remaining.length > 0) {
    const last = ordered[ordered.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;
    remaining.forEach((candidate, i) => {
      const d = haversineM(last, candidate);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    });
    ordered.push(remaining.splice(bestIdx, 1)[0]);
  }
  return ordered;
};

/** Optimisation 2-opt : supprime les croisements laissés par le plus proche voisin. */
const twoOpt = <T extends { lat: number; lng: number }>(order: T[], loop: boolean): T[] => {
  if (order.length < 4) return order;
  let best = [...order];
  let bestLength = pathLengthM(best, loop);
  let improved = true;
  let guard = 0;

  while (improved && guard < 60) {
    improved = false;
    guard++;
    for (let i = 1; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, j + 1).reverse(),
          ...best.slice(j + 1),
        ];
        const length = pathLengthM(candidate, loop);
        if (length < bestLength - 1) {
          best = candidate;
          bestLength = length;
          improved = true;
        }
      }
    }
  }
  return best;
};

/**
 * Ordonne les étapes d'un parcours pour qu'il soit marchable.
 *
 * On essaie plusieurs points de départ (le plus proche voisin y est très
 * sensible) et on garde le meilleur, puis on nettoie au 2-opt.
 */
export const orderStops = <T extends { lat: number; lng: number }>(
  stops: T[],
  loop = false
): T[] => {
  if (stops.length < 3) return stops;

  let best: T[] = stops;
  let bestLength = Infinity;

  for (let start = 0; start < stops.length; start++) {
    const candidate = twoOpt(nearestNeighborOrder(stops, start), loop);
    const length = pathLengthM(candidate, loop);
    if (length < bestLength) {
      bestLength = length;
      best = candidate;
    }
  }
  return best;
};

/**
 * Point situé à `distanceM` d'un autre, dans la direction `bearingDeg`
 * (0 = nord, 90 = est). Sert à poser les jalons d'une boucle sur un cercle.
 */
export const destinationPoint = (
  from: { lat: number; lng: number },
  bearingDeg: number,
  distanceM: number
): { lat: number; lng: number } => {
  const angular = distanceM / EARTH_RADIUS_M;
  const bearing = toRad(bearingDeg);
  const lat1 = toRad(from.lat);
  const lng1 = toRad(from.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
    );

  return { lat: (lat2 * 180) / Math.PI, lng: (((lng2 * 180) / Math.PI + 540) % 360) - 180 };
};

export const formatDistance = (meters: number): string =>
  meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;

export const formatDuration = (minutes: number): string => {
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
};

/** Rayon en km couvrant la bounding box d'une ville, borné pour rester raisonnable. */
export const bboxRadiusKm = (bbox: [number, number, number, number]): number => {
  const [south, north, west, east] = bbox;
  const diagonal = haversineM({ lat: south, lng: west }, { lat: north, lng: east });
  return Math.min(15, Math.max(2, diagonal / 2 / 1000));
};

/** Cap en degrés de `from` vers `to` (0 = nord, 90 = est). */
export const bearingDeg = (
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number => {
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLng = toRad(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
};

/** Étiquette lisible pour un POI dans les listes. */
export const poiLabel = (poi: POI): string => `${poi.name} — ${poi.subtype}`;
