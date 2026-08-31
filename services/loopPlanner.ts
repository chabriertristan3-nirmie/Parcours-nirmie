/**
 * Parcours libres : des boucles aléatoires à la distance voulue.
 *
 * Ce mode n'utilise AUCUN point d'intérêt. C'est tout l'enjeu : proposer une
 * sortie guidée dans une ville qui n'a rien à visiter. Seule compte la
 * géométrie — on pose des jalons sur un tour irrégulier autour du départ, le
 * routeur les relie par les rues, et on ajuste le rayon jusqu'à la longueur
 * demandée.
 *
 * Le guidage vient des noms de rues renvoyés par le routeur : le promeneur
 * sait où passer sans qu'aucun lieu remarquable n'existe.
 */

import {
  CityInfo,
  GeneratedRoute,
  PathPoint,
  POI,
  RouteConfig,
  RouteStep,
  StartPoint,
} from '../types';
import { destinationPoint, haversineM, tracePathLengthM } from './geo';
import { fetchRoutedPath } from './routingService';
import {
  buildTrace,
  PlacedStop,
  placeStops,
  sliceTrace,
  Trace,
  usesForbiddenMode,
} from './stopPlacement';

/** Écart accepté entre la distance obtenue et celle demandée. */
const DISTANCE_TOLERANCE = 0.12;

/** Tentatives d'ajustement du rayon avant de garder la meilleure boucle. */
const MAX_ATTEMPTS = 5;

/**
 * Les rues ne suivent pas le tour théorique : le trajet réel est plus long
 * que le périmètre. On part donc d'un rayon volontairement réduit.
 */
const INITIAL_RADIUS_FACTOR = 0.82;

// --------------------------------------------------------------------------
// Hasard reproductible
// --------------------------------------------------------------------------

/**
 * Générateur pseudo-aléatoire (mulberry32) : même graine, mêmes boucles.
 * Indispensable pour pouvoir tester une génération « aléatoire ».
 */
export const makeRng = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// --------------------------------------------------------------------------
// Forme d'une boucle
// --------------------------------------------------------------------------

/**
 * La forme d'une boucle, indépendante de sa taille.
 *
 * Un cercle parfait donnerait toujours le même circuit ennuyeux. On déforme
 * donc le tour : nombre de jalons variable, rayons inégaux, angles décalés.
 * Le rayon global reste le seul levier pour ajuster la distance, ce qui rend
 * la convergence prévisible.
 */
export interface LoopShape {
  /** Nombre de jalons posés sur le tour. */
  waypointCount: number;
  /** Cap du premier jalon, en degrés (0 = nord). */
  startBearing: number;
  /** Facteur de rayon par jalon : c'est lui qui rend la boucle irrégulière. */
  radiusFactors: number[];
  /** Décalage angulaire par jalon, en degrés. */
  bearingOffsets: number[];
}

/** Jalons minimum et maximum d'une boucle. Moins de 3 ne fait pas un tour. */
const MIN_WAYPOINTS = 3;
const MAX_WAYPOINTS = 6;

/** Amplitude de déformation du rayon : de 75 % à 125 % du rayon nominal. */
const RADIUS_JITTER = 0.5;

export const randomLoopShape = (rng: () => number, startBearing: number): LoopShape => {
  const waypointCount =
    MIN_WAYPOINTS + Math.floor(rng() * (MAX_WAYPOINTS - MIN_WAYPOINTS + 1));

  // Le décalage angulaire reste sous la moitié d'un secteur : au-delà, deux
  // jalons se croiseraient et la boucle se replierait sur elle-même.
  const maxOffset = (360 / waypointCount) * 0.25;

  return {
    waypointCount,
    startBearing,
    radiusFactors: Array.from(
      { length: waypointCount },
      () => 1 - RADIUS_JITTER / 2 + rng() * RADIUS_JITTER
    ),
    bearingOffsets: Array.from({ length: waypointCount }, () => (rng() - 0.5) * 2 * maxOffset),
  };
};

/** Pose les jalons d'une forme donnée, à un rayon donné. */
export const shapeWaypoints = (
  start: { lat: number; lng: number },
  shape: LoopShape,
  radiusM: number
): { lat: number; lng: number }[] =>
  Array.from({ length: shape.waypointCount }, (_, i) =>
    destinationPoint(
      start,
      shape.startBearing + (i * 360) / shape.waypointCount + shape.bearingOffsets[i],
      radiusM * shape.radiusFactors[i]
    )
  );

/**
 * Répartit les boucles d'un même lot autour du départ, avec un peu de hasard.
 *
 * Sans la part déterministe, deux boucles pourraient partir dans la même
 * direction ; sans la part aléatoire, relancer la génération redonnerait
 * exactement les mêmes circuits.
 */
export const spreadBearing = (index: number, total: number, rng: () => number): number => {
  const sector = 360 / total;
  return index * sector + rng() * sector;
};

// --------------------------------------------------------------------------
// Répartition des départs dans la commune
// --------------------------------------------------------------------------

/**
 * Où poser les départs, en fraction de la demi-étendue de la commune.
 *
 * À 55 %, les départs occupent vraiment le territoire sans se coller aux
 * limites communales, où le réseau de rues se raréfie.
 */
const COMMUNE_SPREAD_RATIO = 0.55;

/** Degrés de latitude par mètre. Suffisant : on raisonne en ordres de grandeur. */
const M_PER_DEG_LAT = 111320;

const SECTORS = [
  'nord',
  'nord-est',
  'est',
  'sud-est',
  'sud',
  'sud-ouest',
  'ouest',
  'nord-ouest',
];

/** Nom du secteur correspondant à un cap, pour situer un départ en clair. */
export const sectorName = (bearing: number): string =>
  SECTORS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];

/** « d'Antibes », « de Nîmes » — l'élision, sinon les titres sont fautifs. */
const ofCity = (name: string): string =>
  /^[aàâeéèêiîoôuùûyh]/i.test(name) ? `d'${name}` : `de ${name}`;

/** Départ par défaut : le centre de la commune. */
const cityCentre = (city: CityInfo): StartPoint => ({
  lat: city.lat,
  lng: city.lng,
  label: `Centre ${ofCity(city.name)}`,
});

/**
 * Détermine un point de départ par boucle, répartis sur toute la commune.
 *
 * C'est ce qui distingue quatre boucles de 3,5 km les unes des autres : partant
 * toutes du même point, elles se recouvrent quelle que soit leur forme. On les
 * ancre donc dans des quartiers différents, sur l'ellipse inscrite dans
 * l'emprise de la commune — la forme de cette ellipse suit celle du territoire,
 * qu'il soit ramassé ou tout en longueur.
 *
 * Volontairement déterministe : l'écran de réglages peut ainsi montrer les
 * départs exacts qui seront utilisés. Le hasard reste dans la forme des boucles.
 */
export const spreadStartPoints = (
  city: CityInfo,
  config: RouteConfig,
  total: number
): StartPoint[] => {
  const centre = cityCentre(city);

  // Un départ choisi à la main est une consigne : toutes les boucles en partent.
  if (config.start) return Array.from({ length: total }, () => config.start as StartPoint);
  if (!config.spreadStarts || total <= 1) return Array.from({ length: total }, () => centre);

  const [south, north, west, east] = city.bbox;
  const latRadiusDeg = (Math.abs(north - south) / 2) * COMMUNE_SPREAD_RATIO;
  const lngRadiusDeg = (Math.abs(east - west) / 2) * COMMUNE_SPREAD_RATIO;

  // Une commune géocodée à l'adresse près a une emprise nulle : sans plancher,
  // tous les départs retomberaient au même endroit. On garantit alors un rayon
  // de boucle d'écart, de quoi obtenir des circuits distincts.
  const loopRadiusM = (config.targetDistanceKm * 1000) / (2 * Math.PI);
  const minLatDeg = loopRadiusM / M_PER_DEG_LAT;
  const cosLat = Math.max(0.2, Math.cos((city.lat * Math.PI) / 180));

  const latSpread = Math.max(latRadiusDeg, minLatDeg);
  const lngSpread = Math.max(lngRadiusDeg, minLatDeg / cosLat);

  return Array.from({ length: total }, (_, i) => {
    const bearing = (i * 360) / total;
    const rad = (bearing * Math.PI) / 180;
    return {
      lat: city.lat + latSpread * Math.cos(rad),
      lng: city.lng + lngSpread * Math.sin(rad),
      label: `Secteur ${sectorName(bearing)} ${ofCity(city.name)}`,
    };
  });
};

/**
 * Replis d'un départ qui ne mène à rien : à mi-chemin du centre, puis au centre.
 *
 * Un point réparti peut tomber en mer, en forêt ou hors du réseau de rues.
 * Plutôt que de perdre la boucle, on la ramène progressivement vers le tissu
 * urbain, où le routeur trouve toujours de quoi tracer.
 */
const fallbackStarts = (anchor: StartPoint, city: CityInfo): StartPoint[] => {
  const centre = cityCentre(city);
  if (anchor.lat === centre.lat && anchor.lng === centre.lng) return [anchor];
  return [
    anchor,
    { ...anchor, lat: (anchor.lat + city.lat) / 2, lng: (anchor.lng + city.lng) / 2 },
    centre,
  ];
};

// --------------------------------------------------------------------------
// Construction d'une boucle
// --------------------------------------------------------------------------

/**
 * Écart maximal toléré entre le départ demandé et l'endroit où le routeur
 * l'accroche. Au-delà, le point n'est pas desservi : on essaie ailleurs.
 */
const MAX_SNAP_M = 1500;

interface LoopAttempt {
  /** Le tracé mesuré, seule source des arrêts et de leur position. */
  trace: Trace;
  distanceM: number;
  /** Nom de la voie du départ, tel qu'accroché par le routeur. */
  startName: string;
  /** Départ tel qu'accroché au réseau — jamais le point théorique demandé. */
  snappedStart: { lat: number; lng: number };
  /** Arrêts retenus, tous posés sur le tracé et sur une voie convenable. */
  stops: PlacedStop[];
  error: number;
}

/**
 * Trace une boucle et ajuste son rayon jusqu'à approcher la distance visée.
 * La forme ne change pas d'une tentative à l'autre : seul le rayon bouge, donc
 * la correction proportionnelle converge en deux ou trois essais.
 */
const planOneLoop = async (
  start: StartPoint,
  config: RouteConfig,
  shape: LoopShape
): Promise<LoopAttempt | null> => {
  const targetM = config.targetDistanceKm * 1000;
  let radiusM = (targetM / (2 * Math.PI)) * INITIAL_RADIUS_FACTOR;
  let best: LoopAttempt | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const waypoints = shapeWaypoints(start, shape, radiusM);
    const routed = await fetchRoutedPath([start, ...waypoints], config.travelMode, true);
    if (!routed) return best;

    // Le départ n'est pas desservi : inutile d'insister, l'appelant essaiera
    // un autre ancrage. On ne le teste qu'au premier essai, le départ ne
    // bougeant pas d'une tentative à l'autre.
    const snapped = routed.waypointLocations[0];
    if (
      attempt === 0 &&
      snapped &&
      Number.isFinite(snapped.lat) &&
      haversineM(start, snapped) > MAX_SNAP_M
    ) {
      return null;
    }

    const maneuvers = routed.legs.flatMap((leg) => leg.maneuvers);

    // Un bac ou un tronçon en train ne se marche pas : la boucle annoncée
    // serait infaisable. On laisse l'ajustement du rayon retenter, un autre
    // rayon empruntant souvent un autre itinéraire.
    if (usesForbiddenMode(maneuvers)) {
      radiusM *= 0.85;
      await new Promise((resolve) => setTimeout(resolve, 200));
      continue;
    }

    const trace = buildTrace(maneuvers);
    if (trace.points.length < 2) return best;

    // Aucun endroit convenable où s'arrêter sur tout le circuit : il longe des
    // voies à trafic d'un bout à l'autre. On ne le garde pas — un autre rayon
    // passera ailleurs.
    const stops = placeStops(trace, shape.waypointCount);
    if (stops.length === 0) {
      radiusM *= 0.85;
      await new Promise((resolve) => setTimeout(resolve, 200));
      continue;
    }

    const error = Math.abs(routed.totalDistanceM - targetM) / targetM;

    if (!best || error < best.error) {
      best = {
        trace,
        distanceM: routed.totalDistanceM,
        startName: routed.waypointNames[0] ?? '',
        snappedStart:
          snapped && Number.isFinite(snapped.lat) ? snapped : { lat: start.lat, lng: start.lng },
        stops,
        error,
      };
    }
    if (error <= DISTANCE_TOLERANCE) break;

    radiusM *= targetM / routed.totalDistanceM;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return best;
};

/** Étiquette d'un arrêt : le nom de la voie, ou un repère de secours. */
const stopLabel = (street: string, index: number): string =>
  street && street.length > 1 ? street : `Point de passage ${index}`;

/**
 * Construit les étapes d'une boucle : le départ, puis les arrêts.
 *
 * Tous sont pris **sur le tracé** : le départ à l'endroit où le routeur
 * l'accroche au réseau, les arrêts à des positions réparties le long du
 * chemin réellement parcouru. Aucun ne peut donc tomber ailleurs que sur une
 * voie praticable à pied.
 */
const buildLoopSteps = (
  start: StartPoint,
  attempt: LoopAttempt,
  config: RouteConfig
): RouteStep[] => {
  const asStep = (
    poi: Omit<POI, 'notoriety' | 'visitMinutes' | 'source'>,
    stepNumber: number,
    segment: PathPoint[]
  ): RouteStep => {
    const distanceM = Math.round(tracePathLengthM(segment));
    return {
      ...poi,
      // Un parcours libre ne comporte aucune visite : c'est de l'effort pur.
      notoriety: 0,
      visitMinutes: 0,
      source: 'manual',
      stepNumber,
      distanceFromPrevM: distanceM,
      durationFromPrevS: Math.round((distanceM / 1000 / config.paceKmh) * 3600),
      pathFromPrev: segment,
    };
  };

  const steps: RouteStep[] = [
    asStep(
      {
        id: `start-${Math.round(start.lat * 1e5)}-${Math.round(start.lng * 1e5)}`,
        name: start.label,
        theme: 'Places & Vie locale',
        subtype: 'Départ',
        lat: start.lat,
        lng: start.lng,
      },
      1,
      []
    ),
  ];

  let previousM = 0;
  attempt.stops.forEach((stop, i) => {
    steps.push(
      asStep(
        {
          id: `wp-${i}-${Math.round(stop.lat * 1e5)}-${Math.round(stop.lng * 1e5)}`,
          name: stopLabel(stop.streetName, i + 2),
          theme: 'Places & Vie locale',
          subtype: 'Jalon',
          lat: stop.lat,
          lng: stop.lng,
        },
        i + 2,
        sliceTrace(attempt.trace, previousM, stop.distanceM)
      )
    );
    previousM = stop.distanceM;
  });

  return steps;
};

const loopTitle = (distanceKm: number, startLabel: string, index: number): string =>
  `Boucle ${index + 1} · ${distanceKm} km — ${startLabel}`;

/** Le nom de la rue du départ, quand le routeur le connaît, précise le repère. */
const startLabelWithStreet = (anchor: StartPoint, street: string): string =>
  street && street.length > 1 ? `${anchor.label} — ${street}` : anchor.label;

// --------------------------------------------------------------------------
// Point d'entrée
// --------------------------------------------------------------------------

/**
 * Produit les boucles libres demandées, sans aucun point d'intérêt.
 *
 * `seed` rend la génération reproductible pour les tests ; en usage réel elle
 * est tirée de l'horloge, si bien que relancer donne d'autres circuits.
 */
export const planFreeRoutes = async (
  city: CityInfo,
  config: RouteConfig,
  onProgress?: (done: number, total: number) => void,
  seed: number = Date.now()
): Promise<{ routes: GeneratedRoute[]; failures: number }> => {
  const total = loopCountFor(config);
  const anchors = spreadStartPoints(city, config, total);
  const rng = makeRng(seed);

  const routes: GeneratedRoute[] = [];
  let failures = 0;

  for (let i = 0; i < total; i++) {
    const shape = randomLoopShape(rng, spreadBearing(i, total, rng));

    // On essaie le départ prévu, puis des replis vers le centre s'il n'est pas
    // desservi. Le premier qui aboutit gagne.
    let attempt: LoopAttempt | null = null;
    let start = anchors[i];
    for (const candidate of fallbackStarts(anchors[i], city)) {
      attempt = await planOneLoop(candidate, config, shape);
      if (attempt && attempt.trace.points.length >= 2) {
        start = candidate;
        break;
      }
      attempt = null;
    }
    onProgress?.(i + 1, total);

    if (!attempt) {
      failures++;
      continue;
    }

    // Le départ affiché est celui accroché au réseau, pas le point théorique :
    // c'est là que le promeneur se tiendra réellement.
    start = {
      ...attempt.snappedStart,
      label: startLabelWithStreet(start, attempt.startName),
    };
    const steps = buildLoopSteps(start, attempt, config);
    const distanceKm = Math.round((attempt.distanceM / 1000) * 10) / 10;
    const walkingMinutes = Math.round((attempt.distanceM / 1000 / config.paceKmh) * 60);

    routes.push({
      id: `loop-${Date.now()}-${i}`,
      createdAt: new Date().toISOString(),
      summary: {
        title: loopTitle(distanceKm, start.label, i),
        city: city.name,
        theme: 'Boucle libre',
        travelMode: config.travelMode,
        kind: 'free',
        totalDistanceKm: distanceKm,
        walkingMinutes,
        visitMinutes: 0,
        totalMinutes: walkingMinutes,
        stopsCount: steps.length,
        loop: true,
      },
      steps,
      path: attempt.trace.points,
      geometrySource: 'osrm',
    });
  }

  return { routes, failures };
};

/** Point de départ de référence. Partagé avec l'écran de réglages. */
export const startPointFor = (city: CityInfo, config: RouteConfig): StartPoint =>
  config.start ?? cityCentre(city);

/** Nombre de boucles effectif. Partagé avec l'écran de réglages. */
export const loopCountFor = (config: RouteConfig): number => Math.max(1, config.routeCount ?? 3);
