
export interface POI {
  id: string;
  name: string;
  address: string;
  lat?: number;
  lng?: number;
  category: string;
  description?: string;
  isManual?: boolean;
}

export interface RouteStep extends POI {
  stepNumber: number;
  distanceFromPrev?: string;
  detailedDescription?: string;
  historyAnecdote?: string; // Nouveau champ pour l'anecdote historique
}

export interface GeneratedRoute {
  id: string;
  createdAt: string;
  summary: {
    totalDistance: string;
    estimatedDuration: string;
    title: string;
    city: string;
    category?: string;
    theme?: string;
    lastStepAnecdote?: string;
  };
  steps: RouteStep[];
}

export interface SavedPack {
  id: string;
  cityName: string;
  createdAt: string;
  routes: GeneratedRoute[];
}

export type Theme = 
  | 'Historique & Patrimoine' 
  | 'Panoramas & Points de vue' 
  | 'Nature & Balades' 
  | 'Street art & Insolite';

export type CitySize = 'Compacte' | 'Standard' | 'Métropole' | 'Territorial';
export type RouteCategory = 'C1' | 'C2' | 'C3' | 'C4' | 'C5';

export interface AppState {
  city: string;
  citySize: CitySize;
  routeCategory: RouteCategory;
  startAddress: string;
  useCurrentLocation: boolean;
  distance: number; 
  ignoreDistance: boolean;
  duration: string;
  ignoreDuration: boolean;
  themes: Theme[];
  themeDistribution: Record<string, number>;
  customTheme: string;
  customInstructions: string;
  selectedPOIs: POI[];
  numberOfStops: number;
  numberOfAlternatives: number;
  experienceType: string;
  accessible: boolean;
  includePublicTransport: boolean;
  isLoop: boolean;
  isFullPackMode: boolean;
  isAdvancedMode: boolean;
  uniquePOIsAcrossRoutes: boolean;
  forceExactDistance: boolean;
  forcedDistanceValue: number;
  forceExactStops: boolean;
  forcedStopsValue: number;
}

export const INITIAL_STATE: AppState = {
  city: '',
  citySize: 'Standard',
  routeCategory: 'C2',
  startAddress: '',
  useCurrentLocation: false,
  distance: 2.5,
  ignoreDistance: false,
  duration: '45 min',
  ignoreDuration: false,
  themes: [],
  themeDistribution: {},
  customTheme: '',
  customInstructions: '', 
  selectedPOIs: [],
  numberOfStops: 5,
  numberOfAlternatives: 1,
  experienceType: 'Exploration libre',
  accessible: false,
  includePublicTransport: false,
  isLoop: false,
  isFullPackMode: true,
  isAdvancedMode: false,
  uniquePOIsAcrossRoutes: true,
  forceExactDistance: false,
  forcedDistanceValue: 5,
  forceExactStops: false,
  forcedStopsValue: 10,
};

export const CITY_DATABASE: Record<string, CitySize> = {
  "Paris": "Métropole", "Marseille": "Métropole", "Lyon": "Métropole", "Toulouse": "Métropole", 
  "Nice": "Métropole", "Nantes": "Métropole", "Montpellier": "Métropole", "Strasbourg": "Métropole", 
  "Bordeaux": "Métropole", "Lille": "Métropole", "Rennes": "Métropole", "Reims": "Métropole", 
  "Saint-Étienne": "Métropole", "Le Havre": "Métropole", "Toulon": "Métropole", "Grenoble": "Métropole", 
  "Dijon": "Métropole", "Angers": "Métropole", "Nîmes": "Métropole", "Villeurbanne": "Métropole",
  "Aix-en-Provence": "Standard", "Le Mans": "Standard", "Clermont-Ferrand": "Standard", "Brest": "Standard", 
  "Tours": "Standard", "Amiens": "Standard", "Limoges": "Standard", "Annecy": "Standard", 
  "Boulogne-Billancourt": "Standard", "Perpignan": "Standard", "Metz": "Standard", "Besançon": "Standard", 
  "Orléans": "Standard", "Saint-Denis": "Standard", "Rouen": "Standard", "Argenteuil": "Standard", 
  "Mulhouse": "Standard", "Caen": "Standard", "Nancy": "Standard", "Saint-Paul": "Standard",
  "Avignon": "Compacte", "Poitiers": "Compacte", "Versailles": "Compacte", "Pau": "Compacte", 
  "Antibes": "Compacte", "Cannes": "Compacte", "La Rochelle": "Compacte", "Béziers": "Compacte", 
  "Mérignac": "Compacte", "Saint-Maur-des-Fossés": "Compacte", "Colmar": "Compacte", "Ajaccio": "Compacte", 
  "Bourges": "Compacte", "Vannes": "Compacte", "Biarritz": "Compacte", "Arles": "Compacte"
};
