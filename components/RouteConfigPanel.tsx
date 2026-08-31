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
  Route,
  Ruler,
  Shuffle,
  Sparkles,
  Clock,
  Stethoscope,
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
  SizingMode,
  TravelMode,
} from '../types';
import { formatDuration } from '../services/geo';
import { checkConnection, ConnectionCheck } from '../services/geminiService';

interface Props {
  scan: CityScan;
  pool: POI[];
  config: RouteConfig;
  capacity: Capacity;
  onChange: (updates: Partial<RouteConfig>) => void;
  onBack: () => void;
  onGenerate: () => void;
  aiAvailable: boolean;
  /** Renvoie la préconisation, ou le message d'erreur à afficher tel quel. */
  onRecommend: () => Promise<{ recommendation: AiRecommendation } | { error: string }>;
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
  const [aiError, setAiError] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<ConnectionCheck | null>(null);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);

  const preset = MODE_PRESETS[config.travelMode];
  const routeCount = config.routeCount ?? capacity.maxRoutes;
  const impossible = capacity.maxRoutes === 0;

  // Estimations issues du calcul de capacité : elles tiennent compte de la
  // densité réelle des lieux retenus, et valent pour les deux cadrages.
  const estimatedEffortMinutes = capacity.estimatedEffortMinutes;
  const estimatedVisitMinutes = Math.max(0, capacity.estimatedMinutes - estimatedEffortMinutes);
  const byDuration = config.sizingMode === 'duration';

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
    setAiError(null);
    setDiagnostic(null);
    try {
      const result = await onRecommend();
      if ('error' in result) setAiError(result.error);
      else setRecommendation(result.recommendation);
    } finally {
      setRecommendLoading(false);
    }
  };

  const runDiagnostic = async () => {
    setDiagnosticLoading(true);
    setAiError(null);
    try {
      setDiagnostic(await checkConnection());
    } finally {
      setDiagnosticLoading(false);
    }
  };

  const applyRecommendation = () => {
    if (!recommendation) return;
    onChange({
      // La préconisation raisonne en arrêts : on bascule sur ce cadrage, sans
      // quoi les valeurs proposées seraient aussitôt écrasées par le temps.
      sizingMode: 'stops',
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
              de <strong>~{formatDuration(capacity.estimatedMinutes)}</strong> chacun,{' '}
              {capacity.stopsTarget} arrêts en moyenne
            </p>
            <p className="text-nirmie-100/80 text-xs">
              dont ~{formatDuration(estimatedEffortMinutes)} de{' '}
              {config.travelMode === 'bike' ? 'vélo' : 'marche'} et ~
              {formatDuration(estimatedVisitMinutes)} de visites, jusqu'à{' '}
              {capacity.maxDistanceKm ? `${capacity.maxDistanceKm} km` : 'distance libre'}
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
          <div className="flex items-center gap-2">
            <button
              onClick={runDiagnostic}
              disabled={diagnosticLoading || !aiAvailable}
              title="Vérifie que la clé Gemini fonctionne et affiche l'erreur exacte le cas échéant"
              className="px-3 py-2.5 rounded-xl border-2 border-purple-200 text-purple-600 text-xs font-bold hover:bg-purple-50 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {diagnosticLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Stethoscope className="w-3.5 h-3.5" />
              )}
              Tester la clé
            </button>
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
        </div>

        {!aiAvailable && (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 text-xs text-amber-800 leading-relaxed space-y-1">
            <p className="font-bold">Clé Gemini non détectée.</p>
            <p>
              Créez un fichier nommé <code className="font-mono bg-white px-1 rounded">.env.local</code>{' '}
              à la racine du projet (au même niveau que <code className="font-mono bg-white px-1 rounded">package.json</code>),
              contenant une seule ligne :
            </p>
            <p className="font-mono bg-white px-2 py-1 rounded border border-amber-200">
              GEMINI_API_KEY=AIza...
            </p>
            <p>
              Puis <strong>redémarrez le serveur</strong> : Ctrl+C dans le terminal, puis{' '}
              <code className="font-mono bg-white px-1 rounded">npm run dev</code>. La clé n'est lue
              qu'au démarrage.
            </p>
          </div>
        )}

        {diagnostic && (
          <div
            className={`rounded-2xl p-4 text-xs leading-relaxed border ${
              diagnostic.ok
                ? 'bg-nirmie-50 border-nirmie-100 text-nirmie-800'
                : 'bg-red-50 border-red-100 text-red-700'
            }`}
          >
            <p className="font-bold mb-1">
              {diagnostic.ok ? 'Clé fonctionnelle' : 'La clé ne fonctionne pas'}
            </p>
            <p>{diagnostic.message}</p>
          </div>
        )}

        {aiError && (
          <div className="bg-red-50 border border-red-100 rounded-2xl p-4 text-xs text-red-700 leading-relaxed">
            <p className="font-bold mb-1">La préconisation a échoué</p>
            <p>{aiError}</p>
          </div>
        )}

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
            icon={<Clock className="w-4 h-4 text-nirmie-500" />}
            title="Cadrage des parcours"
            hint="Ce qui décide de la taille — et donc du nombre de parcours."
          >
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['duration', 'Par le temps', <Clock key="d" className="w-4 h-4" />],
                  ['stops', 'Par les arrêts', <ListOrdered key="s" className="w-4 h-4" />],
                ] as const
              ).map(([mode, label, icon]) => (
                <button
                  key={mode}
                  onClick={() => onChange({ sizingMode: mode as SizingMode, routeCount: null })}
                  className={`p-3 rounded-2xl border-2 transition-all flex flex-col items-center gap-1.5 ${
                    config.sizingMode === mode
                      ? 'border-nirmie-500 bg-nirmie-50 text-nirmie-700'
                      : 'border-gray-100 text-gray-400 hover:border-gray-200'
                  }`}
                >
                  {icon}
                  <span className="text-[11px] font-bold">{label}</span>
                </button>
              ))}
            </div>
          </Section>

          <div className="h-px bg-gray-100" />

          {byDuration ? (
            <Section
              icon={<Clock className="w-4 h-4 text-nirmie-500" />}
              title="Temps par parcours"
              hint="Le seul réglage à donner : tout le reste en découle."
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-500">Temps disponible</span>
                  <span className="text-2xl font-black text-nirmie-600 leading-none">
                    {formatDuration(config.targetMinutes)}
                  </span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="360"
                  step="5"
                  value={config.targetMinutes}
                  onChange={(e) =>
                    onChange({ targetMinutes: Number(e.target.value), routeCount: null })
                  }
                  className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-nirmie-500"
                />
                <div className="flex justify-between text-[10px] text-gray-400 font-medium">
                  <span>20 min</span>
                  <span>6 h</span>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {[45, 90, 120, 180].map((minutes) => (
                    <button
                      key={minutes}
                      onClick={() => onChange({ targetMinutes: minutes, routeCount: null })}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                        config.targetMinutes === minutes
                          ? 'bg-nirmie-500 text-white'
                          : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      {formatDuration(minutes)}
                    </button>
                  ))}
                </div>

                <div className="bg-nirmie-50 border border-nirmie-100 rounded-2xl p-3 space-y-1">
                  <p className="text-[10px] font-black text-nirmie-700 uppercase tracking-widest">
                    Déduit de ce temps
                  </p>
                  <p className="text-xs text-nirmie-900">
                    <strong>{capacity.stopsTarget} arrêts</strong> par parcours, et jusqu'à{' '}
                    <strong>
                      {capacity.maxDistanceKm ? `${capacity.maxDistanceKm} km` : 'distance libre'}
                    </strong>{' '}
                    de {config.travelMode === 'bike' ? 'vélo' : 'marche'}.
                  </p>
                  <p className="text-[10px] text-nirmie-700/80 leading-relaxed">
                    Calculé sur la densité réelle des lieux retenus : durée de visite moyenne et
                    distance typique entre deux lieux voisins.
                  </p>
                </div>

                {/* Un budget peut être intenable : deux arrêts sont le minimum,
                    et deux visites longues dépassent déjà un petit budget. */}
                {capacity.estimatedMinutes > config.targetMinutes * 1.15 && (
                  <div className="bg-amber-50 border border-amber-100 rounded-2xl p-3">
                    <p className="text-xs text-amber-800 leading-relaxed">
                      <strong>
                        Budget difficile à tenir : ~{formatDuration(capacity.estimatedMinutes)}{' '}
                        attendus.
                      </strong>{' '}
                      Les lieux retenus demandent trop de temps de visite pour rentrer dans{' '}
                      {formatDuration(config.targetMinutes)}. Allongez le temps, ou écartez les
                      lieux les plus longs à visiter dans l'inventaire (musées, châteaux).
                    </p>
                  </div>
                )}
              </div>
            </Section>
          ) : (
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
          )}

          <div className="h-px bg-gray-100" />

          {!byDuration && (
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
          )}

          {!byDuration && <div className="h-px bg-gray-100" />}

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
              active={config.followStreets}
              onToggle={() => onChange({ followStreets: !config.followStreets })}
              icon={<Route className="w-4 h-4" />}
              title="Tracé par les rues"
              subtitle="Suit rues et chemins, et donne les distances réelles"
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
