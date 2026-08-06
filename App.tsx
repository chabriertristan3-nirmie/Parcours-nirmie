import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Library,
  Loader2,
  Map as MapIcon,
  Package,
  Trash2,
  Wand2,
} from 'lucide-react';
import {
  CityScan,
  DEFAULT_ROUTE_CONFIG,
  GeneratedRoute,
  POI,
  PoiFilters,
  RouteConfig,
  SavedPack,
} from './types';
import { CitySearch } from './components/CitySearch';
import { PoiInventory } from './components/PoiInventory';
import { RouteConfigPanel } from './components/RouteConfigPanel';
import { RouteSelection } from './components/RouteSelection';
import { ResultsView } from './components/ResultsView';
import { clearScanCache, dedupePois, scanCity } from './services/osmService';
import { applyFilters, computeCapacity, planRoutes } from './services/routePlanner';
import {
  enrichRoutes,
  hasApiKey,
  recommendPlan,
  suggestMissingPOIs,
} from './services/geminiService';
import { exportPackToSupabase, isSupabaseConfigured } from './services/supabaseService';
import { downloadPackJson } from './services/exporters';

type View = 'city' | 'inventory' | 'config' | 'generating' | 'selection' | 'result';

const INITIAL_FILTERS: PoiFilters = { themes: [], minNotoriety: 0, search: '' };

const readStored = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const App: React.FC = () => {
  const [view, setView] = useState<View>('city');
  const [scan, setScan] = useState<CityScan | null>(null);
  const [filters, setFilters] = useState<PoiFilters>(INITIAL_FILTERS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [config, setConfig] = useState<RouteConfig>(DEFAULT_ROUTE_CONFIG);

  const [routes, setRoutes] = useState<GeneratedRoute[]>([]);
  const [activeRoute, setActiveRoute] = useState<GeneratedRoute | null>(null);
  /** Le pack actuellement affiché sur l'écran de sélection (pour les exports). */
  const [activePack, setActivePack] = useState<SavedPack | null>(null);
  const [progress, setProgress] = useState('');

  const [scanLoading, setScanLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [packs, setPacks] = useState<SavedPack[]>(() =>
    readStored<SavedPack[]>('nirmie_packs', [])
  );
  const [favorites, setFavorites] = useState<GeneratedRoute[]>(() =>
    readStored<GeneratedRoute[]>('nirmie_favorites', [])
  );

  const aiAvailable = useMemo(() => hasApiKey(), []);
  const supabaseAvailable = useMemo(() => isSupabaseConfigured(), []);

  useEffect(() => {
    localStorage.setItem('nirmie_packs', JSON.stringify(packs));
  }, [packs]);

  useEffect(() => {
    localStorage.setItem('nirmie_favorites', JSON.stringify(favorites));
  }, [favorites]);

  /** Les POI retenus, dans l'ordre de l'inventaire. */
  const pool = useMemo(
    () => (scan ? scan.pois.filter((p) => selectedIds.has(p.id)) : []),
    [scan, selectedIds]
  );

  const capacity = useMemo(() => computeCapacity(pool, config), [pool, config]);

  const recentCities = useMemo(
    () => [...new Set(packs.map((p) => p.cityName))].slice(0, 8),
    [packs]
  );

  // -----------------------------------------------------------------------
  // Étape 1 : inventaire de la ville
  // -----------------------------------------------------------------------

  const handleScan = useCallback(async (cityName: string, force = false) => {
    setScanLoading(true);
    setError(null);
    try {
      if (force) clearScanCache(cityName);
      const result = await scanCity(cityName, force);
      setScan(result);
      setFilters(INITIAL_FILTERS);
      // Tout est retenu par défaut : c'est la capacité brute de la ville, à
      // l'utilisateur d'élaguer s'il le souhaite.
      setSelectedIds(new Set(result.pois.map((p) => p.id)));
      setConfig((prev) => ({ ...prev, routeCount: null }));
      setView('inventory');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Le relevé des lieux a échoué.');
    } finally {
      setScanLoading(false);
    }
  }, []);

  const handleCompleteWithAI = useCallback(async () => {
    if (!scan) return;
    setAiLoading(true);
    setError(null);
    try {
      const extras = await suggestMissingPOIs(scan.city, scan.pois);
      if (extras.length === 0) {
        setError("L'IA n'a trouvé aucun lieu majeur manquant.");
        return;
      }
      const merged = dedupePois([...scan.pois, ...extras]).sort(
        (a, b) => b.notoriety - a.notoriety
      );
      const extraIds = new Set(extras.map((e) => e.id));
      setScan({ ...scan, pois: merged });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        // On ne coche que les nouveaux ayant survécu à la déduplication.
        merged.filter((p) => extraIds.has(p.id)).forEach((p) => next.add(p.id));
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Le complément IA a échoué.');
    } finally {
      setAiLoading(false);
    }
  }, [scan]);

  const handleAddPoi = useCallback((poi: POI) => {
    setScan((prev) => (prev ? { ...prev, pois: [poi, ...prev.pois] } : prev));
    setSelectedIds((prev) => new Set(prev).add(poi.id));
  }, []);

  const handleRemovePoi = useCallback((id: string) => {
    setScan((prev) => (prev ? { ...prev, pois: prev.pois.filter((p) => p.id !== id) } : prev));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // -----------------------------------------------------------------------
  // Étape 3 : génération
  // -----------------------------------------------------------------------

  const handleGenerate = useCallback(async () => {
    if (!scan) return;

    setView('generating');
    setError(null);
    setProgress('Composition des parcours…');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Le planificateur est synchrone et peut occuper le thread une seconde :
    // on laisse le navigateur peindre l'écran de chargement d'abord.
    await new Promise((resolve) => setTimeout(resolve, 50));

    let planned = planRoutes(pool, scan.city.name, config);

    if (planned.length === 0) {
      setError(
        "Aucun parcours n'a pu être formé. Réduisez le minimum d'arrêts, augmentez la distance autorisée, ou retenez plus de lieux."
      );
      setView('config');
      return;
    }

    // On accumule les remarques : une génération partiellement dégradée reste
    // une génération réussie, mais l'utilisateur doit savoir ce qui manque.
    const notices: string[] = [];

    if (config.routeCount !== null && planned.length < config.routeCount) {
      notices.push(
        `${planned.length} parcours formés sur les ${config.routeCount} demandés : les lieux restants sont trop isolés pour tenir dans le budget de marche.`
      );
    }

    if (config.enrichWithAI && aiAvailable) {
      setProgress(`Rédaction des textes (0/${planned.length})…`);
      try {
        const { routes: enriched, failures } = await enrichRoutes(
          scan.city,
          planned,
          (done, total) => setProgress(`Rédaction des textes (${done}/${total})…`)
        );
        planned = enriched;
        if (failures > 0) {
          notices.push(
            `${failures} parcours sur ${planned.length} n'ont pas pu être rédigés par l'IA : ils restent disponibles sans textes.`
          );
        }
      } catch (err) {
        notices.push(
          `Enrichissement IA indisponible (${
            err instanceof Error ? err.message : 'erreur'
          }). Les parcours sont générés sans textes.`
        );
      }
    }

    setError(notices.length > 0 ? notices.join(' ') : null);

    const pack: SavedPack = {
      id: `pack-${Date.now()}`,
      cityName: scan.city.name,
      createdAt: new Date().toISOString(),
      routes: planned,
      config,
    };
    setRoutes(planned);
    setActivePack(pack);
    setPacks((prev) => [pack, ...prev].slice(0, 20));
    setView('selection');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [scan, pool, config, aiAvailable]);

  /** Préconisation IA depuis l'écran de réglages. */
  const handleRecommend = useCallback(async () => {
    if (!scan) return null;
    try {
      return await recommendPlan(scan, pool, config.travelMode);
    } catch (err) {
      setError(
        `La préconisation IA a échoué (${err instanceof Error ? err.message : 'erreur'}).`
      );
      return null;
    }
  }, [scan, pool, config.travelMode]);

  // -----------------------------------------------------------------------
  // Archives
  // -----------------------------------------------------------------------

  const openRoute = (route: GeneratedRoute) => {
    setActiveRoute(route);
    setView('result');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveFavorite = (route: GeneratedRoute) => {
    setFavorites((prev) => (prev.some((r) => r.id === route.id) ? prev : [route, ...prev]));
  };

  const openPack = (pack: SavedPack) => {
    setRoutes(pack.routes);
    setActivePack(pack);
    setConfig(pack.config);
    setView('selection');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const currentCity = scan?.city.name ?? routes[0]?.summary.city ?? '';

  const resetToCity = () => {
    setView('city');
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const steps: { key: View; label: string }[] = [
    { key: 'city', label: 'Ville' },
    { key: 'inventory', label: 'Lieux' },
    { key: 'config', label: 'Réglages' },
    { key: 'selection', label: 'Parcours' },
  ];
  const activeStep = view === 'generating' || view === 'result' ? 'selection' : view;
  const stepIndex = Math.max(0, steps.findIndex((s) => s.key === activeStep));

  return (
    <div className="min-h-screen font-sans text-gray-800 pb-20">
      <header className="bg-white shadow-sm sticky top-0 z-[500] no-print">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <button onClick={resetToCity} className="flex items-center gap-2 flex-shrink-0">
            <span className="bg-nirmie-500 text-white rounded-lg p-1.5">
              <Wand2 className="w-5 h-5" />
            </span>
            <h1 className="text-2xl font-bold text-nirmie-600 tracking-tight">NirmieRoute</h1>
          </button>

          <nav className="hidden md:flex items-center gap-1">
            {steps.map((step, i) => (
              <React.Fragment key={step.key}>
                {i > 0 && <span className="w-6 h-px bg-gray-200" />}
                <span
                  className={`px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider transition-colors ${
                    i === stepIndex
                      ? 'bg-nirmie-500 text-white'
                      : i < stepIndex
                        ? 'text-nirmie-600'
                        : 'text-gray-300'
                  }`}
                >
                  {step.label}
                </span>
              </React.Fragment>
            ))}
          </nav>

          {view !== 'city' && (
            <button
              onClick={resetToCity}
              className="text-sm font-medium text-gray-500 hover:text-nirmie-600 transition-colors flex-shrink-0"
            >
              Nouvelle ville
            </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {error && view !== 'city' && (
          <div className="bg-amber-50 text-amber-800 p-4 rounded-2xl flex items-start gap-3 border border-amber-100 mb-6 animate-fade-in">
            <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <p className="text-sm font-medium leading-relaxed flex-1">{error}</p>
            <button
              onClick={() => setError(null)}
              className="text-xs font-bold text-amber-600 hover:text-amber-800 flex-shrink-0"
            >
              Fermer
            </button>
          </div>
        )}

        {view === 'city' && (
          <>
            <CitySearch
              onScan={(city) => handleScan(city)}
              loading={scanLoading}
              error={error}
              recent={recentCities}
            />

            {(packs.length > 0 || favorites.length > 0) && (
              <section className="mt-16 pt-10 border-t border-gray-200 max-w-4xl mx-auto">
                <h3 className="text-xl font-black text-gray-800 flex items-center gap-2 mb-6">
                  <Library className="w-6 h-6 text-nirmie-600" /> Mes archives
                </h3>

                {packs.length > 0 && (
                  <div className="mb-8">
                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                      <Package className="w-3 h-3" /> Packs de ville ({packs.length})
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {packs.map((pack) => (
                        <div
                          key={pack.id}
                          onClick={() => openPack(pack)}
                          className="bg-white p-4 rounded-2xl border border-gray-100 hover:border-nirmie-300 hover:shadow-sm transition-all cursor-pointer flex items-start justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <MapIcon className="w-4 h-4 text-nirmie-500 flex-shrink-0" />
                              <h5 className="font-bold text-gray-800 truncate">{pack.cityName}</h5>
                            </div>
                            <p className="text-[10px] font-black text-nirmie-600 uppercase tracking-tight">
                              {pack.routes.length} parcours •{' '}
                              {pack.routes.reduce((n, r) => n + r.steps.length, 0)} arrêts
                            </p>
                            <p className="text-[10px] text-gray-400 flex items-center gap-1 mt-2">
                              <Calendar className="w-3 h-3" />
                              {new Date(pack.createdAt).toLocaleDateString('fr-FR')}
                            </p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPacks((prev) => prev.filter((p) => p.id !== pack.id));
                            }}
                            className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors flex-shrink-0"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {favorites.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">
                      Parcours favoris ({favorites.length})
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {favorites.map((route) => (
                        <div
                          key={route.id}
                          onClick={() => openRoute(route)}
                          className="bg-white px-4 py-3 rounded-xl border border-gray-100 hover:border-amber-300 transition-all cursor-pointer flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <h5 className="font-bold text-gray-800 text-sm truncate">
                              {route.summary.title}
                            </h5>
                            <p className="text-[10px] text-gray-400 truncate">
                              {route.summary.city} • {route.summary.stopsCount} arrêts •{' '}
                              {route.summary.totalDistanceKm} km
                            </p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setFavorites((prev) => prev.filter((r) => r.id !== route.id));
                            }}
                            className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg flex-shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {view === 'inventory' && scan && (
          <PoiInventory
            scan={scan}
            filters={filters}
            onFiltersChange={setFilters}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            onAddPoi={handleAddPoi}
            onRemovePoi={handleRemovePoi}
            onRescan={() => handleScan(scan.city.name, true)}
            onCompleteWithAI={handleCompleteWithAI}
            aiLoading={aiLoading}
            aiAvailable={aiAvailable}
            onContinue={() => {
              // Ce que l'utilisateur voit à l'écran est ce qui part en
              // génération : on écarte les POI retenus mais masqués par un filtre.
              const visibleIds = new Set(applyFilters(scan.pois, filters).map((p) => p.id));
              setSelectedIds(new Set([...selectedIds].filter((id) => visibleIds.has(id))));
              setView('config');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        )}

        {view === 'config' && scan && (
          <RouteConfigPanel
            scan={scan}
            pool={pool}
            config={config}
            capacity={capacity}
            onChange={(updates) => setConfig((prev) => ({ ...prev, ...updates }))}
            onBack={() => setView('inventory')}
            onGenerate={handleGenerate}
            aiAvailable={aiAvailable}
            onRecommend={handleRecommend}
          />
        )}

        {view === 'generating' && (
          <div className="flex flex-col items-center justify-center py-32 space-y-8">
            <div className="relative">
              <div className="w-24 h-24 bg-nirmie-100 rounded-full animate-ping absolute inset-0" />
              <div className="w-24 h-24 bg-nirmie-500 rounded-full flex items-center justify-center relative shadow-xl z-10">
                <Loader2 className="w-10 h-10 text-white animate-spin" />
              </div>
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-2xl font-bold text-gray-800">Génération en cours</h3>
              <p className="text-sm text-gray-500">{progress}</p>
            </div>
          </div>
        )}

        {view === 'selection' && (
          <RouteSelection
            routes={routes}
            city={currentCity}
            onSelect={openRoute}
            onBack={() => setView(scan ? 'config' : 'city')}
            onExportAll={() =>
              downloadPackJson(
                activePack ?? {
                  id: `pack-${Date.now()}`,
                  cityName: currentCity,
                  createdAt: new Date().toISOString(),
                  routes,
                  config,
                }
              )
            }
            onSupabaseExport={
              supabaseAvailable && activePack
                ? () => exportPackToSupabase(activePack)
                : null
            }
          />
        )}

        {view === 'result' && activeRoute && (
          <ResultsView
            route={activeRoute}
            onBack={() => setView(routes.length > 0 ? 'selection' : 'city')}
            onSave={saveFavorite}
            isSaved={favorites.some((r) => r.id === activeRoute.id)}
          />
        )}
      </main>
    </div>
  );
};

export default App;
