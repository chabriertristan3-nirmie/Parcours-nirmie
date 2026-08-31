/**
 * Export des parcours vers Supabase (base Nirmie).
 *
 * On parle directement à l'API REST de Supabase (PostgREST) : pas de
 * dépendance supplémentaire. Les tables visées sont dédiées au générateur —
 * `generator_packs`, `generator_routes`, `generator_steps` — pour ne jamais
 * toucher aux tables existantes de l'application. Le SQL de création est dans
 * `supabase/schema.sql`.
 *
 * Configuration dans `.env.local` :
 *   SUPABASE_URL=https://xxxx.supabase.co
 *   SUPABASE_ANON_KEY=eyJ...
 */

import { GeneratedRoute, SavedPack } from '../types';

const getConfig = (): { url: string; key: string } | null => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ''), key };
};

export const isSupabaseConfigured = (): boolean => getConfig() !== null;

const upsert = async (
  config: { url: string; key: string },
  table: string,
  rows: object[]
): Promise<void> => {
  if (rows.length === 0) return;

  const response = await fetch(`${config.url}/rest/v1/${table}?on_conflict=id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Supabase a refusé l'écriture dans « ${table} » (HTTP ${response.status}). ${
        response.status === 404
          ? 'La table n\'existe pas encore : exécutez supabase/schema.sql dans l\'éditeur SQL.'
          : detail.slice(0, 300)
      }`
    );
  }
};

const routeRow = (route: GeneratedRoute, packId: string) => ({
  id: route.id,
  pack_id: packId,
  city: route.summary.city,
  title: route.summary.title,
  theme: route.summary.theme,
  travel_mode: route.summary.travelMode ?? 'walk',
  kind: route.summary.kind ?? 'tour',
  intro: route.summary.intro ?? null,
  // Tracé complet, pour le mode live de l'application Nirmie.
  path: route.path,
  geometry_source: route.geometrySource,
  distance_km: route.summary.totalDistanceKm,
  walking_minutes: route.summary.walkingMinutes,
  visit_minutes: route.summary.visitMinutes,
  total_minutes: route.summary.totalMinutes,
  stops_count: route.summary.stopsCount,
  is_loop: route.summary.loop,
  created_at: route.createdAt,
});

const stepRows = (route: GeneratedRoute) =>
  route.steps.map((step) => ({
    // L'id du POI est stable (id OSM) : préfixer par le parcours permet au
    // même lieu d'apparaître dans plusieurs parcours sans conflit.
    id: `${route.id}__${step.stepNumber}`,
    route_id: route.id,
    poi_id: step.id,
    step_number: step.stepNumber,
    name: step.name,
    subtype: step.subtype,
    theme: step.theme,
    lat: step.lat,
    lng: step.lng,
    address: step.address ?? null,
    notoriety: step.notoriety,
    visit_minutes: step.visitMinutes,
    distance_from_prev_m: step.distanceFromPrevM,
    duration_from_prev_s: step.durationFromPrevS,
    path_from_prev: step.pathFromPrev,
    description: step.description ?? null,
    anecdote: step.anecdote ?? null,
    wikidata: step.wikidata ?? null,
    wikipedia: step.wikipedia ?? null,
    website: step.website ?? null,
    source: step.source,
  }));

/**
 * Pousse un pack complet (parcours + étapes) vers Supabase.
 * Rejouable sans risque : les lignes existantes sont mises à jour, pas doublées.
 */
export const exportPackToSupabase = async (
  pack: SavedPack
): Promise<{ routes: number; steps: number }> => {
  const config = getConfig();
  if (!config) {
    throw new Error(
      'Supabase non configuré : renseignez SUPABASE_URL et SUPABASE_ANON_KEY dans .env.local.'
    );
  }

  await upsert(config, 'generator_packs', [
    {
      id: pack.id,
      city: pack.cityName,
      created_at: pack.createdAt,
      route_count: pack.routes.length,
      config: pack.config,
    },
  ]);

  await upsert(
    config,
    'generator_routes',
    pack.routes.map((r) => routeRow(r, pack.id))
  );

  const allSteps = pack.routes.flatMap(stepRows);
  await upsert(config, 'generator_steps', allSteps);

  return { routes: pack.routes.length, steps: allSteps.length };
};
