/**
 * Explications factuelles sur un lieu.
 *
 * Priorité aux sources vérifiables : le résumé Wikipédia quand le lieu y a une
 * fiche (tags wikipedia / wikidata d'OSM), l'IA seulement en dernier recours.
 * L'appelant sait d'où vient le texte et l'affiche avec sa source.
 */

import { POI } from '../types';

export interface PoiExplanation {
  text: string;
  source: 'wikipedia' | 'wikidata' | 'ai';
  url?: string;
}

const CACHE_PREFIX = 'nirmie_explain_';

const readCache = (id: string): PoiExplanation | null => {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${id}`);
    return raw ? (JSON.parse(raw) as PoiExplanation) : null;
  } catch {
    return null;
  }
};

const writeCache = (id: string, value: PoiExplanation) => {
  try {
    localStorage.setItem(`${CACHE_PREFIX}${id}`, JSON.stringify(value));
  } catch {
    /* cache facultatif */
  }
};

/** `fr:Château d'Annecy` -> { lang: 'fr', title: "Château d'Annecy" } */
const parseWikipediaTag = (tag: string): { lang: string; title: string } => {
  const idx = tag.indexOf(':');
  if (idx > 0 && idx <= 3) {
    return { lang: tag.slice(0, idx), title: tag.slice(idx + 1) };
  }
  return { lang: 'fr', title: tag };
};

const fetchWikipediaSummary = async (
  lang: string,
  title: string
): Promise<PoiExplanation | null> => {
  const response = await fetch(
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      title.replace(/ /g, '_')
    )}`,
    { headers: { Accept: 'application/json' } }
  );
  if (!response.ok) return null;

  const json = await response.json();
  const text = json.extract as string | undefined;
  if (!text) return null;

  return {
    text,
    source: 'wikipedia',
    url: json.content_urls?.desktop?.page,
  };
};

/** Retrouve la fiche Wikipédia francophone d'une entité Wikidata. */
const fetchViaWikidata = async (wikidataId: string): Promise<PoiExplanation | null> => {
  const response = await fetch(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(
      wikidataId
    )}&props=sitelinks|descriptions&languages=fr&format=json&origin=*`,
    { headers: { Accept: 'application/json' } }
  );
  if (!response.ok) return null;

  const json = await response.json();
  const entity = json.entities?.[wikidataId];
  if (!entity) return null;

  const frTitle = entity.sitelinks?.frwiki?.title;
  if (frTitle) {
    const summary = await fetchWikipediaSummary('fr', frTitle);
    if (summary) return summary;
  }

  const description = entity.descriptions?.fr?.value;
  if (description) {
    return {
      text: description,
      source: 'wikidata',
      url: `https://www.wikidata.org/wiki/${wikidataId}`,
    };
  }
  return null;
};

/**
 * Explication d'un POI depuis les sources encyclopédiques uniquement.
 * Retourne `null` si le lieu n'a aucune fiche — l'appelant peut alors
 * proposer le recours à l'IA.
 */
export const explainFromSources = async (poi: POI): Promise<PoiExplanation | null> => {
  const cached = readCache(poi.id);
  if (cached) return cached;

  try {
    if (poi.wikipedia) {
      const { lang, title } = parseWikipediaTag(poi.wikipedia);
      const summary = await fetchWikipediaSummary(lang, title);
      if (summary) {
        writeCache(poi.id, summary);
        return summary;
      }
    }
    if (poi.wikidata) {
      const viaWikidata = await fetchViaWikidata(poi.wikidata);
      if (viaWikidata) {
        writeCache(poi.id, viaWikidata);
        return viaWikidata;
      }
    }
  } catch {
    // Réseau indisponible : on laisse la main au fallback.
  }
  return null;
};

export const cacheAiExplanation = (poiId: string, text: string) => {
  writeCache(poiId, { text, source: 'ai' });
};
