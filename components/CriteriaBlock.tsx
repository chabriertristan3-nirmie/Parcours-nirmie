
import React from 'react';
import { MapPin, Navigation, Tag, Sparkles, Building2, Ruler, CheckCircle2, ListOrdered, Zap, Plus, Minus, MoveHorizontal, Info, AlertCircle, Layers } from 'lucide-react';
import { AppState, Theme, CitySize, RouteCategory, CITY_DATABASE } from '../types.ts';

interface Props {
  state: AppState;
  onChange: (updates: Partial<AppState>) => void;
}

const THEME_OPTIONS: Theme[] = [
  'Historique & Patrimoine', 'Panoramas & Points de vue', 'Nature & Balades', 'Street art & Insolite'
];

const CITY_SIZES: { value: CitySize; label: string; total: number; split: string; themeSplit: string }[] = [
  { value: 'Compacte', label: 'Petite / Compacte', total: 11, split: '4x C1 • 5x C2 • 2x C3', themeSplit: '4 Hist • 2 Pano • 3 Nat • 2 Street' },
  { value: 'Standard', label: 'Ville Moyenne', total: 16, split: '5x C1 • 7x C2 • 3x C3 • 1x C4', themeSplit: '5 Hist • 4 Pano • 4 Nat • 3 Street' },
  { value: 'Métropole', label: 'Grande Métropole', total: 26, split: '7x C1 • 10x C2 • 6x C3 • 3x C4', themeSplit: '8 Hist • 7 Pano • 6 Nat • 5 Street' },
  { value: 'Territorial', label: 'Parcours Unique', total: 1, split: 'C5 uniquement', themeSplit: 'Libre' },
];

export const CriteriaBlock: React.FC<Props> = ({ state, onChange }) => {
  const toggleTheme = (theme: Theme) => {
    const current = state.themes;
    const isSelected = current.includes(theme);
    let newThemes;
    if (isSelected) {
      newThemes = current.filter(t => t !== theme);
      const newDist = { ...state.themeDistribution };
      delete newDist[theme];
      onChange({ themes: newThemes, themeDistribution: newDist });
    } else {
      newThemes = [...current, theme];
      onChange({ themes: newThemes, themeDistribution: { ...state.themeDistribution, [theme]: 1 } });
    }
  };

  const updateDistribution = (theme: string, val: number) => {
    onChange({
      themeDistribution: { ...state.themeDistribution, [theme]: Math.max(0, val) }
    });
  };

  const handleCityChange = (val: string) => {
    const normalized = val.trim();
    const foundSize = CITY_DATABASE[normalized] || Object.entries(CITY_DATABASE).find(([city]) => city.toLowerCase() === normalized.toLowerCase())?.[1];
    
    onChange({ 
      city: val, 
      citySize: foundSize || state.citySize 
    });
  };

  const totalDistributed = (Object.values(state.themeDistribution) as number[]).reduce((sum, val) => sum + val, 0);
  const isOverQuota = state.isAdvancedMode && totalDistributed > state.numberOfStops;

  return (
    <div className="space-y-6 bg-white p-6 rounded-3xl shadow-sm border border-nirmie-100">
      
      {/* Localisation & Reconnaissance Auto */}
      <div className="space-y-4">
        <h3 className="flex items-center text-lg font-bold text-gray-800">
          <MapPin className="w-5 h-5 text-nirmie-500 mr-2" />
          Localisation
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="relative">
            <input
              type="text"
              placeholder="Saisissez la ville..."
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-nirmie-500 transition outline-none font-bold shadow-sm"
              value={state.city}
              onChange={(e) => handleCityChange(e.target.value)}
            />
            {CITY_DATABASE[state.city.trim()] && (
                <div className="absolute -top-2 -right-2 bg-nirmie-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold shadow-sm flex items-center gap-1">
                   <Zap className="w-2.5 h-2.5" /> Ville reconnue
                </div>
            )}
          </div>
          <div className="relative">
            <input
               type="text"
               placeholder="Départ précis (optionnel)"
               className="w-full px-4 py-3 pr-12 rounded-xl border border-gray-200 focus:border-nirmie-500 outline-none text-sm bg-gray-50"
               value={state.startAddress}
               onChange={(e) => onChange({ startAddress: e.target.value })}
            />
            <button onClick={() => navigator.geolocation.getCurrentPosition(p => onChange({ startAddress: `${p.coords.latitude.toFixed(4)}, ${p.coords.longitude.toFixed(4)}` }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-nirmie-500"><Navigation className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      <div className="h-px bg-gray-100" />

      {/* Sélecteur de Taille / Envergure */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
            <h3 className="flex items-center text-lg font-bold text-gray-800">
            <Building2 className="w-5 h-5 text-nirmie-500 mr-2" />
            Envergure du Pack
            </h3>
            <span className="text-[10px] font-bold text-gray-400 bg-gray-50 px-2 py-1 rounded">Basé sur la taille de la ville</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {CITY_SIZES.map((size) => (
            <button
              key={size.value}
              onClick={() => onChange({ citySize: size.value })}
              className={`p-4 rounded-2xl border-2 text-left transition-all relative overflow-hidden ${
                state.citySize === size.value 
                ? 'border-nirmie-500 bg-nirmie-50 shadow-sm ring-1 ring-nirmie-500' 
                : 'border-gray-100 hover:border-gray-200 bg-white'
              }`}
            >
              <p className={`font-bold text-sm ${state.citySize === size.value ? 'text-nirmie-700' : 'text-gray-700'}`}>
                {size.label}
              </p>
              <div className="mt-1 flex items-center justify-between">
                <span className={`text-[10px] font-black uppercase px-1.5 py-0.5 rounded ${state.citySize === size.value ? 'bg-nirmie-500 text-white' : 'bg-gray-100 text-gray-400'}`}>
                   {size.total} Parcours
                </span>
              </div>
              <p className="mt-2 text-[9px] text-gray-400 leading-tight font-medium">
                {size.split}
              </p>
              <p className="mt-1 text-[8px] text-nirmie-600 font-bold">
                {size.themeSplit}
              </p>
              {state.citySize === size.value && <div className="absolute top-0 right-0 w-8 h-8 bg-nirmie-500/10 rounded-bl-full flex items-center justify-center"><CheckCircle2 className="w-3 h-3 text-nirmie-500 mb-2 ml-2" /></div>}
            </button>
          ))}
        </div>
      </div>

      <div className="h-px bg-gray-100" />

      {/* Stratégie de création */}
      <div className="space-y-4">
        <h3 className="flex items-center text-lg font-bold text-gray-800">
          <CheckCircle2 className="w-5 h-5 text-nirmie-500 mr-2" />
          Mode de Génération
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <button 
              onClick={() => onChange({ isFullPackMode: true, isAdvancedMode: false })}
              className={`py-3 rounded-xl border-2 transition-all font-bold text-xs ${state.isFullPackMode && !state.isAdvancedMode ? 'border-nirmie-500 bg-nirmie-50 text-nirmie-700 shadow-sm' : 'border-gray-100 bg-gray-50 text-gray-400'}`}
          >
              Pack Complet
          </button>
          <button 
              onClick={() => onChange({ isFullPackMode: false, isAdvancedMode: false })}
              className={`py-3 rounded-xl border-2 transition-all font-bold text-xs ${!state.isFullPackMode && !state.isAdvancedMode ? 'border-nirmie-500 bg-nirmie-50 text-nirmie-700 shadow-sm' : 'border-gray-100 bg-gray-50 text-gray-400'}`}
          >
              Manuel
          </button>
          <button 
              onClick={() => onChange({ isAdvancedMode: true, isFullPackMode: false })}
              className={`py-3 rounded-xl border-2 transition-all font-bold text-xs ${state.isAdvancedMode ? 'border-nirmie-500 bg-nirmie-50 text-nirmie-700 shadow-sm' : 'border-gray-100 bg-gray-50 text-gray-400'}`}
          >
              Sur Mesure
          </button>
        </div>
        {state.isFullPackMode && (
            <div className="bg-nirmie-50 p-3 rounded-xl border border-nirmie-100 flex items-start gap-2 animate-fade-in">
                <Info className="w-4 h-4 text-nirmie-600 mt-0.5 flex-shrink-0" />
                <div className="text-[10px] text-nirmie-800 leading-relaxed">
                    Le Mode Pack génère automatiquement la collection de <strong>{CITY_SIZES.find(s => s.value === state.citySize)?.total} parcours</strong> thématiques.
                </div>
            </div>
        )}
      </div>

      {state.isAdvancedMode && (
        <div className="space-y-6 animate-fade-in bg-nirmie-50/50 p-6 rounded-3xl border border-nirmie-100">
           <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                 <div className="flex items-center justify-between">
                    <label className="text-sm font-bold text-gray-600 flex items-center gap-2">
                      <ListOrdered className="w-4 h-4 text-nirmie-500" />
                      Nombre de haltes (POI)
                    </label>
                    <input 
                      type="number" 
                      min="3"
                      max="10"
                      value={state.numberOfStops}
                      onChange={(e) => onChange({ numberOfStops: Math.min(10, parseInt(e.target.value) || 3) })}
                      className="w-16 px-2 py-1 text-right font-bold text-nirmie-600 border border-nirmie-200 rounded-lg outline-none"
                    />
                 </div>
                 <input 
                    type="range" min="3" max="10" step="1" 
                    value={state.numberOfStops}
                    onChange={(e) => onChange({ numberOfStops: parseInt(e.target.value) })}
                    className="w-full h-2 bg-nirmie-200 rounded-lg appearance-none cursor-pointer accent-nirmie-600"
                 />
              </div>

              <div className="space-y-3">
                 <div className="flex items-center justify-between">
                    <label className="text-sm font-bold text-gray-600 flex items-center gap-2">
                      <Layers className="w-4 h-4 text-nirmie-500" />
                      Variantes à générer
                    </label>
                    <input 
                      type="number" 
                      min="1"
                      max="10"
                      value={state.numberOfAlternatives}
                      onChange={(e) => onChange({ numberOfAlternatives: Math.min(10, parseInt(e.target.value) || 1) })}
                      className="w-16 px-2 py-1 text-right font-bold text-nirmie-600 border border-nirmie-200 rounded-lg outline-none"
                    />
                 </div>
                 <input 
                    type="range" min="1" max="10" step="1" 
                    value={state.numberOfAlternatives}
                    onChange={(e) => onChange({ numberOfAlternatives: parseInt(e.target.value) })}
                    className="w-full h-2 bg-nirmie-200 rounded-lg appearance-none cursor-pointer accent-nirmie-600"
                 />
              </div>
           </div>

           <div className="space-y-4">
              <div className="flex items-center justify-between">
                 <label className="text-sm font-bold text-gray-600">Répartition par thèmes</label>
                 <div className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${(Object.values(state.themeDistribution) as number[]).reduce((sum, val) => sum + val, 0) > state.numberOfStops ? 'bg-red-500 text-white animate-pulse' : 'bg-nirmie-100 text-nirmie-700'}`}>
                    Total : {(Object.values(state.themeDistribution) as number[]).reduce((sum, val) => sum + val, 0)} / {state.numberOfStops}
                 </div>
              </div>

              {isOverQuota && (
                <div className="bg-red-50 border border-red-200 p-4 rounded-2xl flex items-start gap-3 animate-fade-in shadow-sm">
                   <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                   <div>
                      <p className="text-sm font-bold text-red-800">Dépassement du quota !</p>
                      <p className="text-xs text-red-600 leading-relaxed">
                        Vous avez réparti trop de points thématiques par rapport au nombre total de haltes.
                      </p>
                   </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                 {THEME_OPTIONS.map(theme => {
                   const count = state.themeDistribution[theme] || 0;
                   const isSelected = state.themes.includes(theme);
                   return (
                     <div key={theme} className={`p-4 rounded-2xl border transition-all flex items-center justify-between ${isSelected ? 'bg-white border-nirmie-200 shadow-sm' : 'bg-transparent border-gray-100 opacity-60'}`}>
                        <div className="flex items-center gap-2">
                           <button onClick={() => toggleTheme(theme)} className={`w-5 h-5 rounded-full border-2 transition-colors ${isSelected ? 'bg-nirmie-500 border-nirmie-500' : 'border-gray-300'}`} />
                           <span className="text-xs font-bold text-gray-700 leading-tight">{theme}</span>
                        </div>
                        {isSelected && (
                           <div className="flex items-center gap-3">
                              <button onClick={() => updateDistribution(theme, count - 1)} className="p-1 hover:bg-gray-100 rounded text-gray-400"><Minus className="w-3 h-3"/></button>
                              <span className={`w-4 text-center font-bold ${isOverQuota ? 'text-red-600' : 'text-nirmie-700'}`}>{count}</span>
                              <button onClick={() => updateDistribution(theme, count + 1)} className="p-1 hover:bg-gray-100 rounded text-gray-400"><Plus className="w-3 h-3"/></button>
                           </div>
                        )}
                     </div>
                   );
                 })}
              </div>
           </div>
        </div>
      )}

      {!state.isAdvancedMode && !state.isFullPackMode && (
          <div className="space-y-4 pt-2">
            <h3 className="flex items-center text-lg font-bold text-gray-800">
                <Tag className="w-5 h-5 text-nirmie-500 mr-2" />
                Thèmes prioritaires
            </h3>
            <div className="flex flex-wrap gap-2">
                {THEME_OPTIONS.map(theme => (
                    <button
                        key={theme}
                        onClick={() => toggleTheme(theme)}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${state.themes.includes(theme) ? 'bg-nirmie-500 text-white border-nirmie-600 shadow-sm' : 'bg-white border-gray-200 text-gray-500'}`}
                    >
                        {theme}
                    </button>
                ))}
            </div>
          </div>
      )}

      <div className="space-y-3 pt-2">
        <h3 className="flex items-center text-lg font-bold text-gray-800">
           <Sparkles className="w-5 h-5 text-nirmie-500 mr-2" />
           Instructions Libres
        </h3>
        <textarea
          placeholder="Ex: Éviter les dénivelés, passer par le jardin public..."
          className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-nirmie-500 outline-none text-sm min-h-[90px] bg-gray-50 resize-none shadow-inner"
          value={state.customInstructions}
          onChange={(e) => onChange({ customInstructions: e.target.value })}
        />
      </div>

    </div>
  );
};
