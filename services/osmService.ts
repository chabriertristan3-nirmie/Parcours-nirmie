/**
 * Source de vérité des POI : OpenStreetMap.
 *
 * Nominatim localise la ville, Overpass renvoie tous les lieux touristiques
 * qu'elle contient réellement. C'est ce qui permet de dire « cette ville porte
 * N parcours » au lieu de le décider à l'avance.
 *
 * Aucune clé d'API n'est nécessaire, mais ce sont des services communautaires :
 * on reste raisonnable (un scan par ville, mis en cache côté navigateur).
 */

import { CityInfo, CityScan, CycleRoute, POI, PoiTheme } from '../types';
import { bboxRadiusKm } from './geo';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

/** Plusieurs miroirs : le premier qui répond gagne. */
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const CACHE_PREFIX = 'nirmie_scan_';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type OsmTags = Record<string, string>;

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: OsmTags;
}

// --------------------------------------------------------------------------
// Géocodage
// --------------------------------------------------------------------------

export const geocodeCity = async (query: string): Promise<CityInfo> => {
  const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1&accept-language=fr`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });

  if (!response.ok) {
    throw new Error(`Géocodage indisponible (HTTP ${response.status}).`);
  }

  const results = await response.json();
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error(`Ville introuvable : « ${query} ».`);
  }

  const hit = results[0];
  const [south, north, west, east] = (hit.boundingbox as string[]).map(Number);

  return {
    name: hit.name || hit.address?.city || hit.address?.town || query.trim(),
    displayName: hit.display_name,
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    bbox: [south, north, west, east],
    osmType: hit.osm_type,
    osmId: hit.osm_id,
  };
};

// --------------------------------------------------------------------------
// Règles de sécurité
// --------------------------------------------------------------------------

/**
 * Un POI proposé au public doit être librement accessible et sans danger.
 *
 * Retourne la raison de l'exclusion, ou `null` si le lieu est admissible.
 * Ces règles sont volontairement strictes : dans le doute, on écarte —
 * un inventaire un peu plus court vaut mieux qu'un visiteur envoyé dans une
 * propriété privée ou un site à risque.
 */
export const safetyExclusion = (tags: OsmTags): string | null => {
  // Accès restreint : propriété privée, clientèle uniquement, sur autorisation.
  const access = tags.access || tags['foot'];
  if (access && ['private', 'no', 'permit', 'customers', 'military'].includes(access)) {
    return 'accès privé ou restreint';
  }
  if (tags.ownership === 'private' && !tags.tourism) {
    return 'propriété privée';
  }

  // Zones militaires, quelles qu'elles soient.
  if (tags.military || tags.landuse === 'military') {
    return 'zone militaire';
  }

  // Sites dangereux ou signalés comme tels.
  if (tags.hazard) return 'site signalé dangereux';
  if (tags.natural === 'cave_entrance') return 'entrée de grotte (risque de chute)';
  if (tags.natural === 'peak' || tags.natural === 'cliff') {
    return 'sommet ou falaise (terrain accidenté)';
  }
  if (tags.natural === 'sinkhole') return 'cavité naturelle';
  if (tags['seamark:type']) return 'site en mer';

  // Dans l'eau. Un plan d'eau ou un cours d'eau a son point OSM au milieu de
  // l'eau : un arrêt posé là envoie le joueur dans le fleuve. La plage et les
  // berges aménagées restent admissibles, elles ne sont pas taguées ainsi.
  if (tags.waterway && tags.waterway !== 'dam') return "au milieu de l'eau";
  if (tags.natural === 'water' || tags.natural === 'strait' || tags.natural === 'bay') {
    return "plan d'eau";
  }
  if (tags.landuse === 'reservoir' || tags.landuse === 'basin') return "bassin d'eau";
  if (tags.historic === 'wreck') return 'épave (site immergé)';

  // Voies ferrées, sous toutes leurs formes : on n'y pose jamais un arrêt.
  const rail = tags.railway;
  if (rail && rail !== 'station' && rail !== 'subway_entrance') {
    return 'emprise ferroviaire';
  }
  if (tags.landuse === 'railway') return 'emprise ferroviaire';

  // Voies de circulation : un arrêt au bord d'une route à trafic est un
  // accident en puissance, et la piste cyclable n'est pas un lieu de halte.
  const road = tags.highway;
  if (
    road &&
    ['motorway', 'trunk', 'primary', 'secondary',
      'motorway_link', 'trunk_link', 'primary_link', 'secondary_link']
      .includes(road)
  ) {
    return 'voie à fort trafic';
  }

  // Terres agricoles : privées, et sans intérêt de visite.
  if (['farmland', 'meadow', 'orchard', 'vineyard', 'greenhouse_horticulture', 'quarry']
    .includes(tags.landuse || '')) {
    return 'terrain agricole ou d\'extraction privé';
  }
  if (tags.natural === 'scrub' || tags.natural === 'wetland') return 'terrain non aménagé';

  // Lieux à l'abandon ou en chantier : structure instable, accès interdit.
  if (tags.abandoned === 'yes' || tags['abandoned:tourism'] || tags['abandoned:building']) {
    return "site à l'abandon";
  }
  if (tags.construction || tags.building === 'construction') return 'site en travaux';
  if (tags['disused:tourism'] || tags.disused === 'yes') return 'site désaffecté';

  // Infrastructures actives où le public n'a rien à faire à pied.
  if (tags.railway === 'level_crossing' || tags.railway === 'crossing') {
    return 'passage à niveau';
  }
  if (tags.man_made === 'water_tower' || tags.man_made === 'chimney') {
    return 'infrastructure industrielle';
  }
  if (tags.power) return 'installation électrique';

  return null;
};

// --------------------------------------------------------------------------
// Classification des tags OSM
// --------------------------------------------------------------------------

interface Classification {
  theme: PoiTheme;
  subtype: string;
  visitMinutes: number;
  /** Bonus de notoriété propre au type de lieu. */
  baseScore: number;
}

/**
 * Traduit les tags OSM en thème Nirmie. Retourne `null` pour tout ce qui n'a
 * pas d'intérêt touristique — c'est ce filtre qui garde l'inventaire propre.
 */
const classify = (tags: OsmTags): Classification | null => {
  const { tourism, historic, leisure, natural, amenity, man_made, building, place } = tags;

  // --- Panoramas -----------------------------------------------------------
  if (tourism === 'viewpoint')
    return { theme: 'Panoramas & Points de vue', subtype: 'Point de vue', visitMinutes: 10, baseScore: 30 };
  if (man_made === 'tower' && tags['tower:type'] === 'observation')
    return { theme: 'Panoramas & Points de vue', subtype: 'Tour panoramique', visitMinutes: 25, baseScore: 40 };
  if (man_made === 'lighthouse')
    return { theme: 'Panoramas & Points de vue', subtype: 'Phare', visitMinutes: 20, baseScore: 35 };

  // --- Patrimoine ----------------------------------------------------------
  if (tourism === 'museum')
    return { theme: 'Patrimoine & Histoire', subtype: 'Musée', visitMinutes: 45, baseScore: 55 };
  if (historic === 'castle' || building === 'castle')
    return { theme: 'Patrimoine & Histoire', subtype: 'Château', visitMinutes: 45, baseScore: 60 };
  if (historic === 'monument')
    return { theme: 'Patrimoine & Histoire', subtype: 'Monument', visitMinutes: 15, baseScore: 40 };
  if (historic === 'memorial')
    return { theme: 'Patrimoine & Histoire', subtype: 'Mémorial', visitMinutes: 10, baseScore: 20 };
  if (historic === 'ruins' || historic === 'archaeological_site')
    return { theme: 'Patrimoine & Histoire', subtype: 'Site historique', visitMinutes: 25, baseScore: 40 };
  if (historic === 'city_gate' || historic === 'city_walls' || historic === 'fort')
    return { theme: 'Patrimoine & Histoire', subtype: 'Fortification', visitMinutes: 20, baseScore: 40 };
  if (historic === 'building' || historic === 'manor' || historic === 'house')
    return { theme: 'Patrimoine & Histoire', subtype: 'Édifice historique', visitMinutes: 15, baseScore: 30 };
  if (building === 'cathedral' || building === 'basilica')
    return { theme: 'Patrimoine & Histoire', subtype: 'Cathédrale', visitMinutes: 30, baseScore: 60 };
  if (amenity === 'place_of_worship') {
    // Les lieux de culte sont innombrables : on ne garde que ceux qui ont une
    // trace patrimoniale (fiche Wikidata, classement, style architectural).
    const notable = tags.wikidata || tags.heritage || tags['building:architecture'] || tags.historic;
    if (!notable) return null;
    return { theme: 'Patrimoine & Histoire', subtype: 'Édifice religieux', visitMinutes: 20, baseScore: 35 };
  }
  if (historic)
    return { theme: 'Patrimoine & Histoire', subtype: 'Patrimoine', visitMinutes: 15, baseScore: 25 };

  // --- Art & insolite ------------------------------------------------------
  if (tourism === 'artwork')
    return { theme: 'Art & Insolite', subtype: 'Œuvre urbaine', visitMinutes: 10, baseScore: 25 };
  if (tourism === 'gallery')
    return { theme: 'Art & Insolite', subtype: 'Galerie', visitMinutes: 30, baseScore: 35 };
  if (amenity === 'theatre')
    return { theme: 'Art & Insolite', subtype: 'Théâtre', visitMinutes: 15, baseScore: 40 };
  if (amenity === 'arts_centre')
    return { theme: 'Art & Insolite', subtype: 'Centre culturel', visitMinutes: 30, baseScore: 30 };
  if (tourism === 'attraction')
    return { theme: 'Art & Insolite', subtype: 'Attraction', visitMinutes: 25, baseScore: 45 };
  if (tourism === 'zoo' || tourism === 'aquarium' || tourism === 'theme_park')
    return { theme: 'Art & Insolite', subtype: 'Parc de loisirs', visitMinutes: 90, baseScore: 50 };
  if (man_made === 'windmill' || man_made === 'watermill')
    return { theme: 'Art & Insolite', subtype: 'Moulin', visitMinutes: 15, baseScore: 30 };

  // --- Nature --------------------------------------------------------------
  if (leisure === 'park')
    return { theme: 'Nature & Jardins', subtype: 'Parc', visitMinutes: 25, baseScore: 30 };
  if (leisure === 'garden')
    return { theme: 'Nature & Jardins', subtype: 'Jardin', visitMinutes: 25, baseScore: 35 };
  if (leisure === 'nature_reserve')
    return { theme: 'Nature & Jardins', subtype: 'Réserve naturelle', visitMinutes: 45, baseScore: 40 };
  if (natural === 'beach')
    return { theme: 'Nature & Jardins', subtype: 'Plage', visitMinutes: 40, baseScore: 40 };
  if (natural === 'spring' || natural === 'waterfall')
    return { theme: 'Nature & Jardins', subtype: 'Curiosité naturelle', visitMinutes: 20, baseScore: 35 };

  // --- Vie locale ----------------------------------------------------------
  if (amenity === 'marketplace')
    return { theme: 'Places & Vie locale', subtype: 'Marché', visitMinutes: 25, baseScore: 35 };
  if (amenity === 'fountain')
    return { theme: 'Places & Vie locale', subtype: 'Fontaine', visitMinutes: 5, baseScore: 20 };
  if (place === 'square')
    return { theme: 'Places & Vie locale', subtype: 'Place', visitMinutes: 15, baseScore: 30 };
  if (amenity === 'townhall')
    return { theme: 'Places & Vie locale', subtype: 'Hôtel de ville', visitMinutes: 10, baseScore: 35 };
  if (amenity === 'library' && tags.wikidata)
    return { theme: 'Places & Vie locale', subtype: 'Bibliothèque', visitMinutes: 20, baseScore: 30 };

  return null;
};

/**
 * Notoriété 0-100. On n'a pas de compteur de visiteurs, mais la richesse des
 * tags OSM est un bon indicateur : les lieux connus sont mieux documentés.
 */
const scoreNotoriety = (tags: OsmTags, base: number): number => {
  let score = base;
  if (tags.wikidata) score += 22;
  if (tags.wikipedia) score += 12;
  if (tags.heritage) score += 15;
  if (tags['heritage:operator'] || tags.ref_mhs) score += 8;
  if (tags.website || tags['contact:website']) score += 5;
  if (tags.description) score += 4;
  if (tags.image) score += 3;
  if (tags.opening_hours) score += 3;
  if (tags['name:en']) score += 4;
  if (tags.tourism === 'attraction') score += 6;
  return Math.max(0, Math.min(100, Math.round(score)));
};

const buildAddress = (tags: OsmTags): string | undefined => {
  const parts = [
    [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    tags['addr:postcode'],
    tags['addr:city'],
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : undefined;
};

// --------------------------------------------------------------------------
// Requête Overpass
// --------------------------------------------------------------------------

const buildOverpassQuery = (city: CityInfo): string => {
  // Une relation OSM devient une « area » : c'est le périmètre administratif
  // exact de la commune. Sinon on retombe sur un cercle autour du centre.
  const useArea = city.osmType === 'relation' && typeof city.osmId === 'number';
  const scope = useArea
    ? `area(${3600000000 + (city.osmId as number)})->.searchArea;`
    : '';
  const filter = useArea
    ? '(area.searchArea)'
    : `(around:${Math.round(bboxRadiusKm(city.bbox) * 1000)},${city.lat},${city.lng})`;

  // Chaque sélecteur est volontairement borné : un `["historic"]` nu ou tous
  // les lieux de culte d'une capitale ramèneraient des dizaines de milliers
  // d'éléments, dont l'immense majorité serait écartée ensuite.
  const selectors = [
    '["tourism"~"^(museum|attraction|artwork|gallery|viewpoint|zoo|aquarium|theme_park)$"]',
    '["historic"~"^(castle|monument|memorial|ruins|archaeological_site|city_gate|city_walls|fort|building|manor|house|tower|church|monastery|aqueduct|bridge)$"]',
    '["leisure"~"^(park|garden|nature_reserve)$"]',
    '["natural"~"^(beach|spring|waterfall)$"]',
    '["amenity"~"^(theatre|arts_centre|marketplace|townhall)$"]',
    '["man_made"~"^(tower|lighthouse|windmill|watermill)$"]',
    '["building"~"^(castle|cathedral|basilica)$"]',
    '["place"="square"]',
    // Lieux de culte et bibliothèques : seulement s'ils sont documentés.
    '["amenity"="place_of_worship"]["wikidata"]',
    '["amenity"="place_of_worship"]["heritage"]',
    '["amenity"="library"]["wikidata"]',
    '["amenity"="fountain"]["wikidata"]',
  ];

  const body = selectors.map((sel) => `  nwr${sel}["name"]${filter};`).join('\n');

  // La limite finale protège des villes très denses : au-delà, l'inventaire
  // n'est de toute façon plus exploitable à l'écran.
  return `[out:json][timeout:90];
${scope}
(
${body}
);
out tags center 3000;`;
};

const runOverpass = async (query: string): Promise<OverpassElement[]> => {
  let lastError: unknown = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      const json = await response.json();
      return (json.elements || []) as OverpassElement[];
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Aucun serveur OpenStreetMap n'a répondu (${
      lastError instanceof Error ? lastError.message : 'erreur réseau'
    }). Réessayez dans un instant.`
  );
};

// --------------------------------------------------------------------------
// Nettoyage
// --------------------------------------------------------------------------

const normalizeName = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * OSM représente souvent un même lieu plusieurs fois (le nœud « musée » et le
 * bâtiment qui le contient). On garde la variante la mieux documentée.
 */
export const dedupePois = (pois: POI[]): POI[] => {
  const kept = new Map<string, POI>();

  for (const poi of pois) {
    const key = normalizeName(poi.name);
    const existing = kept.get(key);

    if (!existing) {
      kept.set(key, poi);
      continue;
    }
    // Même nom mais loin l'un de l'autre : deux lieux distincts (ex. deux
    // fontaines « Fontaine Neptune » dans deux quartiers). On garde les deux.
    const farApart =
      Math.abs(existing.lat - poi.lat) > 0.003 || Math.abs(existing.lng - poi.lng) > 0.003;
    if (farApart) {
      kept.set(`${key}#${poi.id}`, poi);
      continue;
    }
    if (poi.notoriety > existing.notoriety) kept.set(key, poi);
  }

  return [...kept.values()];
};

/**
 * Convertit un élément Overpass en POI.
 * `onExcluded` est appelé quand un lieu classable est écarté par la sécurité.
 */
const elementToPoi = (element: OverpassElement, onExcluded?: () => void): POI | null => {
  const tags = element.tags || {};
  const name = tags.name;
  if (!name) return null;

  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  const classification = classify(tags);
  if (!classification) return null;

  // La sécurité passe après la classification : on ne compte comme « écartés »
  // que des lieux qui auraient réellement figuré dans l'inventaire.
  if (safetyExclusion(tags) !== null) {
    onExcluded?.();
    return null;
  }

  return {
    id: `osm-${element.type}-${element.id}`,
    name,
    theme: classification.theme,
    subtype: classification.subtype,
    lat,
    lng,
    address: buildAddress(tags),
    notoriety: scoreNotoriety(tags, classification.baseScore),
    visitMinutes: classification.visitMinutes,
    source: 'osm',
    wikidata: tags.wikidata,
    wikipedia: tags.wikipedia,
    website: tags.website || tags['contact:website'],
  };
};

// --------------------------------------------------------------------------
// Itinéraires cyclables officiels
// --------------------------------------------------------------------------

const buildCycleRoutesQuery = (city: CityInfo): string => {
  const useArea = city.osmType === 'relation' && typeof city.osmId === 'number';
  const scope = useArea ? `area(${3600000000 + (city.osmId as number)})->.searchArea;` : '';
  const filter = useArea
    ? '(area.searchArea)'
    : `(around:${Math.round(bboxRadiusKm(city.bbox) * 1000)},${city.lat},${city.lng})`;

  return `[out:json][timeout:60];
${scope}
relation["route"="bicycle"]["name"]${filter};
out tags 80;`;
};

const parseCycleRoutes = (elements: OverpassElement[]): CycleRoute[] => {
  const seen = new Set<string>();
  const routes: CycleRoute[] = [];

  for (const el of elements) {
    const tags = el.tags || {};
    if (!tags.name || seen.has(tags.name)) continue;
    seen.add(tags.name);

    const distance = tags.distance ? parseFloat(tags.distance.replace(',', '.')) : NaN;
    routes.push({
      id: `cycle-${el.id}`,
      name: tags.name,
      network: tags.network,
      ref: tags.ref,
      distanceKm: Number.isFinite(distance) ? Math.round(distance) : undefined,
    });
  }

  // Les grands itinéraires (nationaux, régionaux) d'abord.
  const rank = (r: CycleRoute) =>
    r.network === 'ncn' ? 0 : r.network === 'rcn' ? 1 : r.network === 'lcn' ? 2 : 3;
  return routes.sort((a, b) => rank(a) - rank(b)).slice(0, 20);
};

// --------------------------------------------------------------------------
// Cache navigateur
// --------------------------------------------------------------------------

const cacheKey = (city: string) => `${CACHE_PREFIX}${normalizeName(city)}`;

const readCache = (city: string): CityScan | null => {
  try {
    const raw = localStorage.getItem(cacheKey(city));
    if (!raw) return null;
    const scan = JSON.parse(raw) as CityScan;
    if (Date.now() - new Date(scan.scannedAt).getTime() > CACHE_TTL_MS) return null;
    // Les scans antérieurs à l'arrivée du vélo et des règles de sécurité
    // n'ont pas ces champs : on les invalide pour forcer un scan à jour.
    if (!Array.isArray(scan.cycleRoutes) || typeof scan.excludedCount !== 'number') {
      return null;
    }
    return scan;
  } catch {
    return null;
  }
};

const writeCache = (scan: CityScan) => {
  try {
    localStorage.setItem(cacheKey(scan.city.name), JSON.stringify(scan));
  } catch {
    // Quota dépassé : le cache est un confort, pas une obligation.
  }
};

export const clearScanCache = (city: string) => {
  try {
    localStorage.removeItem(cacheKey(city));
  } catch {
    /* rien à faire */
  }
};

// --------------------------------------------------------------------------
// Point d'entrée
// --------------------------------------------------------------------------

/**
 * Inventorie tous les POI touristiques d'une ville.
 * `force` ignore le cache et relance une vraie requête.
 */
export const scanCity = async (query: string, force = false): Promise<CityScan> => {
  if (!force) {
    const cached = readCache(query);
    if (cached) return cached;
  }

  const notes: string[] = [];
  const city = await geocodeCity(query);

  if (city.osmType !== 'relation') {
    notes.push(
      "Périmètre communal introuvable : le scan couvre un rayon autour du centre-ville."
    );
  }

  const elements = await runOverpass(buildOverpassQuery(city));

  let excludedCount = 0;
  const pois = dedupePois(
    elements
      .map((el) => elementToPoi(el, () => excludedCount++))
      .filter((p): p is POI => p !== null)
  ).sort((a, b) => b.notoriety - a.notoriety);

  if (pois.length === 0) {
    notes.push("Aucun lieu touristique cartographié pour cette ville sur OpenStreetMap.");
  }

  // Les itinéraires cyclables sont un bonus : leur échec ne bloque pas le scan.
  let cycleRoutes: CycleRoute[] = [];
  try {
    cycleRoutes = parseCycleRoutes(await runOverpass(buildCycleRoutesQuery(city)));
  } catch {
    notes.push("Les itinéraires cyclables officiels n'ont pas pu être relevés.");
  }

  const scan: CityScan = {
    city,
    pois,
    cycleRoutes,
    scannedAt: new Date().toISOString(),
    notes,
    excludedCount,
  };
  writeCache(scan);
  return scan;
};
