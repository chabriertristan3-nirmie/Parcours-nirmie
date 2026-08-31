/**
 * Modèle de données NirmieRoute.
 *
 * Principe : on part de l'inventaire réel des POI d'une ville, puis on en déduit
 * combien de parcours cette ville peut porter. Rien n'est codé en dur.
 */

export type PoiTheme =
  | 'Patrimoine & Histoire'
  | 'Panoramas & Points de vue'
  | 'Nature & Jardins'
  | 'Art & Insolite'
  | 'Places & Vie locale';

export const POI_THEMES: PoiTheme[] = [
  'Patrimoine & Histoire',
  'Panoramas & Points de vue',
  'Nature & Jardins',
  'Art & Insolite',
  'Places & Vie locale',
];

export const THEME_COLORS: Record<PoiTheme, string> = {
  'Patrimoine & Histoire': '#d97706',
  'Panoramas & Points de vue': '#2563eb',
  'Nature & Jardins': '#10b981',
  'Art & Insolite': '#9333ea',
  'Places & Vie locale': '#ec4899',
};

export type PoiSource = 'osm' | 'ai' | 'manual';

export type TravelMode = 'walk' | 'bike';

/**
 * Les deux familles de parcours.
 *
 * `tour` : les lieux commandent. On enchaîne des POI et on s'arrête à chacun.
 * `free` : la distance commande, et rien d'autre. Une boucle aléatoire de la
 *          longueur demandée, sans aucun point d'intérêt — c'est ce qui la rend
 *          possible dans une ville qui n'a rien à visiter.
 */
export type RouteKind = 'tour' | 'free';

/** Point de départ d'un parcours libre. */
export interface StartPoint {
  lat: number;
  lng: number;
  label: string;
}

export interface POI {
  id: string;
  name: string;
  theme: PoiTheme;
  /** Libellé lisible du type de lieu : « Musée », « Point de vue »… */
  subtype: string;
  lat: number;
  lng: number;
  address?: string;
  /** Score de notoriété 0-100, déduit des tags (wikidata, patrimoine, type de lieu). */
  notoriety: number;
  /** Durée d'arrêt conseillée, en minutes. */
  visitMinutes: number;
  source: PoiSource;
  wikidata?: string;
  wikipedia?: string;
  website?: string;
  /** Rempli par l'enrichissement IA, au moment de la génération des parcours. */
  description?: string;
  anecdote?: string;
}

export interface CityInfo {
  /** Nom court, tel qu'affiché partout dans l'app. */
  name: string;
  /** Libellé complet renvoyé par le géocodeur. */
  displayName: string;
  lat: number;
  lng: number;
  /** [sud, nord, ouest, est] */
  bbox: [number, number, number, number];
  osmType?: string;
  osmId?: number;
}

/** Itinéraire cyclable officiel (relation OSM route=bicycle) traversant la ville. */
export interface CycleRoute {
  id: string;
  name: string;
  /** lcn = local, rcn = régional, ncn = national (ex. ViaRhôna). */
  network?: string;
  ref?: string;
  distanceKm?: number;
}

export interface CityScan {
  city: CityInfo;
  pois: POI[];
  /** Itinéraires cyclables balisés relevés dans la commune. */
  cycleRoutes: CycleRoute[];
  scannedAt: string;
  /** Avertissements non bloquants remontés pendant le scan. */
  notes: string[];
  /** Lieux écartés par les règles de sécurité, pour information. */
  excludedCount: number;
}

/** Filtres appliqués à l'inventaire avant planification. */
export interface PoiFilters {
  themes: PoiTheme[];
  minNotoriety: number;
  search: string;
}

export type ThemeMode = 'mixed' | 'thematic';

/**
 * Ce qui cadre la taille d'un parcours touristique.
 *
 * `stops`    : vous fixez les bornes d'arrêts, la durée en découle.
 * `duration` : vous fixez le temps dont vous disposez, et tout le reste en
 *              découle — nombre d'arrêts, distance de marche, et donc le
 *              nombre de parcours que la ville peut porter.
 */
export type SizingMode = 'stops' | 'duration';

export interface RouteConfig {
  /** Famille de parcours : visite de lieux, ou boucle à la distance voulue. */
  kind: RouteKind;
  /** À pied ou à vélo — change les vitesses et les distances raisonnables. */
  travelMode: TravelMode;

  // --- Propres aux parcours libres ---------------------------------------
  /** Longueur visée de la boucle, en km. */
  targetDistanceKm: number;
  /** Point de départ imposé. `null` = déterminé par le générateur. */
  start: StartPoint | null;
  /**
   * Répartit les départs sur toute la commune, un par boucle.
   *
   * Sans cela, toutes les boucles partent du même point et se recouvrent :
   * quatre circuits de 3,5 km deviennent quatre variantes du même. Ignoré dès
   * qu'un départ est imposé par `start`.
   */
  spreadStarts: boolean;
  /** Ce qui cadre la taille des parcours : les arrêts, ou le temps. */
  sizingMode: SizingMode;
  /** Temps disponible par parcours, en minutes (mode `duration`). */
  targetMinutes: number;
  /**
   * Nombre d'arrêts imposé malgré le cadrage par le temps.
   * `null` = déduit du temps disponible. Fixé, c'est la distance de marche qui
   * s'ajuste pour tenir dans le budget.
   */
  stopsOverride: number | null;
  /** Bornes du nombre d'arrêts par parcours (mode `stops`). */
  stopsMin: number;
  stopsTarget: number;
  stopsMax: number;
  /** Budget de marche par parcours, en km. `null` = pas de limite. */
  maxDistanceKm: number | null;
  /** Le parcours revient à son point de départ. */
  loop: boolean;
  /** `thematic` : un parcours = un thème. `mixed` : thèmes mélangés. */
  themeMode: ThemeMode;
  /** Autoriser un POI à servir dans deux parcours différents. */
  reusePois: boolean;
  /** `null` = on produit tout ce que la ville permet. */
  routeCount: number | null;
  /** Vitesse de marche en km/h. */
  paceKmh: number;
  /** Écrit les descriptions et anecdotes avec Gemini. */
  enrichWithAI: boolean;
  /**
   * Calcule le tracé réel par les rues et chemins (OpenStreetMap).
   * Désactivé, les parcours restent en lignes droites entre les arrêts.
   */
  followStreets: boolean;
}

export const DEFAULT_ROUTE_CONFIG: RouteConfig = {
  kind: 'tour',
  travelMode: 'walk',
  targetDistanceKm: 6,
  start: null,
  spreadStarts: true,
  sizingMode: 'stops',
  targetMinutes: 90,
  stopsOverride: null,
  stopsMin: 4,
  stopsTarget: 6,
  stopsMax: 9,
  maxDistanceKm: 4,
  loop: false,
  themeMode: 'mixed',
  reusePois: false,
  routeCount: null,
  paceKmh: 4.2,
  enrichWithAI: true,
  followStreets: true,
};

/** Réglages raisonnables propres à chaque mode de déplacement. */
export const MODE_PRESETS: Record<
  TravelMode,
  {
    label: string;
    defaultDistanceKm: number;
    distanceMinKm: number;
    distanceMaxKm: number;
    paces: { value: number; label: string }[];
    defaultPaceKmh: number;
  }
> = {
  walk: {
    label: 'À pied',
    defaultDistanceKm: 4,
    distanceMinKm: 1,
    distanceMaxKm: 15,
    paces: [
      { value: 3.4, label: 'Flânerie' },
      { value: 4.2, label: 'Normal' },
      { value: 5, label: 'Soutenu' },
    ],
    defaultPaceKmh: 4.2,
  },
  bike: {
    label: 'À vélo',
    defaultDistanceKm: 20,
    distanceMinKm: 5,
    distanceMaxKm: 60,
    paces: [
      { value: 12, label: 'Tranquille' },
      { value: 15, label: 'Normal' },
      { value: 18, label: 'Sportif' },
    ],
    defaultPaceKmh: 15,
  },
};

/** Préconisation renvoyée par l'IA sur l'écran de réglages. */
export interface AiRecommendation {
  routeCount: number;
  stopsMin: number;
  stopsTarget: number;
  stopsMax: number;
  maxDistanceKm: number;
  themeMode: ThemeMode;
  loop: boolean;
  /** Justification en français, affichée telle quelle. */
  rationale: string;
}

/**
 * Point d'un tracé, sous la forme `[latitude, longitude]`.
 *
 * Attention : GeoJSON utilise l'ordre inverse. L'export JSON fournit aussi un
 * bloc `geojson` en ordre standard `[longitude, latitude]` pour les outils qui
 * l'attendent.
 */
export type PathPoint = [number, number];

/** D'où vient le tracé affiché et exporté. */
export type GeometrySource =
  /** Itinéraire réel suivant rues et chemins. */
  | 'osrm'
  /** Repli : ligne droite entre les arrêts, le routage ayant échoué. */
  | 'straight';

export interface RouteStep extends POI {
  stepNumber: number;
  /** Distance depuis l'étape précédente, en mètres (0 pour la première). */
  distanceFromPrevM: number;
  /** Temps de trajet depuis l'étape précédente, en secondes. */
  durationFromPrevS: number;
  /**
   * Tracé depuis l'étape précédente, prêt à être dessiné ou suivi en direct.
   * Vide pour la première étape.
   */
  pathFromPrev: PathPoint[];
}

export interface RouteSummary {
  title: string;
  city: string;
  theme: string;
  /** Absent sur les parcours sauvegardés avant l'arrivée du mode vélo. */
  travelMode?: TravelMode;
  /** Absent sur les parcours antérieurs aux parcours libres : ils sont `tour`. */
  kind?: RouteKind;
  totalDistanceKm: number;
  walkingMinutes: number;
  visitMinutes: number;
  totalMinutes: number;
  stopsCount: number;
  loop: boolean;
  /** Texte d'accroche, écrit par l'IA si l'enrichissement est actif. */
  intro?: string;
}

export interface GeneratedRoute {
  id: string;
  createdAt: string;
  summary: RouteSummary;
  steps: RouteStep[];
  /** Tracé complet, de la première à la dernière étape (boucle comprise). */
  path: PathPoint[];
  /** `osrm` = tracé réel par les rues, `straight` = lignes droites de secours. */
  geometrySource: GeometrySource;
}

/** Ce que la ville permet de produire, compte tenu des filtres et des réglages. */
export interface Capacity {
  /** POI retenus après filtres. */
  poolSize: number;
  /** Nombre de parcours maximal atteignable. */
  maxRoutes: number;
  /** Nombre confortable, à la cible d'arrêts demandée. */
  recommendedRoutes: number;
  /** POI qui resteront inutilisés si on génère `maxRoutes` parcours. */
  leftovers: number;
  /** Répartition du pool par thème. */
  byTheme: Record<string, number>;
  /** Arrêts effectivement visés — déduits du temps en mode `duration`. */
  stopsTarget: number;
  /** Durée moyenne estimée d'un parcours, visites comprises, en minutes. */
  estimatedMinutes: number;
  /** Part de cette durée passée à marcher ou pédaler. */
  estimatedEffortMinutes: number;
  /** Budget de distance effectif, en km. `null` = pas de limite. */
  maxDistanceKm: number | null;
}

export interface SavedPack {
  id: string;
  cityName: string;
  createdAt: string;
  routes: GeneratedRoute[];
  config: RouteConfig;
}
