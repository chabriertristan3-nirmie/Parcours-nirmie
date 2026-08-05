
import React, { useState, useEffect } from 'react';
import { INITIAL_STATE, AppState, GeneratedRoute, SavedPack } from './types';
import { CriteriaBlock } from './components/CriteriaBlock';
import { POIBlock } from './components/POIBlock';
import { AdvancedOptions } from './components/AdvancedOptions';
import { ResultsView } from './components/ResultsView';
import { RouteSelection } from './components/RouteSelection';
import { generateRoute } from './services/geminiService';
import { Wand2, AlertTriangle, Bookmark, Trash2, Map, ChevronRight, Search, Package, FileSpreadsheet, Settings2, History, FolderHeart, Calendar, ArrowRight, Library } from 'lucide-react';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [view, setView] = useState<'input' | 'generating' | 'selection' | 'result'>('input');
  
  const [generatedRoutes, setGeneratedRoutes] = useState<GeneratedRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<GeneratedRoute | null>(null);
  
  const [savedPacks, setSavedPacks] = useState<SavedPack[]>([]);
  const [savedRoutes, setSavedRoutes] = useState<GeneratedRoute[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Charger l'historique au démarrage
  useEffect(() => {
    const storedPacks = localStorage.getItem('nirmie_saved_packs');
    const storedRoutes = localStorage.getItem('nirmie_saved_routes');
    if (storedPacks) {
      try { setSavedPacks(JSON.parse(storedPacks)); } catch (e) { console.error(e); }
    }
    if (storedRoutes) {
      try { setSavedRoutes(JSON.parse(storedRoutes)); } catch (e) { console.error(e); }
    }
  }, []);

  // Sauvegarder l'historique dès qu'il change
  useEffect(() => {
    localStorage.setItem('nirmie_saved_packs', JSON.stringify(savedPacks));
  }, [savedPacks]);

  useEffect(() => {
    localStorage.setItem('nirmie_saved_routes', JSON.stringify(savedRoutes));
  }, [savedRoutes]);

  const updateState = (updates: Partial<AppState>) => {
    setState(prev => ({ ...prev, ...updates }));
  };

  const handleGenerate = async () => {
    if (!state.city) {
      alert("Veuillez indiquer une ville.");
      return;
    }

    if (state.isAdvancedMode) {
      const totalDistributed = (Object.values(state.themeDistribution) as number[]).reduce((sum, val) => sum + val, 0);
      if (totalDistributed > state.numberOfStops) {
        setError(`Répartition invalide : vous avez distribué ${totalDistributed} points pour un maximum de ${state.numberOfStops} haltes.`);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
    }

    setError(null);
    setView('generating');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      const routes = await generateRoute(state);
      if (routes && routes.length > 0) {
        setGeneratedRoutes(routes);
        
        // AUTO-ARCHIVAGE : On sauvegarde le pack immédiatement
        const newPack: SavedPack = {
          id: `pack-${Date.now()}`,
          cityName: state.city,
          createdAt: new Date().toISOString(),
          routes: [...routes]
        };
        setSavedPacks(prev => [newPack, ...prev]);

        if (routes.length === 1) {
            setSelectedRoute(routes[0]);
            setView('result');
        } else {
            setView('selection');
        }
      } else {
        throw new Error("Aucun parcours généré.");
      }
    } catch (err) {
      setError("Erreur lors de la génération. Veuillez réessayer.");
      setView('input');
    }
  };

  const handleSaveSingleRoute = (route: GeneratedRoute) => {
    if (!savedRoutes.some(r => r.id === route.id)) {
      setSavedRoutes(prev => [route, ...prev]);
    }
  };

  const handleOpenPack = (pack: SavedPack) => {
    setGeneratedRoutes(pack.routes);
    setView('selection');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenSingleRoute = (route: GeneratedRoute) => {
    setSelectedRoute(route);
    setGeneratedRoutes([route]); // Pour permettre le bouton retour
    setView('result');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeletePack = (e: React.MouseEvent, packId: string) => {
    e.stopPropagation();
    if (confirm("Supprimer ce pack de l'historique ?")) {
      setSavedPacks(prev => prev.filter(p => p.id !== packId));
    }
  };

  const handleDeleteRoute = (e: React.MouseEvent, routeId: string) => {
    e.stopPropagation();
    if (confirm("Supprimer ce parcours ?")) {
      setSavedRoutes(prev => prev.filter(r => r.id !== routeId));
    }
  };

  const handleSelectRoute = (route: GeneratedRoute) => {
      setSelectedRoute(route);
      setView('result');
      window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const numToGen = state.isFullPackMode ? 
    (state.citySize === 'Compacte' ? 11 : state.citySize === 'Standard' ? 16 : state.citySize === 'Métropole' ? 26 : 1) 
    : (state.numberOfAlternatives || 1);

  const isButtonDisabled = state.isAdvancedMode && (Object.values(state.themeDistribution) as number[]).reduce((sum, val) => sum + val, 0) > state.numberOfStops;

  return (
    <div className="min-h-screen font-sans text-gray-800 pb-20">
      
      <header className="bg-white shadow-sm sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
             <h1 className="text-2xl font-bold text-nirmie-600 tracking-tight flex items-center gap-2">
               <span className="bg-nirmie-500 text-white rounded-lg p-1.5"><Wand2 className="w-5 h-5"/></span>
               NirmieRoute
             </h1>
          </div>
          {view !== 'input' && (
            <button onClick={() => setView('input')} className="text-sm font-medium text-gray-500 hover:text-nirmie-600 transition-colors">Retour à l'accueil</button>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        
        {view === 'input' && (
          <div className="space-y-12 animate-fade-in max-w-3xl mx-auto">
            <section className="space-y-8">
                <div className="text-center space-y-2 mb-8">
                <h2 className="text-3xl font-extrabold text-gray-900">
                    {state.isAdvancedMode ? 'Création Sur Mesure' : 'Générateur de Ville'}
                </h2>
                <p className="text-gray-500">
                    {state.isAdvancedMode ? 'Affinez chaque paramètre de vos futurs parcours.' : 'Préparez le pack complet pour votre ville.'}
                </p>
                </div>

                {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-xl flex items-start gap-3 border border-red-100 shadow-sm animate-fade-in mb-6">
                    <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" /> 
                    <p className="text-sm font-medium">{error}</p>
                </div>
                )}
                
                <CriteriaBlock state={state} onChange={updateState} />
                <POIBlock state={state} onChange={updateState} />
                <AdvancedOptions state={state} onChange={updateState} />

                <div className="pt-4">
                <button 
                    onClick={handleGenerate}
                    disabled={isButtonDisabled}
                    className={`w-full text-white text-xl font-bold py-5 rounded-full shadow-lg transition-all flex items-center justify-center gap-3 ${isButtonDisabled ? 'bg-gray-300 cursor-not-allowed opacity-70 shadow-none' : 'bg-nirmie-500 hover:bg-nirmie-600 active:scale-95'}`}
                >
                    {state.isAdvancedMode ? <Settings2 className="w-6 h-6" /> : state.isFullPackMode ? <Package className="w-6 h-6" /> : <Wand2 className="w-6 h-6" />}
                    {isButtonDisabled ? 'Répartition invalide' : `Générer ${numToGen} parcours ${state.isAdvancedMode ? 'sur mesure' : ''}`}
                </button>
                </div>
            </section>

            {/* SECTION HISTORIQUE EN BAS DE PAGE */}
            {(savedPacks.length > 0 || savedRoutes.length > 0) && (
                <section className="pt-12 border-t border-gray-200 animate-fade-in">
                    <div className="flex items-center justify-between mb-8">
                      <div className="space-y-1">
                        <h3 className="text-2xl font-black text-gray-800 flex items-center gap-2">
                            <Library className="w-7 h-7 text-nirmie-600" /> Mes Archives
                        </h3>
                        <p className="text-sm text-gray-400">Toutes vos générations sont automatiquement archivées ici.</p>
                      </div>
                    </div>
                    
                    {/* Packs Complets */}
                    {savedPacks.length > 0 && (
                        <div className="mb-10">
                            <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                <Package className="w-3 h-3" /> Packs de Ville ({savedPacks.length})
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {savedPacks.map(pack => (
                                    <div 
                                      key={pack.id} 
                                      onClick={() => handleOpenPack(pack)} 
                                      className="bg-white p-5 rounded-3xl border border-gray-100 hover:border-nirmie-300 hover:shadow-md transition-all cursor-pointer group relative overflow-hidden"
                                    >
                                        <div className="flex justify-between items-start relative z-10">
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                  <Map className="w-4 h-4 text-nirmie-500" />
                                                  <h4 className="font-bold text-gray-800 text-lg">{pack.cityName}</h4>
                                                </div>
                                                <p className="text-[10px] font-black text-nirmie-600 uppercase tracking-tighter">
                                                    {pack.routes.length} Parcours • {pack.routes.reduce((acc, r) => acc + r.steps.length, 0)} POIs
                                                </p>
                                            </div>
                                            <button 
                                              onClick={(e) => handleDeletePack(e, pack.id)}
                                              className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                                            >
                                              <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                        <div className="mt-4 flex items-center justify-between relative z-10">
                                            <p className="text-[10px] text-gray-400 flex items-center gap-1">
                                                <Calendar className="w-3 h-3" /> {new Date(pack.createdAt).toLocaleDateString()}
                                            </p>
                                            <div className="text-nirmie-500 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs font-bold">
                                              Charger <ArrowRight className="w-3 h-3" />
                                            </div>
                                        </div>
                                        <div className="absolute top-0 right-0 w-24 h-24 bg-nirmie-50/50 rounded-bl-full -mr-10 -mt-10 group-hover:bg-nirmie-100 transition-colors" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Parcours Individuels */}
                    {savedRoutes.length > 0 && (
                        <div>
                            <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                <Bookmark className="w-3 h-3" /> Parcours Favoris ({savedRoutes.length})
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {savedRoutes.map(route => (
                                    <div 
                                      key={route.id} 
                                      onClick={() => handleOpenSingleRoute(route)} 
                                      className="bg-white px-4 py-3 rounded-2xl border border-gray-100 hover:border-amber-300 transition-all cursor-pointer flex justify-between items-center group shadow-sm"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center text-amber-500">
                                                <Bookmark className="w-4 h-4" />
                                            </div>
                                            <div className="min-w-0">
                                                <h5 className="font-bold text-gray-800 text-sm truncate">{route.summary.title}</h5>
                                                <p className="text-[10px] text-gray-400 truncate">{route.summary.city} • {route.summary.theme}</p>
                                            </div>
                                        </div>
                                        <button 
                                            onClick={(e) => handleDeleteRoute(e, route.id)}
                                            className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg"
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
          </div>
        )}

        {view === 'generating' && (
          <div className="flex flex-col items-center justify-center py-32 space-y-8">
            <div className="relative">
              <div className="w-24 h-24 bg-nirmie-100 rounded-full animate-ping absolute inset-0"></div>
              <div className="w-24 h-24 bg-nirmie-500 rounded-full flex items-center justify-center relative shadow-xl z-10">
                <Wand2 className="w-10 h-10 text-white animate-spin-slow" />
              </div>
            </div>
            <div className="text-center space-y-4">
              <h3 className="text-2xl font-bold text-gray-800">Production en cours...</h3>
              <p className="text-sm text-gray-500 italic">"L'IA prépare {numToGen} parcours exclusifs avec des descriptions détaillées..."</p>
            </div>
          </div>
        )}

        {view === 'selection' && (
          <RouteSelection 
            routes={generatedRoutes} 
            onSelect={handleSelectRoute} 
            onBack={() => setView('input')} 
          />
        )}

        {view === 'result' && selectedRoute && (
          <ResultsView 
            route={selectedRoute} 
            onBack={() => setView(generatedRoutes.length > 1 ? 'selection' : 'input')} 
            onSave={handleSaveSingleRoute}
            isSaved={savedRoutes.some(r => r.id === selectedRoute.id)}
          />
        )}
      </main>
    </div>
  );
};

export default App;
