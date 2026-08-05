import React, { useState } from 'react';
import { Search, Loader2, MapPin, AlertTriangle, Database } from 'lucide-react';

interface Props {
  onScan: (city: string) => void;
  loading: boolean;
  error: string | null;
  /** Villes déjà scannées, proposées en raccourci. */
  recent: string[];
}

export const CitySearch: React.FC<Props> = ({ onScan, loading, error, recent }) => {
  const [query, setQuery] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const city = query.trim();
    if (city && !loading) onScan(city);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-fade-in">
      <div className="text-center space-y-3">
        <h2 className="text-4xl font-extrabold text-gray-900 tracking-tight">
          Quelle ville explore-t-on&nbsp;?
        </h2>
        <p className="text-gray-500 leading-relaxed">
          On commence par relever tous les lieux touristiques de la ville.
          Le nombre de parcours en découlera.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="relative">
          <MapPin className="w-5 h-5 text-nirmie-500 absolute left-5 top-1/2 -translate-y-1/2" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Annecy, Bordeaux, Séville…"
            disabled={loading}
            className="w-full pl-14 pr-5 py-5 rounded-2xl border-2 border-gray-200 focus:border-nirmie-500 outline-none text-lg font-bold shadow-sm transition-colors disabled:bg-gray-50"
          />
        </div>

        <button
          type="submit"
          disabled={loading || query.trim().length === 0}
          className="w-full py-5 rounded-2xl text-white text-lg font-bold shadow-lg transition-all flex items-center justify-center gap-3 bg-nirmie-500 hover:bg-nirmie-600 active:scale-[0.99] disabled:bg-gray-300 disabled:shadow-none disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <Loader2 className="w-6 h-6 animate-spin" />
              Relevé des lieux en cours…
            </>
          ) : (
            <>
              <Search className="w-6 h-6" />
              Inventorier les lieux touristiques
            </>
          )}
        </button>
      </form>

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-2xl flex items-start gap-3 border border-red-100">
          <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <p className="text-sm font-medium leading-relaxed">{error}</p>
        </div>
      )}

      {recent.length > 0 && !loading && (
        <div className="space-y-3">
          <p className="text-xs font-black text-gray-400 uppercase tracking-widest">
            Déjà inventoriées
          </p>
          <div className="flex flex-wrap gap-2">
            {recent.map((city) => (
              <button
                key={city}
                onClick={() => onScan(city)}
                className="px-4 py-2 rounded-xl bg-white border border-gray-200 text-sm font-bold text-gray-600 hover:border-nirmie-400 hover:text-nirmie-700 transition-colors"
              >
                {city}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-start gap-3 text-xs text-gray-400 bg-gray-50 p-4 rounded-2xl border border-gray-100">
        <Database className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <p className="leading-relaxed">
          Les lieux proviennent d'<strong>OpenStreetMap</strong> : coordonnées réelles,
          couverture exhaustive, aucune clé d'API. L'IA n'intervient qu'ensuite,
          pour rédiger les textes des parcours retenus.
        </p>
      </div>
    </div>
  );
};
