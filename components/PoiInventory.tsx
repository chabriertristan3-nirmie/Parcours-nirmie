import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  ExternalLink,
  Info,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { CityScan, POI, PoiFilters, PoiTheme, POI_THEMES, THEME_COLORS } from '../types';
import { applyFilters } from '../services/routePlanner';
import { explainFromSources, cacheAiExplanation, PoiExplanation } from '../services/wikiService';
import { explainPoi } from '../services/geminiService';
import { MapView } from './MapView';

interface Props {
  scan: CityScan;
  filters: PoiFilters;
  onFiltersChange: (filters: PoiFilters) => void;
  /** Ids des POI retenus pour la génération. */
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onAddPoi: (poi: POI) => void;
  onRemovePoi: (id: string) => void;
  onRescan: () => void;
  onCompleteWithAI: () => void;
  aiLoading: boolean;
  aiAvailable: boolean;
  onContinue: () => void;
}

const SOURCE_BADGES: Record<string, { label: string; className: string }> = {
  osm: { label: 'OSM', className: 'bg-gray-100 text-gray-500' },
  ai: { label: 'IA', className: 'bg-purple-100 text-purple-600' },
  manual: { label: 'Ajouté', className: 'bg-amber-100 text-amber-700' },
};

const NotorietyStars: React.FC<{ score: number }> = ({ score }) => {
  const stars = Math.max(1, Math.min(5, Math.round(score / 20)));
  return (
    <span className="inline-flex items-center gap-0.5" title={`Notoriété ${score}/100`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={`w-3 h-3 ${i < stars ? 'text-amber-400 fill-amber-400' : 'text-gray-200'}`}
        />
      ))}
    </span>
  );
};

export const PoiInventory: React.FC<Props> = ({
  scan,
  filters,
  onFiltersChange,
  selectedIds,
  onSelectionChange,
  onAddPoi,
  onRemovePoi,
  onRescan,
  onCompleteWithAI,
  aiLoading,
  aiAvailable,
  onContinue,
}) => {
  const [hovered, setHovered] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [manual, setManual] = useState({ name: '', lat: '', lng: '', theme: POI_THEMES[0] as PoiTheme });

  /** Lieu dont l'explication est dépliée, et contenu chargé par lieu. */
  const [explainedId, setExplainedId] = useState<string | null>(null);
  const [explanations, setExplanations] = useState<
    Record<string, { loading: boolean; data?: PoiExplanation; error?: string }>
  >({});

  const toggleExplanation = async (poi: POI) => {
    if (explainedId === poi.id) {
      setExplainedId(null);
      return;
    }
    setExplainedId(poi.id);
    if (explanations[poi.id]?.data) return;

    setExplanations((prev) => ({ ...prev, [poi.id]: { loading: true } }));
    try {
      // Wikipédia / Wikidata d'abord : factuel et gratuit.
      let result = await explainFromSources(poi);
      // Sinon l'IA, clairement signalée comme telle.
      if (!result && aiAvailable) {
        const text = await explainPoi(scan.city, poi);
        if (text) {
          cacheAiExplanation(poi.id, text);
          result = { text, source: 'ai' };
        }
      }
      setExplanations((prev) => ({
        ...prev,
        [poi.id]: result
          ? { loading: false, data: result }
          : { loading: false, error: 'Aucune information disponible sur ce lieu.' },
      }));
    } catch {
      setExplanations((prev) => ({
        ...prev,
        [poi.id]: { loading: false, error: "Le chargement de l'explication a échoué." },
      }));
    }
  };

  const visible = useMemo(() => applyFilters(scan.pois, filters), [scan.pois, filters]);

  const countByTheme = useMemo(() => {
    const counts: Record<string, number> = {};
    POI_THEMES.forEach((t) => {
      counts[t] = scan.pois.filter((p) => p.theme === t).length;
    });
    return counts;
  }, [scan.pois]);

  const maxThemeCount = Math.max(1, ...POI_THEMES.map((t) => countByTheme[t]));
  const selectedVisible = visible.filter((p) => selectedIds.has(p.id));

  const toggleTheme = (theme: PoiTheme) => {
    const themes = filters.themes.includes(theme)
      ? filters.themes.filter((t) => t !== theme)
      : [...filters.themes, theme];
    onFiltersChange({ ...filters, themes });
  };

  const togglePoi = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  const selectAllVisible = () => {
    const next = new Set(selectedIds);
    visible.forEach((p) => next.add(p.id));
    onSelectionChange(next);
  };

  const deselectAllVisible = () => {
    const next = new Set(selectedIds);
    visible.forEach((p) => next.delete(p.id));
    onSelectionChange(next);
  };

  const keepTop = (n: number) => {
    const top = [...scan.pois].sort((a, b) => b.notoriety - a.notoriety).slice(0, n);
    onSelectionChange(new Set(top.map((p) => p.id)));
  };

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const lat = Number(manual.lat);
    const lng = Number(manual.lng);
    if (!manual.name.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) return;

    onAddPoi({
      id: `manual-${Date.now()}`,
      name: manual.name.trim(),
      theme: manual.theme,
      subtype: 'Lieu ajouté',
      lat,
      lng,
      notoriety: 70,
      visitMinutes: 20,
      source: 'manual',
    });
    setManual({ name: '', lat: '', lng: '', theme: POI_THEMES[0] as PoiTheme });
    setShowAddForm(false);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Bandeau de synthèse ------------------------------------------------ */}
      <div className="bg-white rounded-3xl border border-nirmie-100 shadow-sm p-6 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black text-nirmie-600 uppercase tracking-widest mb-1">
              Inventaire touristique
            </p>
            <h2 className="text-3xl font-extrabold text-gray-900">{scan.city.name}</h2>
            <p className="text-xs text-gray-400 mt-1 max-w-lg">{scan.city.displayName}</p>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-4xl font-black text-nirmie-600 leading-none">
                {scan.pois.length}
              </p>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">
                lieux relevés
              </p>
            </div>
            <div className="text-right">
              <p className="text-4xl font-black text-gray-800 leading-none">
                {selectedIds.size}
              </p>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">
                retenus
              </p>
            </div>
          </div>
        </div>

        {/* Répartition par thème — cliquable pour filtrer */}
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          {POI_THEMES.map((theme) => {
            const count = countByTheme[theme];
            const active = filters.themes.includes(theme);
            return (
              <button
                key={theme}
                onClick={() => toggleTheme(theme)}
                disabled={count === 0}
                className={`p-3 rounded-2xl border-2 text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  active ? 'border-nirmie-500 bg-nirmie-50' : 'border-gray-100 hover:border-gray-200'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: THEME_COLORS[theme] }}
                  />
                  <span className="text-xl font-black text-gray-800 leading-none">{count}</span>
                </div>
                <p className="text-[10px] font-bold text-gray-500 leading-tight">{theme}</p>
                <div className="mt-2 h-1 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${(count / maxThemeCount) * 100}%`,
                      background: THEME_COLORS[theme],
                    }}
                  />
                </div>
              </button>
            );
          })}
        </div>

        {scan.excludedCount > 0 && (
          <div className="bg-nirmie-50 border border-nirmie-100 rounded-2xl p-3">
            <p className="text-[11px] text-nirmie-800 flex items-start gap-2">
              <ShieldCheck className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-nirmie-600" />
              <span>
                <strong>{scan.excludedCount}</strong> lieu{scan.excludedCount > 1 ? 'x' : ''}{' '}
                écarté{scan.excludedCount > 1 ? 's' : ''} automatiquement par les règles de
                sécurité : accès privé ou restreint, zones militaires, sites dangereux
                (falaises, grottes, chantiers), lieux à l'abandon.
              </span>
            </p>
          </div>
        )}

        {scan.notes.length > 0 && (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-3 space-y-1">
            {scan.notes.map((note, i) => (
              <p key={i} className="text-[11px] text-amber-800 flex items-start gap-2">
                <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                {note}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Liste --------------------------------------------------------- */}
        <div className="lg:col-span-3 space-y-4">
          {/* Barre d'outils */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4 space-y-4">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={filters.search}
                onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
                placeholder="Filtrer par nom ou type…"
                className="w-full pl-11 pr-4 py-2.5 rounded-xl bg-gray-50 border border-gray-200 focus:border-nirmie-500 outline-none text-sm"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-gray-500">
                  Notoriété minimale
                </label>
                <span className="text-xs font-black text-nirmie-600">
                  {filters.minNotoriety === 0 ? 'Tout' : `${filters.minNotoriety}+`}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="90"
                step="5"
                value={filters.minNotoriety}
                onChange={(e) =>
                  onFiltersChange({ ...filters, minNotoriety: Number(e.target.value) })
                }
                className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-nirmie-500"
              />
              <p className="text-[10px] text-gray-400">
                Monter le curseur écarte les lieux mineurs et resserre les parcours sur
                l'essentiel.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                onClick={selectAllVisible}
                className="px-3 py-1.5 rounded-lg bg-nirmie-50 text-nirmie-700 text-[11px] font-bold hover:bg-nirmie-100 transition-colors"
              >
                Tout retenir ({visible.length})
              </button>
              <button
                onClick={deselectAllVisible}
                className="px-3 py-1.5 rounded-lg bg-gray-50 text-gray-500 text-[11px] font-bold hover:bg-gray-100 transition-colors"
              >
                Tout écarter
              </button>
              {[20, 40].map((n) => (
                <button
                  key={n}
                  onClick={() => keepTop(n)}
                  disabled={scan.pois.length <= n}
                  className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-[11px] font-bold hover:bg-amber-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Top {n}
                </button>
              ))}
              <button
                onClick={onRescan}
                className="px-3 py-1.5 rounded-lg bg-gray-50 text-gray-500 text-[11px] font-bold hover:bg-gray-100 transition-colors flex items-center gap-1.5 ml-auto"
              >
                <RefreshCw className="w-3 h-3" /> Rescanner
              </button>
            </div>
          </div>

          {/* Liste des POI */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50/60">
              <span className="text-xs font-black text-gray-500 uppercase tracking-widest">
                {visible.length} lieu{visible.length > 1 ? 'x' : ''} affiché
                {visible.length > 1 ? 's' : ''}
              </span>
              <span className="text-xs font-bold text-nirmie-600">
                {selectedVisible.length} retenu{selectedVisible.length > 1 ? 's' : ''}
              </span>
            </div>

            <div className="max-h-[560px] overflow-y-auto divide-y divide-gray-50">
              {visible.length === 0 && (
                <p className="p-8 text-center text-sm text-gray-400">
                  Aucun lieu ne correspond à ces filtres.
                </p>
              )}

              {visible.map((poi) => {
                const selected = selectedIds.has(poi.id);
                const badge = SOURCE_BADGES[poi.source];
                const explanation = explanations[poi.id];
                const isExplained = explainedId === poi.id;
                return (
                  <React.Fragment key={poi.id}>
                    <div
                      onMouseEnter={() => setHovered(poi.id)}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => togglePoi(poi.id)}
                      className={`px-5 py-3 flex items-center gap-4 cursor-pointer transition-colors ${
                        selected ? 'bg-nirmie-50/60' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                          selected
                            ? 'bg-nirmie-500 border-nirmie-500'
                            : 'border-gray-300 bg-white'
                        }`}
                      >
                        {selected && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                      </div>

                      <span
                        className="w-2 h-8 rounded-full flex-shrink-0"
                        style={{ background: THEME_COLORS[poi.theme] }}
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-gray-800 text-sm truncate">{poi.name}</h4>
                          {badge && poi.source !== 'osm' && (
                            <span
                              className={`text-[9px] font-black px-1.5 py-0.5 rounded ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-400 truncate">
                          {poi.subtype}
                          {poi.address ? ` • ${poi.address}` : ''} • {poi.visitMinutes} min
                        </p>
                      </div>

                      <NotorietyStars score={poi.notoriety} />

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExplanation(poi);
                        }}
                        className={`p-1.5 rounded-lg transition-colors ${
                          isExplained
                            ? 'text-nirmie-600 bg-nirmie-50'
                            : 'text-gray-300 hover:text-nirmie-600 hover:bg-nirmie-50'
                        }`}
                        title="En savoir plus sur ce lieu"
                      >
                        <BookOpen className="w-4 h-4" />
                      </button>

                      {poi.source !== 'osm' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemovePoi(poi.id);
                          }}
                          className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg transition-colors"
                          title="Retirer de l'inventaire"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {isExplained && (
                      <div className="px-5 py-4 bg-gray-50/80 border-l-4 animate-fade-in"
                        style={{ borderLeftColor: THEME_COLORS[poi.theme] }}
                      >
                        {explanation?.loading && (
                          <p className="text-xs text-gray-400 flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Recherche
                            d'informations…
                          </p>
                        )}
                        {explanation?.error && (
                          <p className="text-xs text-gray-400">{explanation.error}</p>
                        )}
                        {explanation?.data && (
                          <div className="space-y-2">
                            <p className="text-xs text-gray-600 leading-relaxed">
                              {explanation.data.text}
                            </p>
                            <p className="text-[10px] font-bold flex items-center gap-2">
                              {explanation.data.source === 'ai' ? (
                                <span className="text-purple-500">
                                  Rédigé par l'IA — à vérifier avant publication
                                </span>
                              ) : (
                                <span className="text-gray-400">
                                  Source :{' '}
                                  {explanation.data.source === 'wikipedia'
                                    ? 'Wikipédia'
                                    : 'Wikidata'}
                                </span>
                              )}
                              {explanation.data.url && (
                                <a
                                  href={explanation.data.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-nirmie-600 hover:underline flex items-center gap-1"
                                >
                                  Lire la fiche <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* Compléter l'inventaire */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={onCompleteWithAI}
              disabled={aiLoading || !aiAvailable}
              title={aiAvailable ? undefined : 'Clé Gemini absente'}
              className="flex-1 min-w-[220px] py-3 px-4 rounded-2xl border-2 border-dashed border-purple-200 text-purple-600 text-sm font-bold hover:border-purple-400 hover:bg-purple-50 transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {aiLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              Compléter avec l'IA
            </button>
            <button
              onClick={() => setShowAddForm((v) => !v)}
              className="flex-1 min-w-[220px] py-3 px-4 rounded-2xl border-2 border-dashed border-gray-300 text-gray-500 text-sm font-bold hover:border-nirmie-400 hover:text-nirmie-600 transition-colors flex items-center justify-center gap-2"
            >
              {showAddForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              Ajouter un lieu
            </button>
          </div>

          {showAddForm && (
            <form
              onSubmit={submitManual}
              className="bg-white p-5 rounded-3xl border border-gray-200 space-y-3 animate-fade-in"
            >
              <input
                required
                value={manual.name}
                onChange={(e) => setManual({ ...manual, name: e.target.value })}
                placeholder="Nom du lieu"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-nirmie-500 outline-none text-sm"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  required
                  value={manual.lat}
                  onChange={(e) => setManual({ ...manual, lat: e.target.value })}
                  placeholder="Latitude (45.8992)"
                  className="px-4 py-2.5 rounded-xl border border-gray-200 focus:border-nirmie-500 outline-none text-sm font-mono"
                />
                <input
                  required
                  value={manual.lng}
                  onChange={(e) => setManual({ ...manual, lng: e.target.value })}
                  placeholder="Longitude (6.1294)"
                  className="px-4 py-2.5 rounded-xl border border-gray-200 focus:border-nirmie-500 outline-none text-sm font-mono"
                />
              </div>
              <select
                value={manual.theme}
                onChange={(e) => setManual({ ...manual, theme: e.target.value as PoiTheme })}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-nirmie-500 outline-none text-sm bg-white"
              >
                {POI_THEMES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-gray-400">
                Coordonnées relevées d'un clic droit sur Google Maps ou openstreetmap.org.
              </p>
              <button
                type="submit"
                className="w-full py-2.5 bg-nirmie-600 text-white rounded-xl text-sm font-bold hover:bg-nirmie-700 transition-colors"
              >
                Ajouter à l'inventaire
              </button>
            </form>
          )}
        </div>

        {/* Carte + passage à l'étape suivante ----------------------------- */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white p-2 rounded-3xl border border-gray-100 shadow-sm sticky top-24">
            <MapView
              pois={visible}
              highlightId={hovered}
              className="w-full h-[400px]"
              onSelect={(poi) => togglePoi(poi.id)}
            />
            <div className="px-3 py-3 space-y-3">
              <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                {POI_THEMES.map((theme) => (
                  <span key={theme} className="flex items-center gap-1.5 text-[10px] text-gray-500">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ background: THEME_COLORS[theme] }}
                    />
                    {theme.split(' & ')[0]}
                  </span>
                ))}
              </div>

              <button
                onClick={onContinue}
                disabled={selectedIds.size === 0}
                className="w-full py-4 rounded-2xl bg-nirmie-500 text-white font-bold shadow-md hover:bg-nirmie-600 active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:bg-gray-300 disabled:shadow-none disabled:cursor-not-allowed"
              >
                <MapPin className="w-5 h-5" />
                Composer les parcours
                <ArrowRight className="w-4 h-4" />
              </button>
              {selectedIds.size === 0 && (
                <p className="text-[10px] text-center text-gray-400">
                  Retenez au moins quelques lieux pour continuer.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
