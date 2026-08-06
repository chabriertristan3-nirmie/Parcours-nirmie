import React from 'react';
import {
  ArrowLeft,
  Bike,
  Bookmark,
  BookmarkCheck,
  Clock,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Footprints,
  History,
  MapPin,
  Quote,
  Repeat,
} from 'lucide-react';
import { GeneratedRoute, PoiTheme, THEME_COLORS } from '../types';
import { formatDistance, formatDuration } from '../services/geo';
import { MapView } from './MapView';
import { downloadRouteCsv, downloadRouteGpx, downloadRouteJson } from '../services/exporters';

interface Props {
  route: GeneratedRoute;
  onBack: () => void;
  onSave: (route: GeneratedRoute) => void;
  isSaved: boolean;
}

export const ResultsView: React.FC<Props> = ({ route, onBack, onSave, isSaved }) => {
  const themeColor = THEME_COLORS[route.summary.theme as PoiTheme] || '#10b981';
  const isBike = route.summary.travelMode === 'bike';
  const ModeIcon = isBike ? Bike : Footprints;

  /**
   * Google Maps n'accepte que 10 points dans une URL de directions. Au-delà on
   * tronque plutôt que d'ouvrir un lien cassé. En mode vélo, Google privilégie
   * de lui-même les pistes cyclables.
   */
  const openGoogleMaps = () => {
    if (route.steps.length < 2) return;
    const coords = route.steps.map((s) => `${s.lat},${s.lng}`).slice(0, 10);
    const origin = coords[0];
    const destination = route.summary.loop ? coords[0] : coords[coords.length - 1];
    const middle = route.summary.loop ? coords.slice(1) : coords.slice(1, -1);
    const waypoints = middle.length > 0 ? `&waypoints=${middle.join('|')}` : '';
    window.open(
      `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypoints}&travelmode=${
        isBike ? 'bicycling' : 'walking'
      }`,
      '_blank'
    );
  };

  return (
    <div className="animate-fade-in space-y-8" id="printable-content">
      {/* En-tête ---------------------------------------------------------- */}
      <div
        className="relative text-white p-8 rounded-3xl shadow-lg overflow-hidden no-print"
        style={{ background: themeColor }}
      >
        <div className="absolute top-0 right-0 w-32 h-32 bg-white opacity-10 rounded-full -mr-10 -mt-10" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-black opacity-10 rounded-full -ml-10 -mb-10" />

        <div className="relative z-10 flex items-start justify-between gap-4">
          <button
            onClick={onBack}
            className="p-2 bg-white/20 rounded-full hover:bg-white/30 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => onSave(route)}
            disabled={isSaved}
            className={`px-4 py-2 rounded-full font-bold text-sm flex items-center gap-2 transition-all ${
              isSaved ? 'bg-white/90 text-gray-800 cursor-default' : 'bg-black/20 hover:bg-black/30'
            }`}
          >
            {isSaved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
            {isSaved ? 'Sauvegardé' : 'Sauvegarder'}
          </button>
        </div>

        <div className="relative z-10 text-center mt-4">
          <span className="inline-block px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-white/20 mb-3">
            {route.summary.theme}
          </span>
          <h2 className="text-3xl font-extrabold mb-3 leading-tight">{route.summary.title}</h2>
          {route.summary.intro && (
            <p className="text-sm text-white/90 max-w-xl mx-auto leading-relaxed">
              {route.summary.intro}
            </p>
          )}

          <div className="flex flex-wrap justify-center gap-6 mt-5 text-sm font-medium">
            <span className="flex items-center gap-2">
              <MapPin className="w-4 h-4" /> {route.summary.stopsCount} arrêts
            </span>
            <span className="flex items-center gap-2">
              <ModeIcon className="w-4 h-4" /> {route.summary.totalDistanceKm} km
            </span>
            <span className="flex items-center gap-2">
              <Clock className="w-4 h-4" /> {formatDuration(route.summary.totalMinutes)}
            </span>
            {route.summary.loop && (
              <span className="flex items-center gap-2">
                <Repeat className="w-4 h-4" /> Boucle
              </span>
            )}
          </div>
          <p className="text-[11px] text-white/70 mt-2">
            {formatDuration(route.summary.walkingMinutes)} de {isBike ? 'vélo' : 'marche'} +{' '}
            {formatDuration(route.summary.visitMinutes)} de visite
          </p>
        </div>
      </div>

      {/* En-tête simplifié, pour l'impression */}
      <div className="hidden print:block">
        <h1 className="text-2xl font-bold">{route.summary.title}</h1>
        <p className="text-sm">
          {route.summary.city} • {route.summary.stopsCount} arrêts •{' '}
          {route.summary.totalDistanceKm} km • {formatDuration(route.summary.totalMinutes)}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Étapes --------------------------------------------------------- */}
        <div className="lg:col-span-2 space-y-6">
          <h3 className="text-xl font-bold text-gray-800 px-2 no-print">Parcours détaillé</h3>

          <div className="relative before:absolute before:inset-0 before:ml-8 before:w-0.5 before:-translate-x-px before:bg-gray-200 before:h-full before:z-0">
            {route.steps.map((step) => (
              <div key={step.id} className="relative flex gap-6 z-10 step-item">
                <div className="flex flex-col items-center">
                  <div
                    className="w-16 h-16 rounded-full border-4 border-white shadow-md flex items-center justify-center font-black text-xl text-white z-10 flex-shrink-0"
                    style={{ background: THEME_COLORS[step.theme] }}
                  >
                    {step.stepNumber}
                  </div>
                </div>

                <div className="flex-1 bg-white p-6 rounded-2xl shadow-sm border border-gray-100 mb-8 print:shadow-none print:mb-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="text-lg font-bold text-gray-800">{step.name}</h4>
                      <p className="text-sm text-gray-500 font-medium">
                        {step.subtype}
                        {step.address ? ` • ${step.address}` : ''}
                      </p>
                    </div>
                    <span className="text-[10px] font-black text-gray-400 whitespace-nowrap bg-gray-50 px-2 py-1 rounded-lg">
                      {step.visitMinutes} min
                    </span>
                  </div>

                  {step.distanceFromPrevM > 0 && (
                    <p className="text-[11px] text-nirmie-600 font-bold mt-2 flex items-center gap-1.5">
                      <Footprints className="w-3 h-3" />
                      {formatDistance(step.distanceFromPrevM)} depuis l'étape précédente
                    </p>
                  )}

                  {step.description && (
                    <p className="text-gray-600 text-sm leading-relaxed mt-4">{step.description}</p>
                  )}

                  {step.anecdote && (
                    <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 mt-4 relative overflow-hidden">
                      <div className="flex items-center gap-2 mb-2">
                        <History className="w-4 h-4 text-amber-600" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">
                          Histoire & Anecdote
                        </span>
                      </div>
                      <p className="text-xs text-amber-900 leading-relaxed font-medium italic relative z-10">
                        {step.anecdote}
                      </p>
                      <Quote className="absolute -bottom-2 -right-2 w-12 h-12 text-amber-100 -rotate-12" />
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-3 no-print">
                    <span className="text-[10px] text-gray-400 font-mono bg-gray-50 px-2 py-1 rounded-lg border border-gray-100">
                      {step.lat.toFixed(5)}, {step.lng.toFixed(5)}
                    </span>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${step.lat},${step.lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] font-bold text-nirmie-600 hover:underline flex items-center gap-1"
                    >
                      Voir sur la carte <ExternalLink className="w-3 h-3" />
                    </a>
                    {step.website && (
                      <a
                        href={step.website}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] font-bold text-gray-500 hover:underline flex items-center gap-1"
                      >
                        Site officiel <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Carte + exports ------------------------------------------------ */}
        <div className="space-y-6">
          <div
            className="bg-white p-2 rounded-3xl shadow-sm border border-gray-100 sticky top-24"
            id="map-container"
          >
            <MapView
              pois={route.steps}
              drawPath
              loop={route.summary.loop}
              className="w-full h-80"
            />

            <div className="p-4 space-y-3 no-print">
              <button
                onClick={openGoogleMaps}
                className="w-full py-3.5 bg-white border-2 border-nirmie-500 text-nirmie-600 font-bold rounded-xl hover:bg-nirmie-50 transition-colors flex items-center justify-center gap-2 text-sm"
              >
                <ExternalLink className="w-4 h-4" />
                Naviguer avec Google Maps
              </button>
              {route.steps.length > 10 && (
                <p className="text-[10px] text-gray-400 text-center leading-relaxed">
                  Google Maps se limite à 10 points : le lien couvre les 10 premières étapes.
                </p>
              )}

              <div className="h-px bg-gray-100" />

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => window.print()}
                  className="flex items-center justify-center gap-1.5 py-2.5 bg-red-50 text-red-600 font-bold rounded-xl hover:bg-red-100 transition-colors text-xs"
                >
                  <Download className="w-3.5 h-3.5" /> PDF
                </button>
                <button
                  onClick={() => downloadRouteCsv(route)}
                  className="flex items-center justify-center gap-1.5 py-2.5 bg-green-50 text-green-700 font-bold rounded-xl hover:bg-green-100 transition-colors text-xs"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" /> CSV
                </button>
                <button
                  onClick={() => downloadRouteGpx(route)}
                  className="flex items-center justify-center gap-1.5 py-2.5 bg-blue-50 text-blue-700 font-bold rounded-xl hover:bg-blue-100 transition-colors text-xs"
                >
                  <MapPin className="w-3.5 h-3.5" /> GPX
                </button>
                <button
                  onClick={() => downloadRouteJson(route)}
                  className="flex items-center justify-center gap-1.5 py-2.5 bg-gray-50 text-gray-600 font-bold rounded-xl hover:bg-gray-100 transition-colors text-xs"
                >
                  <Download className="w-3.5 h-3.5" /> JSON
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
