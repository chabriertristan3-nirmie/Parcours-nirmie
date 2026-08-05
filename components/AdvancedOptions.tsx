
import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Settings, Train, Repeat, Accessibility, ShieldCheck, Zap, Ruler, ListOrdered } from 'lucide-react';
import { AppState } from '../types';

interface Props {
  state: AppState;
  onChange: (updates: Partial<AppState>) => void;
}

export const AdvancedOptions: React.FC<Props> = ({ state, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="bg-white rounded-3xl border border-gray-200 overflow-hidden transition-all shadow-sm">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-6 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className="flex items-center font-bold text-gray-700">
          <Settings className="w-5 h-5 mr-2 text-gray-500" />
          Réglages & Forçages avancés
        </span>
        {isOpen ? <ChevronUp className="w-5 h-5 text-gray-500" /> : <ChevronDown className="w-5 h-5 text-gray-500" />}
      </button>

      {isOpen && (
        <div className="p-6 space-y-6 animate-fade-in">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             {/* Anti-doublons */}
            <div 
              onClick={() => onChange({ uniquePOIsAcrossRoutes: !state.uniquePOIsAcrossRoutes })}
              className={`flex items-center justify-between p-4 rounded-2xl border-2 cursor-pointer transition-all ${state.uniquePOIsAcrossRoutes ? 'border-nirmie-500 bg-nirmie-50' : 'border-gray-100 hover:border-gray-200'}`}
            >
              <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${state.uniquePOIsAcrossRoutes ? 'bg-nirmie-500 text-white' : 'bg-gray-100 text-gray-400'}`}>
                      <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                      <p className="font-bold text-gray-800 text-sm">Anti-doublons</p>
                      <p className="text-[10px] text-gray-500">Un POI par pack max</p>
                  </div>
              </div>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${state.uniquePOIsAcrossRoutes ? 'bg-nirmie-500' : 'bg-gray-300'}`}>
                  <div className={`absolute top-0.5 bg-white w-4 h-4 rounded-full transition-all ${state.uniquePOIsAcrossRoutes ? 'left-5.5' : 'left-0.5'}`} />
              </div>
            </div>

            {/* Mode Boucle */}
            <div 
              onClick={() => onChange({ isLoop: !state.isLoop })}
              className={`flex items-center justify-between p-4 rounded-2xl border-2 cursor-pointer transition-all ${state.isLoop ? 'border-nirmie-500 bg-nirmie-50' : 'border-gray-100 hover:border-gray-200'}`}
            >
              <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${state.isLoop ? 'bg-nirmie-500 text-white' : 'bg-gray-100 text-gray-400'}`}>
                      <Repeat className="w-5 h-5" />
                  </div>
                  <div>
                      <p className="font-bold text-gray-800 text-sm">Boucle</p>
                      <p className="text-[10px] text-gray-500">Retour au départ</p>
                  </div>
              </div>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${state.isLoop ? 'bg-nirmie-500' : 'bg-gray-300'}`}>
                  <div className={`absolute top-0.5 bg-white w-4 h-4 rounded-full transition-all ${state.isLoop ? 'left-5.5' : 'left-0.5'}`} />
              </div>
            </div>
          </div>

          <div className="h-px bg-gray-100" />

          {/* Forçages de paramètres */}
          <div className="space-y-4">
            <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <Zap className="w-3 h-3" /> Surcouche de forçage manuel
            </h4>
            
            <div className="space-y-4">
               {/* Force Distance */}
               <div className={`p-4 rounded-2xl border-2 transition-all ${state.forceExactDistance ? 'border-amber-400 bg-amber-50' : 'border-gray-100'}`}>
                  <div className="flex items-center justify-between mb-3">
                     <div className="flex items-center gap-3">
                        <Ruler className={`w-5 h-5 ${state.forceExactDistance ? 'text-amber-500' : 'text-gray-300'}`} />
                        <span className="font-bold text-sm text-gray-700">Forcer Distance</span>
                     </div>
                     <input 
                        type="checkbox" 
                        className="w-5 h-5 accent-amber-500"
                        checked={state.forceExactDistance} 
                        onChange={e => onChange({ forceExactDistance: e.target.checked })}
                     />
                  </div>
                  {state.forceExactDistance && (
                    <div className="flex items-center gap-3 animate-slide-down">
                       <input 
                          type="number" 
                          step="0.1"
                          className="w-full bg-white border border-amber-200 rounded-xl px-4 py-2 font-bold text-amber-700 outline-none"
                          value={state.forcedDistanceValue}
                          onChange={e => onChange({ forcedDistanceValue: parseFloat(e.target.value) || 0 })}
                       />
                       <span className="text-sm font-bold text-amber-600">km</span>
                    </div>
                  )}
               </div>

               {/* Force Stops */}
               <div className={`p-4 rounded-2xl border-2 transition-all ${state.forceExactStops ? 'border-amber-400 bg-amber-50' : 'border-gray-100'}`}>
                  <div className="flex items-center justify-between mb-3">
                     <div className="flex items-center gap-3">
                        <ListOrdered className={`w-5 h-5 ${state.forceExactStops ? 'text-amber-500' : 'text-gray-300'}`} />
                        <span className="font-bold text-sm text-gray-700">Forcer Haltes</span>
                     </div>
                     <input 
                        type="checkbox" 
                        className="w-5 h-5 accent-amber-500"
                        checked={state.forceExactStops} 
                        onChange={e => onChange({ forceExactStops: e.target.checked })}
                     />
                  </div>
                  {state.forceExactStops && (
                    <div className="flex items-center gap-3 animate-slide-down">
                       <input 
                          type="number" 
                          className="w-full bg-white border border-amber-200 rounded-xl px-4 py-2 font-bold text-amber-700 outline-none"
                          value={state.forcedStopsValue}
                          onChange={e => onChange({ forcedStopsValue: parseInt(e.target.value) || 0 })}
                       />
                       <span className="text-sm font-bold text-amber-600">points</span>
                    </div>
                  )}
               </div>
            </div>
          </div>

          <div className="h-px bg-gray-100" />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Transports */}
            <label className={`flex items-center gap-3 p-4 rounded-2xl border-2 cursor-pointer transition-all ${state.includePublicTransport ? 'border-blue-500 bg-blue-50' : 'border-gray-100 hover:border-gray-200'}`}>
                <input 
                    type="checkbox" 
                    className="hidden" 
                    checked={state.includePublicTransport} 
                    onChange={e => onChange({ includePublicTransport: e.target.checked })}
                />
                <Train className={`w-5 h-5 ${state.includePublicTransport ? 'text-blue-500' : 'text-gray-400'}`} />
                <span className="font-bold text-sm text-gray-700">Inclure Transports</span>
            </label>

            {/* Accessibilité */}
            <label className={`flex items-center gap-3 p-4 rounded-2xl border-2 cursor-pointer transition-all ${state.accessible ? 'border-orange-500 bg-orange-50' : 'border-gray-100 hover:border-gray-200'}`}>
                <input 
                    type="checkbox" 
                    className="hidden" 
                    checked={state.accessible} 
                    onChange={e => onChange({ accessible: e.target.checked })}
                />
                <Accessibility className={`w-5 h-5 ${state.accessible ? 'text-orange-500' : 'text-gray-400'}`} />
                <span className="font-bold text-sm text-gray-700">Accessibilité PMR</span>
            </label>
          </div>

        </div>
      )}
    </div>
  );
};
