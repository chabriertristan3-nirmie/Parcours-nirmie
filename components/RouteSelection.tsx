
import React from 'react';
import { GeneratedRoute } from '../types';
import { Map, Clock, ArrowRight, Tag, FileSpreadsheet, Download, Database, FolderHeart } from 'lucide-react';

interface Props {
  routes: GeneratedRoute[];
  onSelect: (route: GeneratedRoute) => void;
  onBack: () => void;
}

const THEME_COLORS: Record<string, string> = {
  'Historique & Patrimoine': 'bg-amber-100 text-amber-700 border-amber-200',
  'Panoramas & Points de vue': 'bg-blue-100 text-blue-700 border-blue-200',
  'Nature & Balades': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  'Street art & Insolite': 'bg-purple-100 text-purple-700 border-purple-200',
};

export const RouteSelection: React.FC<Props> = ({ routes, onSelect, onBack }) => {
  
  const handleExportSummary = () => {
    if (routes.length === 0) return;

    const headers = ['Nom du parcours', 'Catégorie', 'Thème', 'Ville', 'Distance', 'Durée'];
    const rows = routes.map(r => [
      `"${r.summary.title.replace(/"/g, '""')}"`,
      `"${(r.summary.category || 'N/A').replace(/"/g, '""')}"`,
      `"${(r.summary.theme || 'N/A').replace(/"/g, '""')}"`,
      `"${r.summary.city.replace(/"/g, '""')}"`,
      `"${r.summary.totalDistance}"`,
      `"${r.summary.estimatedDuration}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    downloadCSV(csvContent, `resume-pack-${routes[0].summary.city.toLowerCase()}.csv`);
  };

  const handleExportFullPack = () => {
    if (routes.length === 0) return;

    const headers = [
      'Nom du Parcours', 
      'Thème Pack', 
      'Catégorie Pack', 
      'Ville', 
      'Distance Totale Parcours', 
      'Durée Totale Parcours', 
      'Numéro Étape', 
      'Nom du Lieu (POI)', 
      'Catégorie du Lieu', 
      'Adresse Précise', 
      'Latitude', 
      'Longitude', 
      'Description / Anecdote'
    ];

    const allRows = routes.flatMap(r => 
      r.steps.map(s => [
        `"${r.summary.title.replace(/"/g, '""')}"`,
        `"${(r.summary.theme || '').replace(/"/g, '""')}"`,
        `"${(r.summary.category || '').replace(/"/g, '""')}"`,
        `"${(r.summary.city || '').replace(/"/g, '""')}"`,
        `"${r.summary.totalDistance}"`,
        `"${r.summary.estimatedDuration}"`,
        s.stepNumber,
        `"${s.name.replace(/"/g, '""')}"`,
        `"${(s.category || '').replace(/"/g, '""')}"`,
        `"${s.address.replace(/"/g, '""')}"`,
        s.lat || '',
        s.lng || '',
        `"${(s.description || '').replace(/"/g, '""')}"`
      ])
    );

    const csvContent = '\uFEFF' + [headers.join(','), ...allRows.map(row => row.join(','))].join('\n');
    downloadCSV(csvContent, `pack-complet-details-${routes[0].summary.city.toLowerCase()}.csv`);
  };

  const downloadCSV = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
        <div className="text-left">
          <h2 className="text-3xl font-bold text-gray-800">Votre Pack de Parcours</h2>
          <p className="text-gray-500 mt-2">L'IA a généré {routes.length} options thématiques (déjà sauvegardées dans vos archives).</p>
        </div>
        
        <div className="flex flex-wrap gap-3">
          <button 
            onClick={handleExportSummary}
            className="flex items-center justify-center gap-2 bg-white border-2 border-gray-200 text-gray-600 px-5 py-3 rounded-2xl font-bold shadow-sm transition-all hover:border-gray-300 active:scale-95 text-sm"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Résumé (CSV)</span>
          </button>
          
          <button 
            onClick={handleExportFullPack}
            className="flex items-center justify-center gap-2 bg-nirmie-500 hover:bg-nirmie-600 text-white px-6 py-3 rounded-2xl font-bold shadow-md transition-all active:scale-95"
          >
            <Database className="w-5 h-5" />
            <span>Exporter Pack Détails (CSV)</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {routes.map((route, idx) => (
          <div 
            key={route.id} 
            className="bg-white rounded-3xl shadow-sm border-2 border-transparent hover:border-nirmie-500 hover:shadow-lg transition-all p-6 flex flex-col h-full group cursor-pointer"
            onClick={() => onSelect(route)}
          >
            <div className="flex items-center justify-between mb-3">
               <span className="bg-gray-100 text-gray-500 font-bold px-2 py-1 rounded-lg text-xs">
                 {route.summary.category || 'Format'}
               </span>
               <span className={`flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${THEME_COLORS[route.summary.theme || ''] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                 <Tag className="w-3 h-3" />
                 {route.summary.theme || 'Thème Libre'}
               </span>
            </div>
            
            <h3 className="text-xl font-bold text-gray-800 mb-2 group-hover:text-nirmie-600 transition-colors leading-tight">
              {route.summary.title}
            </h3>
            
            <div className="flex items-center gap-4 text-xs text-gray-400 mb-6">
                <span className="flex items-center gap-1 font-medium"><Map className="w-3.5 h-3.5" /> {route.summary.totalDistance}</span>
                <span className="flex items-center gap-1 font-medium"><Clock className="w-3.5 h-3.5" /> {route.summary.estimatedDuration}</span>
            </div>

            <div className="flex-1 space-y-3 mb-6">
                <div className="space-y-2">
                    {route.steps.slice(0, 3).map((step, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm text-gray-600">
                             <span className="bg-gray-100 text-gray-400 w-5 h-5 rounded-full flex items-center justify-center text-[10px] flex-shrink-0 mt-0.5">{step.stepNumber}</span>
                             <span className="truncate">{step.name}</span>
                        </div>
                    ))}
                    {route.steps.length > 3 && (
                        <p className="text-xs text-gray-400 pl-7 italic">+ {route.steps.length - 3} autres points</p>
                    )}
                </div>
            </div>

            <button 
              onClick={(e) => { e.stopPropagation(); onSelect(route); }}
              className="w-full bg-gray-50 group-hover:bg-nirmie-500 group-hover:text-white text-gray-700 font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 text-sm"
            >
              Explorer ce parcours <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <button onClick={onBack} className="mx-auto block text-gray-400 hover:text-gray-600 font-medium pb-10">
          Retour aux critères
      </button>
    </div>
  );
};
