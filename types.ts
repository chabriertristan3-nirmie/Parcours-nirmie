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

export interface CityScan {
  city: CityInfo;
  pois: POI[];
  scannedAt: string;
  /** Avertissements non bloquants remontés pendant le scan. */
  notes: string[];
}

/** Filtres appliqués à l'inventaire avant planification. */
export interface PoiFilters {
  themes: PoiTheme[];
  minNotoriety: number;
  search: string;
}

export type ThemeMode = 'mixed' | 'thematic';

export interface RouteConfig {
  /** Bornes du nombre d'arrêts par parcours. */
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
}

export const DEFAULT_ROUTE_CONFIG: RouteConfig = {
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
};

export interface RouteStep extends POI {
  stepNumber: number;
  /** Distance de marche estimée depuis l'étape précédente, en mètres. */
  distanceFromPrevM: number;
}

export interface RouteSummary {
  title: string;
  city: string;
  theme: string;
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
}

export interface SavedPack {
  id: string;
  cityName: string;
  createdAt: string;
  routes: GeneratedRoute[];
  config: RouteConfig;
}
