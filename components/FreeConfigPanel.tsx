import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bike,
  Crosshair,
  Footprints,
  Gauge,
  Layers,
  Loader2,
  MapPin,
  Repeat,
  Ruler,
  Search,
  Wand2,
} from 'lucide-react';
import {
  AMBIENCE_LABELS,
  Ambience,
  CityScan,
  MODE_PRESETS,
  RouteConfig,
  StartPoint,
  TravelMode,
} from '../types';
import { formatDuration } from '../services/geo';
import { anchorsFor } from '../services/loopPlanner';
import { geocodeCity } from '../services/osmService';
import { MapView } from './MapView';

interface Props {
  scan: CityScan;
  config: RouteConfig;
  onChange: (updates: Partial<RouteConfig>) => void;
  onBack: () => void;
  onGenerate: () => void;
}

export const FreeConfigPanel: React.FC<Props> = ({
  scan,
  config,
  onChange,
  onBack,
  onGenerate,
}) => {
  const [addressQuery, setAddressQuery] = useState('');
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);

  const preset = MODE_PRESETS[config.travelMode];
  const anchors = useMemo(
    () => anchorsFor(scan, config.ambience),
    [scan, config.ambience]
  );

  const start: StartPoint = config.start ?? {
    lat: scan.city.lat,
    lng: scan.city.lng,
    label: `Centre de ${scan.city.name}`,
  };

  const effortMinutes = (config.targetDistanceKm / config.paceKmh) * 60;
  const loopCount = config.routeCount ?? 3;

  const switchMode = (mode: TravelMode) => {
    if (mode === config.travelMode) return;
    const next = MODE_PRESETS[mode];
    onChange({
      travelMode: mode,
      paceKmh: next.defaultPaceKmh,
      targetDistanceKm: next.defaultDistanceKm,
    });
  };

  const useMyPosition = () => {
    setAddressError(null);
    if (!navigator.geolocation) {
      setAddressError("Votre navigateur ne donne pas accès à la géolocalisation.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        onChange({
          start: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            label: 'Ma position',
          },
        }),
      () => setAddressError("Position refusée ou indisponible.")
    );
  };

  const searchAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = addressQuery.trim();
    if (!query) return;

    setAddressLoading(true);
    setAddressError(null);
    try {
      // On ancre la recherche sur la ville pour éviter les homonymes.
      const place = await geocodeCity(`${query}, ${scan.city.name}`);
      onChange({ start: { lat: place.lat, lng: place.lng, label: place.name || query } });
      setAddressQuery('');
    } catch {
      setAddressError("Adresse introuvable dans cette ville.");
    } finally {
      setAddressLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm font-bold text-gray-500 hover:text-blue-600 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Changer de ville
      </button>

      {/* Résumé ------------------------------------------------------------ */}
      <div className="bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-3xl p-6 shadow-lg">
        <p className="text-[11px] font-black uppercase tracking-widest text-blue-100 mb-4">
          Parcours libre à {scan.city.name}
        </p>
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
          <div>
            <p className="text-6xl font-black leading-none">
              {config.targetDistanceKm}
              <span className="text-2xl ml-1 font-bold text-blue-100">km</span>
            </p>
            <p className="text-xs font-bold text-blue-100 mt-2">
              {loopCount} boucle{loopCount > 1 ? 's' : ''} à générer
            </p>
          </div>
          <div className="space-y-1 text-sm">
            <p className="text-blue-50">
              ~<strong>{formatDuration(effortMinutes)}</strong> de{' '}
              {config.travelMode === 'bike' ? 'vélo' : 'marche'}, sans arrêt
            </p>
            <p className="text-blue-100/80 text-xs">
              Départ : {start.label}
            </p>
          </div>
        </div>
        <p className="text-[11px] text-blue-100/70 mt-4 leading-relaxed max-w-xl">
          La distance obtenue peut s'écarter de quelques centaines de mètres : le
          circuit suit les rues existantes, pas un cercle parfait.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Colonne gauche ------------------------------------------------- */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-7">
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ['walk', 'À pied', <Footprints key="w" className="w-5 h-5" />],
                ['bike', 'À vélo', <Bike key="b" className="w-5 h-5" />],
              ] as const
            ).map(([mode, label, icon]) => (
              <button
                key={mode}
                onClick={() => switchMode(mode)}
                className={`p-4 rounded-2xl border-2 font-bold transition-all flex items-center justify-center gap-3 ${
                  config.travelMode === mode
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-100 text-gray-400 hover:border-gray-200'
                }`}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-black text-gray-700 uppercase tracking-wide">
                <Ruler className="w-4 h-4 text-blue-500" />
                Longueur de la boucle
              </h3>
              <p className="text-[11px] text-gray-400 mt-1 ml-6">
                La cible visée. C'est le réglage principal de ce mode.
              </p>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-500">Distance</span>
              <span className="text-lg font-black text-blue-600">
                {config.targetDistanceKm} km
              </span>
            </div>
            <input
              type="range"
              min={preset.distanceMinKm}
              max={preset.distanceMaxKm}
              step="0.5"
              value={config.targetDistanceKm}
              onChange={(e) => onChange({ targetDistanceKm: Number(e.target.value) })}
              className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <div className="flex justify-between text-[10px] text-gray-400 font-medium">
              <span>{preset.distanceMinKm} km</span>
              <span>{preset.distanceMaxKm} km</span>
            </div>
          </div>

          <div className="h-px bg-gray-100" />

          <div className="space-y-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-black text-gray-700 uppercase tracking-wide">
                <Gauge className="w-4 h-4 text-blue-500" />
                Rythme
              </h3>
              <p className="text-[11px] text-gray-400 mt-1 ml-6">
                Sert au calcul de la durée d'effort.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {preset.paces.map((pace) => (
                <button
                  key={pace.value}
                  onClick={() => onChange({ paceKmh: pace.value })}
                  className={`py-2.5 rounded-xl border-2 text-xs font-bold transition-all ${
                    config.paceKmh === pace.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-100 text-gray-400 hover:border-gray-200'
                  }`}
                >
                  {pace.label}
                  <span className="block text-[9px] font-medium opacity-70">
                    {pace.value} km/h
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="h-px bg-gray-100" />

          <div className="space-y-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-black text-gray-700 uppercase tracking-wide">
                <Repeat className="w-4 h-4 text-blue-500" />
                Nombre de boucles
              </h3>
              <p className="text-[11px] text-gray-400 mt-1 ml-6">
                Chacune part dans une direction différente.
              </p>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-500">À générer</span>
              <span className="text-lg font-black text-blue-600">{loopCount}</span>
            </div>
            <input
              type="range"
              min="1"
              max="8"
              value={loopCount}
              onChange={(e) => onChange({ routeCount: Number(e.target.value) })}
              className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
          </div>
        </div>

        {/* Colonne droite ------------------------------------------------- */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-7">
          <div className="space-y-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-black text-gray-700 uppercase tracking-wide">
                <MapPin className="w-4 h-4 text-blue-500" />
                Point de départ
              </h3>
              <p className="text-[11px] text-gray-400 mt-1 ml-6">
                La boucle part d'ici et y revient.
              </p>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-blue-900 truncate">{start.label}</p>
                <p className="text-[10px] text-blue-600 font-mono">
                  {start.lat.toFixed(5)}, {start.lng.toFixed(5)}
                </p>
              </div>
              {config.start && (
                <button
                  onClick={() => onChange({ start: null })}
                  className="text-[10px] font-bold text-blue-600 hover:underline flex-shrink-0"
                >
                  Centre-ville
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2">
              <button
                onClick={useMyPosition}
                className="py-2.5 rounded-xl border-2 border-gray-100 text-xs font-bold text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-colors flex items-center justify-center gap-2"
              >
                <Crosshair className="w-3.5 h-3.5" /> Utiliser ma position
              </button>

              <form onSubmit={searchAddress} className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={addressQuery}
                  onChange={(e) => setAddressQuery(e.target.value)}
                  placeholder="Une adresse, un quartier…"
                  className="w-full pl-10 pr-20 py-2.5 rounded-xl bg-gray-50 border border-gray-200 focus:border-blue-500 outline-none text-sm"
                />
                <button
                  type="submit"
                  disabled={addressLoading || !addressQuery.trim()}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[11px] font-bold disabled:opacity-40"
                >
                  {addressLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Situer'}
                </button>
              </form>
            </div>

            {addressError && <p className="text-[11px] text-red-600">{addressError}</p>}
          </div>

          <div className="h-px bg-gray-100" />

          <div className="space-y-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-black text-gray-700 uppercase tracking-wide">
                <Layers className="w-4 h-4 text-blue-500" />
                Ambiance
              </h3>
              <p className="text-[11px] text-gray-400 mt-1 ml-6">
                Vers quoi attirer la boucle. Ces lieux sont traversés, pas visités.
              </p>
            </div>

            <div className="space-y-2">
              {(Object.keys(AMBIENCE_LABELS) as Ambience[]).map((ambience) => (
                <button
                  key={ambience}
                  onClick={() => onChange({ ambience })}
                  className={`w-full p-3 rounded-2xl border-2 text-left transition-all ${
                    config.ambience === ambience
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-100 hover:border-gray-200'
                  }`}
                >
                  <p className="text-sm font-bold text-gray-800">
                    {AMBIENCE_LABELS[ambience].label}
                  </p>
                  <p className="text-[10px] text-gray-500">{AMBIENCE_LABELS[ambience].hint}</p>
                </button>
              ))}
            </div>

            <p className="text-[11px] text-gray-400">
              {anchors.length} lieu{anchors.length > 1 ? 'x' : ''} peu{anchors.length > 1 ? 'vent' : 't'}{' '}
              orienter la boucle avec ce choix.
            </p>
          </div>

          <div className="rounded-2xl overflow-hidden border border-gray-100">
            <MapView
              pois={[
                {
                  id: 'start',
                  name: start.label,
                  theme: 'Places & Vie locale',
                  subtype: 'Départ',
                  lat: start.lat,
                  lng: start.lng,
                  notoriety: 100,
                  visitMinutes: 0,
                  source: 'manual',
                },
                ...anchors.slice(0, 60),
              ]}
              className="w-full h-56"
            />
          </div>
        </div>
      </div>

      <button
        onClick={onGenerate}
        className="w-full py-5 rounded-2xl bg-blue-600 text-white text-lg font-bold shadow-lg hover:bg-blue-700 active:scale-[0.99] transition-all flex items-center justify-center gap-3"
      >
        <Wand2 className="w-6 h-6" />
        Générer {loopCount} boucle{loopCount > 1 ? 's' : ''} de {config.targetDistanceKm} km
      </button>
    </div>
  );
};
