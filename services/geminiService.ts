/**
 * Enrichissement éditorial des parcours.
 *
 * L'IA ne choisit plus les lieux, ne compte plus les étapes et ne calcule plus
 * les distances : tout cela vient d'OpenStreetMap et du planificateur. Elle
 * n'écrit que les textes, à partir de lieux qui existent vraiment.
 */

import { GoogleGenAI, Type, Schema } from '@google/genai';
import { CityInfo, GeneratedRoute, POI, PoiTheme, POI_THEMES } from '../types';

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
