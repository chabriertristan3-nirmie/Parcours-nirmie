/**
 * Enrichissement éditorial des parcours.
 *
 * L'IA ne choisit plus les lieux, ne compte plus les étapes et ne calcule plus
 * les distances : tout cela vient d'OpenStreetMap et du planificateur. Elle
 * n'écrit que les textes, à partir de lieux qui existent vraiment.
 */

import { GoogleGenAI, Type, Schema } from '@google/genai';
import {
  AiRecommendation,
  CityInfo,
  CityScan,
  GeneratedRoute,
  MODE_PRESETS,
  POI,
  PoiTheme,
  POI_THEMES,
  TravelMode,
} from '../types';

const ENRICH_MODEL = 'gemini-3-flash-preview';
const SUGGEST_MODEL = 'gemini-3-flash-preview';

/** Nombre de parcours enrichis par appel : au-delà les réponses se dégradent. */
const BATCH_SIZE = 3;

let client: GoogleGenAI | null = null;

const getClient = (): GoogleGenAI => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
    throw new Error(
      "Clé Gemini absente : renseignez GEMINI_API_KEY dans .env.local, ou désactivez l'enrichissement IA."
    );
  }
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
};

export const hasApiKey = (): boolean => {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key) && key !== 'PLACEHOLDER_API_KEY';
};

// --------------------------------------------------------------------------
// Enrichissement des parcours
// --------------------------------------------------------------------------

const enrichmentSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    routes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          routeIndex: { type: Type.INTEGER, description: 'Index du parcours, tel que fourni' },
          title: { type: Type.STRING, description: 'Titre court et évocateur, 3 à 6 mots' },
          intro: { type: Type.STRING, description: 'Accroche du parcours, 25 à 40 mots' },
          steps: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                n: { type: Type.INTEGER, description: "Numéro de l'étape, tel que fourni" },
                desc: { type: Type.STRING, description: 'Description sensorielle du lieu, 25 à 40 mots' },
                anecdote: { type: Type.STRING, description: 'Fait historique concret, 20 à 35 mots' },
              },
              required: ['n', 'desc', 'anecdote'],
            },
          },
        },
        required: ['routeIndex', 'title', 'intro', 'steps'],
      },
    },
  },
  required: ['routes'],
};

const describeRoutesForPrompt = (routes: GeneratedRoute[], offset: number): string =>
  routes
    .map((route, i) => {
      const steps = route.steps
        .map((s) => `    ${s.stepNumber}. ${s.name} (${s.subtype}, ${s.theme})`)
        .join('\n');
      return `Parcours ${offset + i} — ${route.summary.stopsCount} étapes, ${route.summary.totalDistanceKm} km, thème dominant « ${route.summary.theme} » :\n${steps}`;
    })
    .join('\n\n');

const enrichBatch = async (
  city: CityInfo,
  routes: GeneratedRoute[],
  offset: number
): Promise<GeneratedRoute[]> => {
  const ai = getClient();

  const prompt = `Tu es guide-conférencier à ${city.name} (${city.displayName}).

Voici des parcours à pied déjà construits. Les lieux, leur ordre et leur nombre sont FIXES : ne les modifie pas, n'en ajoute pas, n'en retire pas.

${describeRoutesForPrompt(routes, offset)}

Pour chaque parcours, rédige :
- un titre court et évocateur ;
- une accroche de 25 à 40 mots ;
- pour CHAQUE étape, une description sensorielle (25-40 mots) et une anecdote historique concrète (20-35 mots).

Règles :
- Reprends exactement les numéros d'étape et les index de parcours fournis.
- Si tu ne connais pas un lieu précis, décris-le à partir de son type et de son quartier, sans inventer de fait daté.
- Écris en français, au présent, sans superlatif creux.`;

  const response = await ai.models.generateContent({
    model: ENRICH_MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: enrichmentSchema,
      temperature: 0.7,
    },
  });

  const parsed = JSON.parse(response.text || '{}');
  const byIndex = new Map<number, any>();
  (parsed.routes || []).forEach((r: any) => byIndex.set(r.routeIndex, r));

  return routes.map((route, i) => {
    const enrichment = byIndex.get(offset + i);
    if (!enrichment) return route;

    const stepTexts = new Map<number, any>();
    (enrichment.steps || []).forEach((s: any) => stepTexts.set(s.n, s));

    return {
      ...route,
      summary: {
        ...route.summary,
        title: enrichment.title || route.summary.title,
        intro: enrichment.intro,
      },
      steps: route.steps.map((step) => {
        const text = stepTexts.get(step.stepNumber);
        return text ? { ...step, description: text.desc, anecdote: text.anecdote } : step;
      }),
    };
  });
};

/**
 * Enrichit tous les parcours, par lots.
 *
 * Un lot qui échoue n'invalide pas les autres : le parcours ressort avec ses
 * données factuelles, simplement sans texte. Mieux vaut un parcours sobre
 * qu'aucun parcours.
 */
export const enrichRoutes = async (
  city: CityInfo,
  routes: GeneratedRoute[],
  onProgress?: (done: number, total: number) => void
): Promise<{ routes: GeneratedRoute[]; failures: number }> => {
  const enriched: GeneratedRoute[] = [];
  let failures = 0;

  for (let offset = 0; offset < routes.length; offset += BATCH_SIZE) {
    const batch = routes.slice(offset, offset + BATCH_SIZE);
    try {
      enriched.push(...(await enrichBatch(city, batch, offset)));
    } catch (error) {
      console.error('Enrichissement du lot échoué :', error);
      failures += batch.length;
      enriched.push(...batch);
    }
    onProgress?.(Math.min(offset + BATCH_SIZE, routes.length), routes.length);
  }

  return { routes: enriched, failures };
};

// --------------------------------------------------------------------------
// Préconisation de plan
// --------------------------------------------------------------------------

const recommendationSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    routeCount: { type: Type.INTEGER, description: 'Nombre de parcours conseillé' },
    stopsMin: { type: Type.INTEGER },
    stopsTarget: { type: Type.INTEGER },
    stopsMax: { type: Type.INTEGER },
    maxDistanceKm: { type: Type.NUMBER },
    themeMode: { type: Type.STRING, description: '"mixed" ou "thematic"' },
    loop: { type: Type.BOOLEAN },
    rationale: {
      type: Type.STRING,
      description: 'Justification en français, 50 à 90 mots, ton direct',
    },
  },
  required: [
    'routeCount',
    'stopsMin',
    'stopsTarget',
    'stopsMax',
    'maxDistanceKm',
    'themeMode',
    'loop',
    'rationale',
  ],
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value)));

/**
 * Demande à l'IA un plan de production pour la ville : combien de parcours,
 * quelle taille, quelle composition. Le résultat pré-remplit les réglages,
 * l'utilisateur garde la main sur tout.
 */
export const recommendPlan = async (
  scan: CityScan,
  pool: POI[],
  travelMode: TravelMode
): Promise<AiRecommendation> => {
  const ai = getClient();
  const preset = MODE_PRESETS[travelMode];

  const byTheme = POI_THEMES.map(
    (t) => `${t} : ${pool.filter((p) => p.theme === t).length}`
  ).join(', ');
  const famous = pool
    .filter((p) => p.notoriety >= 60)
    .slice(0, 15)
    .map((p) => p.name)
    .join(', ');
  const cycleInfo =
    travelMode === 'bike' && scan.cycleRoutes.length > 0
      ? `Itinéraires cyclables balisés sur place : ${scan.cycleRoutes
          .slice(0, 8)
          .map((r) => r.name)
          .join(', ')}.`
      : '';

  const prompt = `Tu prépares la production de parcours touristiques ${
    travelMode === 'bike' ? 'à vélo' : 'à pied'
  } pour ${scan.city.name} (${scan.city.displayName}).

Inventaire réel : ${pool.length} lieux exploitables. Répartition : ${byTheme}.
Lieux les plus notables : ${famous || 'aucun lieu majeur'}.
${cycleInfo}

Propose un plan de production : combien de parcours publier, avec quelles bornes d'arrêts (min/cible/max), quelle distance maximale par parcours (entre ${preset.distanceMinKm} et ${preset.distanceMaxKm} km, mode ${
    travelMode === 'bike' ? 'vélo' : 'marche'
  }), en boucle ou non, thèmes mélangés ou un thème par parcours.

Raisonne en éditeur d'application touristique : mieux vaut peu de parcours excellents que beaucoup de parcours dilués. Les lieux mineurs n'ont pas tous vocation à être utilisés. Justifie en 50 à 90 mots.`;

  const response = await ai.models.generateContent({
    model: ENRICH_MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: recommendationSchema,
      temperature: 0.4,
    },
  });

  const raw = JSON.parse(response.text || '{}');

  // L'IA propose, le code garantit : tout est reborné avant application.
  const stopsMin = clamp(raw.stopsMin ?? 4, 2, 12);
  const stopsTarget = clamp(raw.stopsTarget ?? stopsMin + 2, stopsMin, 15);
  const stopsMax = clamp(raw.stopsMax ?? stopsTarget + 3, stopsTarget, 20);
  const hardMax = Math.floor(pool.length / Math.max(1, stopsMin));

  return {
    routeCount: clamp(raw.routeCount ?? 1, 1, Math.max(1, hardMax)),
    stopsMin,
    stopsTarget,
    stopsMax,
    maxDistanceKm:
      Math.round(
        clamp(raw.maxDistanceKm ?? preset.defaultDistanceKm, preset.distanceMinKm, preset.distanceMaxKm) * 2
      ) / 2,
    themeMode: raw.themeMode === 'thematic' ? 'thematic' : 'mixed',
    loop: Boolean(raw.loop),
    rationale: String(raw.rationale || '').trim(),
  };
};

// --------------------------------------------------------------------------
// Explication d'un lieu (secours quand Wikipédia ne connaît pas le lieu)
// --------------------------------------------------------------------------

export const explainPoi = async (city: CityInfo, poi: POI): Promise<string> => {
  const ai = getClient();

  const response = await ai.models.generateContent({
    model: ENRICH_MODEL,
    contents: `Lieu : ${poi.name} (${poi.subtype}) à ${city.name} (${city.displayName}), coordonnées ${poi.lat.toFixed(4)}, ${poi.lng.toFixed(4)}.

Explique ce lieu à un visiteur en 50 à 80 mots : ce que c'est, ce qu'on y voit, et si tu le sais avec certitude, un élément d'histoire. Si tu ne connais pas ce lieu précis, décris honnêtement ce que son type et son quartier laissent attendre, sans inventer de dates ni de faits. Français, ton direct, pas de superlatifs creux.`,
    config: { temperature: 0.5 },
  });

  return (response.text || '').trim();
};

// --------------------------------------------------------------------------
// Complément d'inventaire
// --------------------------------------------------------------------------

const suggestionSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    pois: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          theme: { type: Type.STRING, description: `Un de : ${POI_THEMES.join(' | ')}` },
          subtype: { type: Type.STRING, description: 'Type de lieu en un ou deux mots' },
          lat: { type: Type.NUMBER },
          lng: { type: Type.NUMBER },
          address: { type: Type.STRING },
          visitMinutes: { type: Type.INTEGER },
        },
        required: ['name', 'theme', 'subtype', 'lat', 'lng'],
      },
    },
  },
  required: ['pois'],
};

/**
 * Complète l'inventaire OSM avec les incontournables qui y manqueraient.
 *
 * Optionnel et volontairement limité : OpenStreetMap reste la référence, l'IA
 * ne fait que boucher les trous. Les coordonnées renvoyées sont approximatives,
 * les POI sont donc marqués comme d'origine IA dans l'interface.
 */
export const suggestMissingPOIs = async (
  city: CityInfo,
  existing: POI[],
  limit = 10
): Promise<POI[]> => {
  const ai = getClient();
  const known = existing
    .slice(0, 60)
    .map((p) => p.name)
    .join(', ');

  const response = await ai.models.generateContent({
    model: SUGGEST_MODEL,
    contents: `Ville : ${city.name} (${city.displayName}), centre approximatif ${city.lat.toFixed(4)}, ${city.lng.toFixed(4)}.

Lieux touristiques déjà répertoriés : ${known || 'aucun'}.

Cite au maximum ${limit} lieux touristiques réels et emblématiques de cette ville qui MANQUENT à cette liste. Donne des coordonnées GPS plausibles. N'invente aucun lieu : s'il n'en manque pas, renvoie une liste vide.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: suggestionSchema,
      temperature: 0.3,
    },
  });

  const parsed = JSON.parse(response.text || '{}');
  const knownNames = new Set(existing.map((p) => p.name.toLowerCase()));

  return (parsed.pois || [])
    .filter((p: any) => p?.name && !knownNames.has(String(p.name).toLowerCase()))
    .slice(0, limit)
    .map(
      (p: any, i: number): POI => ({
        id: `ai-${Date.now()}-${i}`,
        name: p.name,
        theme: (POI_THEMES.includes(p.theme) ? p.theme : 'Patrimoine & Histoire') as PoiTheme,
        subtype: p.subtype || 'Lieu remarquable',
        lat: Number(p.lat),
        lng: Number(p.lng),
        address: p.address,
        notoriety: 65,
        visitMinutes: Number(p.visitMinutes) || 20,
        source: 'ai',
      })
    )
    .filter((p: POI) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
};
