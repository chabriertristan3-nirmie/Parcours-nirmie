import React from 'react';
import {
  ArrowLeft,
  Footprints,
  Gauge,
  Infinity as InfinityIcon,
  Layers,
  ListOrdered,
  Repeat,
  Ruler,
  Shuffle,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { Capacity, POI, RouteConfig } from '../types';
import { formatDuration } from '../services/geo';

interface Props {
  pool: POI[];
  config: RouteConfig;
  capacity: Capacity;
  onChange: (updates: Partial<RouteConfig>) => void;
  onBack: () => void;
  onGenerate: () => void;
  aiAvailable: boolean;
}

const Section: React.FC<{
  icon: React.ReactNode;
  title: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ icon, title, hint, children }) => (
  <div className="space-y-3">
    <div>
      <h3 className="flex items-center gap-2 text-sm font-black text-gray-700 uppercase tracking-wide">
        {icon}
        {title}
      </h3>
      {hint && <p className="text-[11px] text-gray-400 mt-1 ml-6">{hint}</p>}
    </div>
    {children}
  </div>
);

const Toggle: React.FC<{
  active: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  disabled?: boolean;
}> = ({ active, onToggle, icon, title, subtitle, disabled }) => (
  <button
    onClick={onToggle}
    disabled={disabled}
    className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all text-left disabled:opacity-40 disabled:cursor-not-allowed ${
      active ? 'border-nirmie-500 bg-nirmie-50' : 'border-gray-100 hover:border-gray-200'
    }`}
  >
    <div className="flex items-center gap-3">
      <div
        className={`p-2 rounded-lg ${active ? 'bg-nirmie-500 text-white' : 'bg-gray-100 text-gray-400'}`}
      >
        {icon}
      </div>
      <div>
        <p className="font-bold text-gray-800 text-sm">{title}</p>
        <p className="text-[10px] text-gray-500">{subtitle}</p>
      </div>
    </div>
    <div
      className={`w-10 h-5 rounded-full relative transition-colors flex-shrink-0 ${
        active ? 'bg-nirmie-500' : 'bg-gray-300'
      }`}
    >
      <div
        className={`absolute top-0.5 bg-white w-4 h-4 rounded-full transition-all ${
          active ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </div>
  </button>
);

export const RouteConfigPanel: React.FC<Props> = ({
  pool,
  config,
  capacity,
  onChange,
  onBack,
  onGenerate,
  aiAvailable,
}) => {
  const routeCount = config.routeCount ?? capacity.maxRoutes;
  const impossible = capacity.maxRoutes === 0;

  // Estimation moyenne, à titre indicatif — les vraies valeurs sont calculées
  // parcours par parcours à la génération.
  const avgVisit =
    pool.reduce((sum, p) => sum + p.visitMinutes, 0) / Math.max(1, pool.length);
  const estimatedMinutes =
    config.stopsTarget * avgVisit +
    ((config.maxDistanceKm ?? 4) * 0.75 / config.paceKmh) * 60;

  /** Garde les trois bornes d'arrêts cohérentes entre elles. */
  const setStops = (key: 'stopsMin' | 'stopsTarget' | 'stopsMax', value: number) => {
    const next = { ...config, [key]: value };
    if (next.stopsMin > next.stopsTarget) {
      if (key === 'stopsMin') next.stopsTarget = next.stopsMin;
      else next.stopsMin = next.stopsTarget;
    }
    if (next.stopsTarget > next.stopsMax) {
      if (key === 'stopsMax') next.stopsTarget = next.stopsMax;
      else next.stopsMax = next.stopsTarget;
    }
    onChange({
      stopsMin: next.stopsMin,
      stopsTarget: next.stopsTarget,
      stopsMax: next.stopsMax,
      // Le nombre de parcours dépend des arrêts : on repasse en automatique.
      routeCount: null,
    });
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm font-bold text-gray-500 hover:text-nirmie-600 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Revenir à l'inventaire
      </button>

      {/* Capacité ---------------------------------------------------------- */}
      <div className="bg-gradient-to-br from-nirmie-500 to-nirmie-600 text-white rounded-3xl p-6 shadow-lg">
        <p className="text-[11px] font-black uppercase tracking-widest text-nirmie-100 mb-4">
          Capacité de la ville
        </p>
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
          <div>
            <p className="text-6xl font-black leading-none">
              <span className="text-2xl align-top mr-1 font-bold text-nirmie-100">jusqu'à</span>
              {capacity.maxRoutes}
            </p>
            <p className="text-xs font-bold text-nirmie-100 mt-2">
              parcours avec les {capacity.poolSize} lieux retenus
            </p>
          </div>
          <div className="space-y-1 text-sm">
            <p className="text-nirmie-50">
              <strong>{capacity.recommendedRoutes}</strong> parcours à {config.stopsTarget} arrêts
              (confortable)
            </p>
            <p className="text-nirmie-100/80 text-xs">
              soit ~{formatDuration(estimatedMinutes)} et jusqu'à{' '}
              {config.maxDistanceKm ? `${config.maxDistanceKm} km` : 'distance libre'} par parcours
            </p>
          </div>
        </div>

        <p className="text-[11px] text-nirmie-100/70 mt-4 leading-relaxed max-w-xl">
          Plafond théorique. Le résultat peut être légèrement inférieur : les lieux trop
          isolés pour rejoindre un groupe dans le budget de marche sont laissés de côté.
        </p>

        {impossible && (
          <p className="mt-4 bg-white/15 rounded-xl p-3 text-sm">
            Pas assez de lieux retenus pour former un parcours d'au moins {config.stopsMin} arrêts.
            Baissez le minimum d'arrêts, ou retenez plus de lieux dans l'inventaire.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Colonne gauche : taille des parcours --------------------------- */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-7">
          <Section
            icon={<ListOrdered className="w-4 h-4 text-nirmie-500" />}
            title="Arrêts par parcours"
            hint="Le minimum décide de la capacité maximale, la cible du confort de visite."
          >
            <div className="space-y-4">
              {(
                [
                  ['stopsMin', 'Minimum', 2, 12],
                  ['stopsTarget', 'Cible', 2, 15],
                  ['stopsMax', 'Maximum', 3, 20],
                ] as const
              ).map(([key, label, min, max]) => (
                <div key={key} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-500">{label}</span>
                    <span className="text-sm font-black text-nirmie-600">{config[key]}</span>
                  </div>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    value={config[key]}
                    onChange={(e) => setStops(key, Number(e.target.value))}
                    className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-nirmie-500"
                  />
                </div>
              ))}
            </div>
          </Section>

          <div className="h-px bg-gray-100" />

          <Section
            icon={<Ruler className="w-4 h-4 text-nirmie-500" />}
            title="Longueur de marche"
            hint="Budget de marche par parcours, hors temps de visite."
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-500">Distance maximale</span>
                <span className="text-sm font-black text-nirmie-600">
                  {config.maxDistanceKm === null ? 'Libre' : `${config.maxDistanceKm} km`}
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="15"
                step="0.5"
                disabled={config.maxDistanceKm === null}
                value={config.maxDistanceKm ?? 4}
                onChange={(e) => onChange({ maxDistanceKm: Number(e.target.value) })}
                className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-nirmie-500 disabled:opacity-40"
              />
              <button
                onClick={() =>
                  onChange({ maxDistanceKm: config.maxDistanceKm === null ? 4 : null })
                }
                className={`w-full py-2 rounded-xl text-xs font-bold border-2 transition-colors flex items-center justify-center gap-2 ${
                  config.maxDistanceKm === null
                    ? 'border-nirmie-500 bg-nirmie-50 text-nirmie-700'
                    : 'border-gray-100 text-gray-400 hover:border-gray-200'
                }`}
              >
                <InfinityIcon className="w-3.5 h-3.5" />
                Sans limite de distance
              </button>
            </div>
          </Section>

          <div className="h-px bg-gray-100" />

          <Section
            icon={<Gauge className="w-4 h-4 text-nirmie-500" />}
            title="Rythme de marche"
            hint="Sert au calcul des durées affichées."
          >
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 3.4, label: 'Flânerie' },
                { value: 4.2, label: 'Normal' },
                { value: 5, label: 'Soutenu' },
              ].map((pace) => (
                <button
                  key={pace.value}
                  onClick={() => onChange({ paceKmh: pace.value })}
                  className={`py-2.5 rounded-xl border-2 text-xs font-bold transition-all ${
                    config.paceKmh === pace.value
                      ? 'border-nirmie-500 bg-nirmie-50 text-nirmie-700'
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
          </Section>
        </div>

        {/* Colonne droite : composition ----------------------------------- */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-7">
          <Section
            icon={<Layers className="w-4 h-4 text-nirmie-500" />}
            title="Composition"
            hint="Mélanger les thèmes, ou dédier chaque parcours à un thème."
          >
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['mixed', 'Thèmes mélangés', <Shuffle key="s" className="w-4 h-4" />],
                  ['thematic', 'Un thème par parcours', <Layers key="l" className="w-4 h-4" />],
                ] as const
              ).map(([mode, label, icon]) => (
                <button
                  key={mode}
                  onClick={() => onChange({ themeMode: mode, routeCount: null })}
                  className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-2 ${
                    config.themeMode === mode
                      ? 'border-nirmie-500 bg-nirmie-50 text-nirmie-700'
                      : 'border-gray-100 text-gray-400 hover:border-gray-200'
                  }`}
                >
                  {icon}
                  <span className="text-[11px] font-bold text-center leading-tight">{label}</span>
                </button>
              ))}
            </div>
          </Section>

          <div className="space-y-3">
            <Toggle
              active={config.loop}
              onToggle={() => onChange({ loop: !config.loop })}
              icon={<Repeat className="w-4 h-4" />}
              title="Parcours en boucle"
              subtitle="Retour au point de départ"
            />
            <Toggle
              active={config.reusePois}
              onToggle={() => onChange({ reusePois: !config.reusePois, routeCount: null })}
              icon={<Footprints className="w-4 h-4" />}
              title="Réutiliser les lieux"
              subtitle="Un lieu peut servir dans 2 parcours — double la capacité"
            />
            <Toggle
              active={config.enrichWithAI && aiAvailable}
              onToggle={() => onChange({ enrichWithAI: !config.enrichWithAI })}
              disabled={!aiAvailable}
              icon={<Sparkles className="w-4 h-4" />}
              title="Rédiger les textes avec l'IA"
              subtitle={
                aiAvailable
                  ? 'Titres, descriptions et anecdotes par étape'
                  : 'Indisponible : clé GEMINI_API_KEY absente'
              }
            />
          </div>

          <div className="h-px bg-gray-100" />

          <Section
            icon={<Wand2 className="w-4 h-4 text-nirmie-500" />}
            title="Combien de parcours ?"
            hint="Par défaut, tout ce que la ville permet."
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-500">
                  {config.routeCount === null ? 'Automatique (maximum)' : 'Nombre choisi'}
                </span>
                <span className="text-2xl font-black text-nirmie-600 leading-none">
                  {routeCount}
                </span>
              </div>
              <input
                type="range"
                min="1"
                max={Math.max(1, capacity.maxRoutes)}
                value={routeCount}
                disabled={impossible}
                onChange={(e) => onChange({ routeCount: Number(e.target.value) })}
                className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-nirmie-500 disabled:opacity-40"
              />
              <button
                onClick={() => onChange({ routeCount: null })}
                className={`w-full py-2 rounded-xl text-xs font-bold border-2 transition-colors ${
                  config.routeCount === null
                    ? 'border-nirmie-500 bg-nirmie-50 text-nirmie-700'
                    : 'border-gray-100 text-gray-400 hover:border-gray-200'
                }`}
              >
                Laisser la ville décider
              </button>
            </div>
          </Section>
        </div>
      </div>

      <button
        onClick={onGenerate}
        disabled={impossible}
        className="w-full py-5 rounded-2xl bg-nirmie-500 text-white text-lg font-bold shadow-lg hover:bg-nirmie-600 active:scale-[0.99] transition-all flex items-center justify-center gap-3 disabled:bg-gray-300 disabled:shadow-none disabled:cursor-not-allowed"
      >
        <Wand2 className="w-6 h-6" />
        {config.routeCount === null
          ? `Générer jusqu'à ${routeCount} parcours`
          : `Générer ${routeCount} parcours`}
      </button>
    </div>
  );
};
