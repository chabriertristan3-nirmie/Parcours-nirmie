import React from 'react';
import { ArrowLeft, ChevronRight, Clock, Download, Footprints, MapPin, Repeat } from 'lucide-react';
import { GeneratedRoute, THEME_COLORS, PoiTheme } from '../types';
import { formatDuration } from '../services/geo';

interface Props {
  routes: GeneratedRoute[];
  city: string;
  onSelect: (route: GeneratedRoute) => void;
  onBack: () => void;
  onExportAll: () => void;
}

export const RouteSelection: React.FC<Props> = ({
  routes,
  city,
  onSelect,
  onBack,
  onExportAll,
}) => {
  const totalStops = routes.reduce((sum, r) => sum + r.steps.length, 0);
  const uniqueStops = new Set(routes.flatMap((r) => r.steps.map((s) => s.id))).size;
  const totalKm = routes.reduce((sum, r) => sum + r.summary.totalDistanceKm, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm font-bold text-gray-500 hover:text-nirmie-600 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Modifier les réglages
        </button>
        <button
          onClick={onExportAll}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-gray-200 text-sm font-bold text-gray-600 hover:border-nirmie-400 hover:text-nirmie-700 transition-colors"
        >
          <Download className="w-4 h-4" /> Exporter le pack (JSON)
        </button>
      </div>

      <div className="bg-white rounded-3xl border border-nirmie-100 shadow-sm p-6">
        <p className="text-xs font-black text-nirmie-600 uppercase tracking-widest mb-1">
          Pack généré
        </p>
        <h2 className="text-3xl font-extrabold text-gray-900 mb-4">
          {routes.length} parcours à {city}
        </h2>
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm text-gray-500">
          <span>
            <strong className="text-gray-800">{uniqueStops}</strong> lieux distincts
          </span>
          <span>
            <strong className="text-gray-800">{totalStops}</strong> arrêts au total
          </span>
          <span>
            <strong className="text-gray-800">{totalKm.toFixed(1)} km</strong> cumulés
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {routes.map((route, index) => (
          <button
            key={route.id}
            onClick={() => onSelect(route)}
            className="text-left bg-white p-5 rounded-3xl border border-gray-100 hover:border-nirmie-300 hover:shadow-md transition-all group"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <span
                className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full text-white"
                style={{ background: THEME_COLORS[route.summary.theme as PoiTheme] || '#10b981' }}
              >
                {route.summary.theme}
              </span>
              <span className="text-[10px] font-black text-gray-300">
                #{String(index + 1).padStart(2, '0')}
              </span>
            </div>

            <h3 className="font-bold text-gray-800 leading-snug mb-2">{route.summary.title}</h3>

            {route.summary.intro && (
              <p className="text-xs text-gray-500 leading-relaxed mb-3">{route.summary.intro}</p>
            )}

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500 font-medium">
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3 text-nirmie-500" />
                {route.summary.stopsCount} arrêts
              </span>
              <span className="flex items-center gap-1">
                <Footprints className="w-3 h-3 text-nirmie-500" />
                {route.summary.totalDistanceKm} km
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-nirmie-500" />
                {formatDuration(route.summary.totalMinutes)}
              </span>
              {route.summary.loop && (
                <span className="flex items-center gap-1 text-nirmie-600">
                  <Repeat className="w-3 h-3" /> boucle
                </span>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-gray-50 flex items-center justify-between gap-2">
              <span className="text-[10px] text-gray-400 truncate">
                {route.steps.map((s) => s.name).join(' → ')}
              </span>
              <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-nirmie-500 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
