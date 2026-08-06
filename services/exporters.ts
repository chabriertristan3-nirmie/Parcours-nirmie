/**
 * Exports de parcours.
 *
 * Le JSON est le format pivot pour l'app Nirmie : il contient tout, y compris
 * les coordonnées et les temps calculés. CSV et GPX servent aux outils tiers.
 */

import { GeneratedRoute, SavedPack } from '../types';

const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'parcours';

const download = (filename: string, content: string, mime: string) => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

/**
 * Ajoute au parcours une géométrie GeoJSON standard, en ordre
 * `[longitude, latitude]` — ce qu'attendent Mapbox, MapLibre, Google Maps et
 * la plupart des SDK mobiles. Les champs `path` et `pathFromPrev` restent en
 * `[latitude, longitude]`, la convention interne de l'application.
 */
const withGeoJson = (route: GeneratedRoute) => ({
  ...route,
  geojson: {
    type: 'Feature' as const,
    properties: {
      title: route.summary.title,
      city: route.summary.city,
      travelMode: route.summary.travelMode ?? 'walk',
      distanceKm: route.summary.totalDistanceKm,
      geometrySource: route.geometrySource,
    },
    geometry: {
      type: 'LineString' as const,
      coordinates: route.path.map(([lat, lng]) => [lng, lat]),
    },
  },
});

export const downloadRouteJson = (route: GeneratedRoute) =>
  download(
    `${slugify(route.summary.title)}.json`,
    JSON.stringify(withGeoJson(route), null, 2),
    'application/json'
  );

export const downloadPackJson = (pack: SavedPack) =>
  download(
    `pack-${slugify(pack.cityName)}.json`,
    JSON.stringify({ ...pack, routes: pack.routes.map(withGeoJson) }, null, 2),
    'application/json'
  );

export const downloadRouteCsv = (route: GeneratedRoute) => {
  const headers = [
    'Parcours',
    'Ville',
    'Theme parcours',
    'Etape',
    'Nom',
    'Type',
    'Theme lieu',
    'Adresse',
    'Latitude',
    'Longitude',
    'Distance depuis precedent (m)',
    'Duree visite (min)',
    'Description',
    'Anecdote',
  ];

  const rows = route.steps.map((step) =>
    [
      route.summary.title,
      route.summary.city,
      route.summary.theme,
      step.stepNumber,
      step.name,
      step.subtype,
      step.theme,
      step.address || '',
      step.lat,
      step.lng,
      step.distanceFromPrevM,
      step.visitMinutes,
      step.description || '',
      step.anecdote || '',
    ]
      .map(csvCell)
      .join(',')
  );

  // Le BOM évite les accents cassés à l'ouverture dans Excel.
  download(
    `${slugify(route.summary.title)}.csv`,
    `\uFEFF${[headers.map(csvCell).join(','), ...rows].join('\n')}`,
    'text/csv;charset=utf-8;'
  );
};

export const downloadRouteGpx = (route: GeneratedRoute) => {
  const waypoints = route.steps
    .map(
      (step) => `  <wpt lat="${step.lat}" lon="${step.lng}">
    <name>${escapeXml(`${step.stepNumber}. ${step.name}`)}</name>
    <desc>${escapeXml(step.description || step.subtype)}</desc>
  </wpt>`
    )
    .join('\n');

  // Le tracé complet (rues et chemins) plutôt que les seuls arrêts : c'est ce
  // qui rend le fichier exploitable dans un GPS ou une montre.
  const track = route.path
    .map(([lat, lng]) => `      <trkpt lat="${lat}" lon="${lng}"></trkpt>`)
    .join('\n');

  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="NirmieRoute" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeXml(route.summary.title)}</name></metadata>
${waypoints}
  <trk>
    <name>${escapeXml(route.summary.title)}</name>
    <trkseg>
${track}
    </trkseg>
  </trk>
</gpx>`;

  download(`${slugify(route.summary.title)}.gpx`, gpx, 'application/gpx+xml');
};
