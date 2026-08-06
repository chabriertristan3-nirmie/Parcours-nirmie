import React, { useState } from 'react';
import {
  ArrowLeft,
  Bike,
  Footprints,
  Gauge,
  Infinity as InfinityIcon,
  Layers,
  ListOrdered,
  Loader2,
  Repeat,
  Ruler,
  Shuffle,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import {
  AiRecommendation,
  Capacity,
  CityScan,
  MODE_PRESETS,
  POI,
  RouteConfig,
  TravelMode,
} from '../types';
import { formatDuration } from '../services/geo';

interface Props {
  scan: CityScan;
  pool: POI[];
  config: RouteConfig;
  capacity: Capacity;
  onChange: (updates: Partial<RouteConfig>) => void;
  onBack: () => void;
  onGenerate: () => void;
  aiAvailable: boolean;
  onRecommend: () => Promise<AiRecommendation | null>;
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
  scan,
  pool,
  config,
  capacity,
  onChange,
  onBack,
  onGenerate,
  aiAvailable,
  onRecommend,
}) => {
  const [recommendation, setRecommendation] = useState<AiRecommendation | null>(null);
  const [recommendLoading, setRecommendLoading] = useState(false);

  const preset = MODE_PRESETS[config.travelMode];
  const routeCount = config.routeCount ?? capacity.maxRoutes;
  const impossible = capacity.maxRoutes === 0;

  // Estimation moyenne, à titre indicatif — les vraies valeurs sont calculées
  // parcours par parcours à la génération. L'effort (marche ou vélo) est la
  // donnée principale ; les visites s'affichent à part.
  const avgVisit =
    pool.reduce((sum, p) => sum + p.visitMinutes, 0) / Math.max(1, pool.length);
  const estimatedEffortMinutes =
    (((config.maxDistanceKm ?? preset.defaultDistanceKm) * 0.75) / config.paceKmh) * 60;
  const estimatedVisitMinutes = config.stopsTarget * avgVisit;

  const switchMode = (mode: TravelMode) => {
    if (mode === config.travelMode) return;
    const next = MODE_PRESETS[mode];
    setRecommendation(null);
    onChange({
      travelMode: mode,
      maxDistanceKm: next.defaultDistanceKm,
      paceKmh: next.defaultPaceKmh,
      routeCount: null,
    });
  };

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

  const askRecommendation = async () => {
    setRecommendLoading(true);
    try {
      const result = await onRecommend();
      if (result) setRecommendation(result);
    } finally {
      setRecommendLoading(false);
    }
  };

  const applyRecommendation = () => {
    if (!recommendation) return;
    onChange({
      routeCount: recommendation.routeCount,
      stopsMin: recommendation.stopsMin,
      stopsTarget: recommendation.stopsTarget,
      stopsMax: recommendation.stopsMax,
      maxDistanceKm: recommendation.maxDistanceKm,
      themeMode: recommendation.themeMode,
      loop: recommendation.loop,
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

      {/* Mode de déplacement ---------------------------------------------- */}
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
                ? 'border-nirmie-500 bg-nirmie-50 text-nirmie-700 shadow-sm'
                : 'border-gray-100 bg-white text-gray-400 hover:border-gray-200'
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {config.travelMode === 'bike' && (
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 space-y-2 animate-fade-in">
          <p className="text-xs font-black text-blue-700 uppercase tracking-widest">
            Itinéraires cyclables balisés à {scan.city.name}
          </p>
          {scan.cycleRoutes.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {scan.cycleRoutes.map((route) => (
                <span
                  key={route.id}
                  className="px-3 py-1.5 rounded-lg bg-white border border-blue-200 text-[11px] font-bold text-blue-800"
                  title={route.network === 'ncn' ? 'Itinéraire national' : route.network === 'rcn' ? 'Itinéraire régional' : 'Itinéraire local'}
                >
                  {route.ref ? `${route.ref} · ` : ''}
                  {route.name}
                  {route.distanceKm ? ` (${route.distanceKm} km)` : ''}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-blue-800">
              Aucun itinéraire balisé relevé sur la commune.
            </p>
          )}
          <p className="text-[10px] text-blue-600/80 leading-relaxed">
            Les parcours relient les lieux à vol d'oiseau corrigé : vérifiez le tracé
            réel sur Google Maps (mode vélo) avant publication, il privilégiera les
            pistes cyclables.
          </p>
        </div>
      )}

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
              soit ~{formatDuration(estimatedEffortMinutes)} de{' '}
              {config.travelMode === 'bike' ? 'vélo' : 'marche'} (+ ~
              {formatDuration(estimatedVisitMinutes)} de visites) et jusqu'à{' '}
              {config.maxDistanceKm ? `${config.maxDistanceKm} km` : 'distance libre'} par parcours
            </p>
          </div>
        </div>

        <p className="text-[11px] text-nirmie-100/70 mt-4 leading-relaxed max-w-xl">
          Plafond théorique. Le résultat peut être légèrement inférieur : les lieux trop
          isolés pour rejoindre un groupe dans le budget de{' '}
          {config.travelMode === 'bike' ? 'trajet' : 'marche'} sont laissés de côté.
        </p>
      </div>

      {/* Préconisation IA -------------------------------------------------- */}
      <div className="bg-white rounded-3xl border-2 border-dashed border-purple-200 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-black text-purple-700 uppercase tracking-wide">
              <Sparkles className="w-4 h-4" />
              Préconisation IA
            </h3>
            <p className="text-[11px] text-gray-400 mt-1">
              L'IA analyse l'inventaire et propose un plan : nombre de parcours, tailles,
              composition. Vous restez libre de tout modifier ensuite.
            </p>
          </div>
          <button
            onClick={askRecommendation}
            disabled={recommendLoading || !aiAvailable || impossible}
            title={aiAvailable ? undefined : 'Clé Gemini absente'}
            className="px-5 py-2.5 rounded-xl bg-purple-600 text-white text-sm font-bold hover:bg-purple-700 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {recommendLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {recommendLoading ? 'Analyse…' : 'Demander une préconisation'}
          </button>
        </div>

        {recommendation && (
          <div className="bg-purple-50 rounded-2xl p-4 space-y-3 animate-fade-in relative">
            <button
              onClick={() => setRecommendation(null)}
              className="absolute top-3 right-3 p-1 text-purple-300 hover:text-purple-600 rounded"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex flex-wrap gap-2 pr-8">
              {[
                `${recommendation.routeCount} parcours`,
                `${recommendation.stopsMin}–${recommendation.stopsMax} arrêts (cible ${recommendation.stopsTarget})`,
                `${recommendation.maxDistanceKm} km max`,
                recommendation.themeMode === 'thematic' ? 'un thème par parcours' : 'thèmes mélangés',
                recommendation.loop ? 'en boucle' : 'en ligne',
              ].map((chip) => (
                <span
                  key={chip}
                  className="px-3 py-1 rounded-full bg-white border border-purple-200 text-[11px] font-bold text-purple-800"
                >
                  {chip}
                </span>
              ))}
            </div>
            <p className="text-xs text-purple-900 leading-relaxed">{recommendation.rationale}</p>
            <button
              onClick={applyRecommendation}
              className="w-full py-2.5 rounded-xl bg-purple-600 text-white text-sm font-bold hover:bg-purple-700 transition-colors"
            >
              Appliquer ces réglages
            </button>
          </div>
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
            <div className="space-y-5">
              {(
                [
                  [
                    'stopsMin',
                    'Minimum',
                    2,
                    12,
                    "En dessous de ce nombre d'arrêts, un parcours n'est pas créé. C'est ce chiffre qui fixe le nombre maximal de parcours : plus il est bas, plus la ville en produit.",
                  ],
                  [
                    'stopsTarget',
                    'Cible',
                    2,
                    15,
                    "La taille idéale d'un parcours. Le générateur vise ce nombre d'arrêts quand le quartier est assez fourni — c'est ce qui rend les parcours réguliers entre eux.",
                  ],
                  [
                    'stopsMax',
                    'Maximum',
                    3,
                    20,
                    "Plafond absolu : un parcours ne dépasse jamais ce nombre d'arrêts, même si d'autres lieux restent à proximité.",
                  ],
                ] as const
              ).map(([key, label, min, max, help]) => (
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
                  <p className="text-[10px] text-gray-400 leading-relaxed">{help}</p>
                </div>
              ))}
            </div>
          </Section>

          <div className="h-px bg-gray-100" />

          <Section
            icon={<Ruler className="w-4 h-4 text-nirmie-500" />}
            title={config.travelMode === 'bike' ? 'Longueur du circuit' : 'Longueur de marche'}
            hint="Budget de trajet par parcours, hors temps de visite."
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
                min={preset.distanceMinKm}
                max={preset.distanceMaxKm}
                step="0.5"
                disabled={config.maxDistanceKm === null}
                value={config.maxDistanceKm ?? preset.defaultDistanceKm}
                onChange={(e) => onChange({ maxDistanceKm: Number(e.target.value) })}
                className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-nirmie-500 disabled:opacity-40"
              />
              <button
                onClick={() =>
                  onChange({
                    maxDistanceKm: config.maxDistanceKm === null ? preset.defaultDistanceKm : null,
                  })
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
            title="Rythme"
            hint="Sert au calcul des durées affichées."
          >
            <div className="grid grid-cols-3 gap-2">
              {preset.paces.map((pace) => (
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

      {impossible && (
        <p className="bg-amber-50 border border-amber-100 rounded-2xl p-4 text-sm text-amber-800">
          Pas assez de lieux retenus pour former un parcours d'au moins {config.stopsMin} arrêts.
          Baissez le minimum d'arrêts, ou retenez plus de lieux dans l'inventaire.
        </p>
      )}

      <button
        onClick={onGenerate}
        disabled={impossible}
        className="w-full py-5 rounded-2xl bg-nirmie-500 text-white text-lg font-bold shadow-lg hover:bg-nirmie-600 active:scale-[0.99] transition-all flex items-center justify-center gap-3 disabled:bg-gray-300 disabled:shadow-none disabled:cursor-not-allowed"
      >
        {config.travelMode === 'bike' ? <Bike className="w-6 h-6" /> : <Wand2 className="w-6 h-6" />}
        {config.routeCount === null
          ? `Générer jusqu'à ${routeCount} parcours`
          : `Générer ${routeCount} parcours`}
      </button>
    </div>
  );
};
