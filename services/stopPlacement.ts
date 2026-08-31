/**
 * Où poser les arrêts d'un parcours libre.
 *
 * Règle unique, et non négociable : **un arrêt se pose sur le tracé**, jamais
 * sur un point théorique calculé à la boussole. C'est ce qui garantit qu'il est
 * atteignable à pied — un point posé « à 600 m au nord » tombe dans un fleuve,
 * un champ, une voie ferrée ou une propriété privée une fois sur deux, et c'est
 * exactement ce qui se voyait sur la carte.
 *
 * Le tracé vient du profil piéton d'OSRM : chacun de ses points est, par
 * construction, sur une voie qu'un piéton a le droit et la possibilité
 * d'emprunter. Reste à écarter ce que le tracé peut contenir malgré tout : les
 * traversées en bateau ou en train, et les routes numérotées, où l'on marche
 * sur le bas-côté.
 */

import { PathPoint } from '../types';
import { haversineM } from './geo';
import { RoutedManeuver } from './routingService';

/**
 * Modes de déplacement interdits sur un parcours à pied ou à vélo.
 *
 * Un bac ou un train ne se « marche » pas : un parcours qui en dépend n'est pas
 * réalisable tel qu'annoncé, et un arrêt posé dessus serait au milieu de l'eau
 * ou sur une voie ferrée.
 */
const FORBIDDEN_MODES = ['ferry', 'train', 'railway', 'driving'];

/** Le parcours emprunte-t-il un mode qu'un promeneur ne peut pas suivre ? */
export const usesForbiddenMode = (maneuvers: RoutedManeuver[]): boolean =>
  maneuvers.some((m) => FORBIDDEN_MODES.includes(m.mode.toLowerCase()));

/**
 * Route numérotée : autoroute, nationale, départementale, métropolitaine.
 *
 * On peut avoir le droit d'y marcher, mais on y marche sur le bas-côté, au
 * bord de la circulation. Ce n'est pas un endroit où envoyer quelqu'un
 * s'arrêter pour regarder son téléphone.
 */
export const isNumberedRoad = (ref: string): boolean => /^\s*[ANDM]\s*\d/i.test(ref);

/** La voie se prête-t-elle à un arrêt ? */
export const isStoppable = (maneuver: RoutedManeuver): boolean =>
  !FORBIDDEN_MODES.includes(maneuver.mode.toLowerCase()) && !isNumberedRoad(maneuver.ref);

// --------------------------------------------------------------------------
// Tracé mesuré
// --------------------------------------------------------------------------

/** Le tracé complet, avec de quoi situer n'importe quelle distance dessus. */
export interface Trace {
  points: PathPoint[];
  /** Distance cumulée depuis le départ, point par point. */
  cumulativeM: number[];
  /** Indice de la manœuvre dont provient chaque point. */
  maneuverOf: number[];
  maneuvers: RoutedManeuver[];
  totalM: number;
}

/**
 * Assemble les manœuvres en un tracé mesuré, en supprimant le doublon de
 * jonction entre deux manœuvres consécutives.
 */
export const buildTrace = (maneuvers: RoutedManeuver[]): Trace => {
  const points: PathPoint[] = [];
  const cumulativeM: number[] = [];
  const maneuverOf: number[] = [];
  let total = 0;

  maneuvers.forEach((maneuver, index) => {
    for (const point of maneuver.path) {
      const last = points[points.length - 1];
      if (last && last[0] === point[0] && last[1] === point[1]) {
        // Point de jonction : il appartient à la voie que l'on aborde, pas à
        // celle que l'on quitte. Sans cela, tout le début de chaque voie
        // hériterait du nom — et du danger — de la précédente.
        maneuverOf[points.length - 1] = index;
        continue;
      }
      if (last) {
        total += haversineM({ lat: last[0], lng: last[1] }, { lat: point[0], lng: point[1] });
      }
      points.push(point);
      cumulativeM.push(total);
      maneuverOf.push(index);
    }
  });

  return { points, cumulativeM, maneuverOf, maneuvers, totalM: total };
};

/** Indice du dernier point situé avant `distanceM`. */
const indexAt = (trace: Trace, distanceM: number): number => {
  const { cumulativeM } = trace;
  let low = 0;
  let high = cumulativeM.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (cumulativeM[mid] <= distanceM) low = mid;
    else high = mid - 1;
  }
  return low;
};

/** Point exact du tracé à une distance donnée du départ. */
export const pointAt = (trace: Trace, distanceM: number): PathPoint => {
  const { points, cumulativeM } = trace;
  if (points.length === 0) return [0, 0];

  const clamped = Math.max(0, Math.min(trace.totalM, distanceM));
  const i = indexAt(trace, clamped);
  if (i >= points.length - 1) return points[points.length - 1];

  const span = cumulativeM[i + 1] - cumulativeM[i];
  const ratio = span > 0 ? (clamped - cumulativeM[i]) / span : 0;
  return [
    points[i][0] + (points[i + 1][0] - points[i][0]) * ratio,
    points[i][1] + (points[i + 1][1] - points[i][1]) * ratio,
  ];
};

/**
 * Portion de tracé entre deux distances, extrémités comprises et exactes.
 * C'est ce qui alimente le mode live : le trait à suivre d'un arrêt au suivant.
 */
export const sliceTrace = (trace: Trace, fromM: number, toM: number): PathPoint[] => {
  if (trace.points.length === 0 || toM <= fromM) return [];

  const start = pointAt(trace, fromM);
  const end = pointAt(trace, toM);
  const between = trace.points.filter(
    (_, i) => trace.cumulativeM[i] > fromM && trace.cumulativeM[i] < toM
  );
  return [start, ...between, end];
};

// --------------------------------------------------------------------------
// Placement des arrêts
// --------------------------------------------------------------------------

/** Un arrêt posé sur le tracé. */
export interface PlacedStop {
  lat: number;
  lng: number;
  /** Nom de la voie sur laquelle il tombe. Vide si la voie n'en a pas. */
  streetName: string;
  /** Distance depuis le départ, le long du tracé. */
  distanceM: number;
}

/**
 * Amplitude de recherche autour de la position idéale, en part d'intervalle.
 *
 * À 0,9, on cherche dans presque tout l'intervalle qui revient à cet arrêt —
 * assez pour contourner une longue traversée de départementale — sans jamais
 * empiéter sur l'intervalle du voisin, ce qui inverserait l'ordre des arrêts.
 */
const SEARCH_SPAN = 0.9;

/** Finesse de la recherche : 60 essais de part et d'autre. */
const SEARCH_STEPS = 60;

/** La voie du tracé à une distance donnée du départ. */
const maneuverAt = (trace: Trace, distanceM: number): RoutedManeuver | undefined =>
  trace.maneuvers[trace.maneuverOf[indexAt(trace, distanceM)]];

/**
 * Répartit `count` arrêts le long du tracé, à intervalles réguliers.
 *
 * La position idéale est un simple partage du parcours. Si elle tombe sur une
 * voie où l'on ne veut pas s'arrêter — bac, voie ferrée, route numérotée — on
 * cherche de part et d'autre dans l'intervalle qui revient à cet arrêt.
 *
 * **Si rien de convenable ne s'y trouve, l'arrêt n'est pas posé.** La règle est
 * stricte à dessein : mieux vaut un parcours avec un repère de moins qu'un
 * repère au bord d'une nationale. Un tracé qui n'en accepte aucun est un tracé
 * à refaire, et l'appelant le rejette.
 */
export const placeStops = (trace: Trace, count: number): PlacedStop[] => {
  if (trace.points.length < 2 || count < 1) return [];

  const spacing = trace.totalM / (count + 1);
  const span = spacing * SEARCH_SPAN;
  const stops: PlacedStop[] = [];

  for (let i = 1; i <= count; i++) {
    const ideal = spacing * i;
    let chosen: number | undefined;

    // On s'écarte progressivement de la position idéale, alternativement d'un
    // côté puis de l'autre, et l'on s'arrête au premier endroit convenable.
    for (let step = 0; step <= SEARCH_STEPS && chosen === undefined; step++) {
      const offset = (span * step) / SEARCH_STEPS;
      const candidates = step === 0 ? [ideal] : [ideal - offset, ideal + offset];
      chosen = candidates.find((d) => {
        if (d <= 0 || d >= trace.totalM) return false;
        const maneuver = maneuverAt(trace, d);
        return maneuver ? isStoppable(maneuver) : false;
      });
    }

    if (chosen === undefined) continue;

    const [lat, lng] = pointAt(trace, chosen);
    stops.push({
      lat,
      lng,
      streetName: maneuverAt(trace, chosen)?.name ?? '',
      distanceM: chosen,
    });
  }

  return stops;
};
