
import React, { useState, useEffect } from 'react';
import { Plus, MapPin, Loader2, ListOrdered, Info } from 'lucide-react';
import { AppState, POI } from '../types';
import { suggestPOIs } from '../services/geminiService';

interface Props {
  state: AppState;
  onChange: (updates: Partial<AppState>) => void;
}

export const POIBlock: React.FC<Props> = ({ state, onChange }) => {
  const [loading, setLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<POI[]>([]);
  const [showManualForm, setShowManualForm] = useState(false);
  
  // Manual Form State
  const [manualName, setManualName] = useState('');
  const [manualAddress, setManualAddress] = useState('');

  // Ajuster automatiquement le slider en manuel selon la catégorie
  useEffect(() => {
    if (!state.isFullPackMode && !state.isAdvancedMode) {
      const counts = { C1: 8, C2: 10, C3: 10, C4: 10, C5: 10 };
      onChange({ numberOfStops: counts[state.routeCategory] });
    }
  }, [state.routeCategory, state.isFullPackMode, state.isAdvancedMode]);

  const fetchSuggestions = async () => {
    if (!state.city) {
      alert("Veuillez d'abord entrer une ville.");
      return;
    }
    setLoading(true);
    const suggestions = await suggestPOIs(state);
    setAiSuggestions(suggestions);
    setLoading(false);
  };

  const addPOI = (poi: POI) => {
    if (state.selectedPOIs.some(p => p.id === poi.id)) return;
    onChange({ selectedPOIs: [...state.selectedPOIs, poi] });
  };

  const removePOI = (id: string) => {
    onChange({ selectedPOIs: state.selectedPOIs.filter(p => p.id !== id) });
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualName || !manualAddress) return;
    
    const newPOI: POI = {
      id: `manual-${Date.now()}`,
      name: manualName,
      address: manualAddress,
      category: 'Personnalisé',
      isManual: true
    };
    
    addPOI(newPOI);
    setManualName('');
    setManualAddress('');
    setShowManualForm(false);
  };

  return (
    <div className="space-y-6">
      
      <div className={`bg-white p-6 rounded-3xl shadow-sm border transition-all ${state.isFullPackMode ? 'border-nirmie-200 bg-gray-50' : 'border-nirmie-100'}`}>
        <h3 className="flex items-center text-lg font-bold text-gray-800">
           <ListOrdered className="w-5 h-5 text-nirmie-500 mr-2" />
           Densité des étapes
        </h3>
        
        {state.isFullPackMode ? (
            <div className="mt-4 flex items-start gap-3 bg-nirmie-50 p-4 rounded-2xl border border-nirmie-100 animate-fade-in">
                <Info className="w-5 h-5 text-nirmie-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-nirmie-800">
                    En <strong>Mode Pack</strong>, le nombre de points d'intérêt est géré automatiquement selon les règles officielles (de 8 à 17 étapes par parcours).
                </p>
            </div>
        ) : (
            <div className="space-y-2 mt-4">
                <input
                    type="range"
                    min="3"
                    max="10"
                    step="1"
                    value={state.numberOfStops}
                    onChange={(e) => onChange({ numberOfStops: parseInt(e.target.value) })}
                    className="w-full h-2 bg-nirmie-100 rounded-lg appearance-none cursor-pointer accent-nirmie-500"
                />
                <div className="flex justify-between text-xs text-gray-400 font-medium px-1">
                    <span>3</span>
                    <span>5</span>
                    <span>7</span>
                    <span>10</span>
                </div>
                <p className="text-center font-bold text-nirmie-700 bg-nirmie-50 py-2 rounded-lg border border-nirmie-100">
                    {state.numberOfStops} points d'intérêt par parcours
                </p>
            </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-800">Lieux spécifiques</h2>
        {!state.isFullPackMode && (
            <button 
                onClick={fetchSuggestions}
                disabled={loading || !state.city}
                className="text-sm font-medium text-nirmie-600 hover:text-nirmie-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {loading ? 'Recherche...' : '🔄 Voir des suggestions'}
            </button>
        )}
      </div>

      {/* Suggested POIs */}
      {!state.isFullPackMode && aiSuggestions.length > 0 && (
         <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {aiSuggestions.map((poi) => {
              const isSelected = state.selectedPOIs.some(p => p.id === poi.id);
              return (
                <div key={poi.id} className={`p-4 rounded-2xl border transition-all flex gap-3 ${isSelected ? 'border-nirmie-500 bg-nirmie-50 ring-1 ring-nirmie-500' : 'border-gray-200 bg-white hover:border-nirmie-300'}`}>
                  <div className="w-16 h-16 rounded-xl bg-gray-200 flex-shrink-0 overflow-hidden">
                    <img 
                      src={`https://picsum.photos/seed/${poi.id}/100/100`} 
                      alt={poi.name} 
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-gray-800 truncate">{poi.name}</h4>
                    <p className="text-xs text-gray-500 truncate">{poi.category}</p>
                    <p className="text-xs text-gray-400 mt-1 truncate">{poi.address}</p>
                  </div>
                  <button 
                    onClick={() => isSelected ? removePOI(poi.id) : addPOI(poi)}
                    className={`h-8 w-8 rounded-full flex items-center justify-center transition-colors ${isSelected ? 'bg-red-100 text-red-500' : 'bg-nirmie-100 text-nirmie-600 hover:bg-nirmie-200'}`}
                  >
                    {isSelected ? <span className="font-bold text-lg leading-none">-</span> : <Plus className="w-5 h-5" />}
                  </button>
                </div>
              );
            })}
         </div>
      )}

      {/* Empty State / Prompt */}
      {!state.isFullPackMode && aiSuggestions.length === 0 && !loading && state.selectedPOIs.length === 0 && (
        <div className="text-center py-6 bg-white rounded-3xl border border-dashed border-gray-300">
          <MapPin className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500 text-sm mb-4 max-w-md mx-auto px-4">
            Si vous cliquez directement sur <strong>Générer</strong>, l'IA choisira automatiquement les lieux adaptés.
          </p>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-8">
          <Loader2 className="w-8 h-8 text-nirmie-500 animate-spin" />
        </div>
      )}

      {/* Selected POIs Summary */}
      {!state.isFullPackMode && state.selectedPOIs.length > 0 && (
        <div className="space-y-3">
           <h3 className="text-sm font-bold text-gray-600 uppercase tracking-wide">Sélection manuelle ({state.selectedPOIs.length})</h3>
           <div className="flex flex-wrap gap-3">
             {state.selectedPOIs.map(poi => (
               <div key={poi.id} className="flex items-center bg-nirmie-600 text-white pl-3 pr-2 py-1.5 rounded-full text-sm shadow-md animate-fade-in-up">
                 <span className="mr-2 truncate max-w-[150px]">{poi.name}</span>
                 <button onClick={() => removePOI(poi.id)} className="p-0.5 hover:bg-nirmie-700 rounded-full">
                   <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                 </button>
               </div>
             ))}
           </div>
        </div>
      )}

      {/* Manual Add Button */}
      {!state.isFullPackMode && !showManualForm ? (
        <button 
          onClick={() => setShowManualForm(true)}
          className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-medium hover:border-nirmie-400 hover:text-nirmie-600 transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Forcer un point d'intérêt précis
        </button>
      ) : !state.isFullPackMode && (
        <form onSubmit={handleManualSubmit} className="bg-gray-50 p-4 rounded-xl space-y-3 border border-gray-200">
           <h4 className="font-bold text-gray-700">Lieu imposé</h4>
           <input 
             required
             value={manualName}
             onChange={e => setManualName(e.target.value)}
             placeholder="Nom du lieu" 
             className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:border-nirmie-500 outline-none"
           />
           <input 
             required
             value={manualAddress}
             onChange={e => setManualAddress(e.target.value)}
             placeholder="Adresse" 
             className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:border-nirmie-500 outline-none"
           />
           <div className="flex gap-2 justify-end">
             <button type="button" onClick={() => setShowManualForm(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Annuler</button>
             <button type="submit" className="px-4 py-2 bg-nirmie-600 text-white rounded-lg text-sm font-bold shadow-md hover:bg-nirmie-700">Ajouter</button>
           </div>
        </form>
      )}

    </div>
  );
};
