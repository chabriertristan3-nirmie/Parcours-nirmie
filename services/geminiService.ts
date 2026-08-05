
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { AppState, POI, GeneratedRoute, CitySize } from "../types.ts";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const flatRouteSchema: Schema = {
    type: Type.OBJECT,
    properties: {
        title: { type: Type.STRING },
        totalDistance: { type: Type.STRING, description: "Distance réelle calculée (ex: 3.2 km)" },
        estimatedDuration: { type: Type.STRING, description: "Durée réelle : marche + arrêts (ex: 1h15)" },
        category: { type: Type.STRING },
        theme: { type: Type.STRING },
        lastStepAnecdote: { type: Type.STRING },
        steps: {
            type: Type.ARRAY,
            description: "Liste exhaustive de toutes les étapes du parcours",
            items: {
                type: Type.OBJECT,
                properties: {
                    n: { type: Type.INTEGER, description: "Numéro de l'étape" },
                    name: { type: Type.STRING },
                    addr: { type: Type.STRING },
                    lat: { type: Type.NUMBER },
                    lng: { type: Type.NUMBER },
                    cat: { type: Type.STRING },
                    desc: { type: Type.STRING, description: "Description immersive de l'ambiance (30-45 mots)" },
                    hist: { type: Type.STRING, description: "Anecdote historique concrète ou rappel à l'histoire du lieu (25-35 mots)" },
                },
                required: ["n", "name", "addr", "lat", "lng", "desc", "hist"],
            },
        },
    },
    required: ["title", "totalDistance", "estimatedDuration", "category", "theme", "lastStepAnecdote", "steps"],
};

const getPackStructure = (size: CitySize) => {
    if (size === 'Compacte') return {
        count: 11,
        categories: { C1: 4, C2: 5, C3: 2, C4: 0 },
        themes: { 'Historique & Patrimoine': 4, 'Panoramas & Points de vue': 2, 'Nature & Balades': 3, 'Street art & Insolite': 2 }
    };
    if (size === 'Standard') return {
        count: 16,
        categories: { C1: 5, C2: 7, C3: 3, C4: 1 },
        themes: { 'Historique & Patrimoine': 5, 'Panoramas & Points de vue': 4, 'Nature & Balades': 4, 'Street art & Insolite': 3 }
    };
    if (size === 'Métropole') return {
        count: 26,
        categories: { C1: 7, C2: 10, C3: 6, C4: 3 },
        themes: { 'Historique & Patrimoine': 8, 'Panoramas & Points de vue': 7, 'Nature & Balades': 6, 'Street art & Insolite': 5 }
    };
    return { count: 1, categories: { C5: 1 }, themes: { 'Historique & Patrimoine': 1 } };
};

const getPOIConfig = (cat: string) => {
    if (cat === 'C1') return { stops: 8, dist: "1.5-2km", dur: "30-40min" };
    if (cat === 'C2') return { stops: 10, dist: "2.1-3km", dur: "45-60min" };
    if (cat === 'C3') return { stops: 13, dist: "3.1-4km", dur: "75-90min" };
    if (cat === 'C4') return { stops: 17, dist: "6-10km", dur: "1h30-2h30" };
    return { stops: 15, dist: "Variable", dur: "Libre" };
};

export const generateRoute = async (state: AppState): Promise<GeneratedRoute[]> => {
    const { city, citySize, isFullPackMode, isAdvancedMode, numberOfAlternatives, numberOfStops, forceExactStops, forcedStopsValue } = state;
    
    let routesToGenerate: { category: string; theme: string; stops: number; targetDist?: string }[] = [];

    if (isFullPackMode) {
        const structure = getPackStructure(citySize);
        const cats = Object.entries(structure.categories).flatMap(([c, n]) => Array(n).fill(c));
        const themes = Object.entries(structure.themes).flatMap(([t, n]) => Array(n).fill(t));
        routesToGenerate = cats.map((cat, i) => {
            const config = getPOIConfig(cat);
            return { category: cat, theme: themes[i] || themes[0], stops: config.stops, targetDist: config.dist };
        });
    } else {
        const stopsCount = forceExactStops ? forcedStopsValue : numberOfStops;
        const count = isAdvancedMode ? numberOfAlternatives : (numberOfAlternatives || 1);
        for(let i=0; i < count; i++) {
            routesToGenerate.push({ 
                category: state.routeCategory, 
                theme: state.themes[0] || 'Historique & Patrimoine', 
                stops: stopsCount 
            });
        }
    }

    const packCount = routesToGenerate.length;
    const routesDetailsString = routesToGenerate.map((r, i) => 
        `- Parcours #${i+1} : Thème "${r.theme}", Catégorie "${r.category}", DOIT CONTENIR EXACTEMENT ${r.stops} ÉTAPES (POI).`
    ).join('\n');

    const prompt = `
        Tu es un expert historien et guide local pour la ville de ${city}. 
        Génère EXACTEMENT ${packCount} parcours uniques avec les caractéristiques suivantes :
        
        ${routesDetailsString}

        CONSIGNES DE RÉDACTION POUR CHAQUE ÉTAPE :
        1. "desc" : Description immersive et sensorielle (20-30 mots).
        2. "hist" : Anecdote historique concrète (20-30 mots).
        
        RÈGLES DE STRUCTURE CRITIQUES :
        - Pour chaque parcours, le tableau "steps" doit avoir la longueur exacte demandée ci-dessus.
        - Ne résume pas les parcours. Liste chaque lieu un par un de 1 à N.
        - Chaque étape DOIT avoir son anecdote historique propre.
        - Vérifie la cohérence géographique des coordonnées (lat/lng) pour que le parcours soit marchable.
    `;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-3.1-pro-preview",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        routes: { 
                            type: Type.ARRAY, 
                            items: flatRouteSchema,
                            description: `Liste de ${packCount} objets parcours`
                        }
                    },
                    required: ["routes"]
                },
                temperature: 0.2, // Réduit pour plus de rigueur sur le format JSON et le nombre d'étapes
            },
        });

        const text = response.text || "{}";
        const json = JSON.parse(text);
        
        const results: GeneratedRoute[] = (json.routes || []).map((r: any, index: number) => ({
            id: `route-${Date.now()}-${index}`,
            createdAt: new Date().toISOString(),
            summary: {
                title: r.title,
                totalDistance: r.totalDistance,
                estimatedDuration: r.estimatedDuration,
                category: r.category,
                theme: r.theme,
                lastStepAnecdote: r.lastStepAnecdote,
                city: city
            },
            steps: (r.steps || []).map((s: any) => ({
                stepNumber: s.n,
                name: s.name,
                address: s.addr,
                lat: s.lat,
                lng: s.lng,
                category: s.cat,
                description: s.desc,
                historyAnecdote: s.hist
            }))
        }));

        return results;
    } catch (error) {
        console.error("Erreur Gemini:", error);
        throw error;
    }
};

export const suggestPOIs = async (state: AppState): Promise<POI[]> => {
    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Donne-moi 8 lieux d'intérêt réels et emblématiques à ${state.city} pour un parcours touristique.`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        pois: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    name: { type: Type.STRING },
                                    address: { type: Type.STRING },
                                    lat: { type: Type.NUMBER },
                                    lng: { type: Type.NUMBER },
                                    category: { type: Type.STRING },
                                },
                                required: ["name", "address", "lat", "lng"]
                            }
                        }
                    }
                },
            },
        });
        const json = JSON.parse(response.text || "{}");
        return (json.pois || []).map((p: any, i: number) => ({ ...p, id: `poi-${Date.now()}-${i}` }));
    } catch (error) {
        return [];
    }
};
