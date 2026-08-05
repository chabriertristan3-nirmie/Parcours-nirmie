
import React, { useEffect, useRef, useState } from 'react';
import { GeneratedRoute } from '../types';
import { Download, Share2, Map, Clock, ArrowLeft, ExternalLink, MapPin, FileSpreadsheet, BookmarkCheck, Bookmark, Tag, History, Quote } from 'lucide-react';

declare global {
  interface Window {
    L: any;
  }
}

interface Props {
  route: GeneratedRoute;
  onBack: () => void;
  onSave?: (route: GeneratedRoute) => void;
  isSaved?: boolean;
}

const THEME_CHIPS: Record<string, string> = {
  'Historique & Patrimoine': 'bg-amber-500/20 text-amber-100 border-amber-500/30',
  'Panoramas & Points de vue': 'bg-blue-500/20 text-blue-100 border-blue-500/30',
  'Nature & Balades': 'bg-emerald-500/20 text-emerald-100 border-emerald-500/30',
  'Street art & Insolite': 'bg-purple-500/20 text-purple-100 border-purple-500/30',
};

export const ResultsView: React.FC<Props> = ({ route, onBack, onSave, isSaved = false }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const [localSaved, setLocalSaved] = useState(isSaved);

  useEffect(() => {
    setLocalSaved(isSaved);
  }, [isSaved]);

  useEffect(() => {
    if (mapRef.current && !mapInstance.current && window.L) {
      const firstStep = route.steps[0];
      const startLat = firstStep?.lat || 48.8566;
      const startLng = firstStep?.lng || 2.3522;

      const map = window.L.map(mapRef.current).setView([startLat, startLng], 13);
      
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);

      const latLngs: [number, number][] = [];

      route.steps.forEach((step) => {
        if (step.lat && step.lng) {
          const coords: [number, number] = [step.lat, step.lng];
          latLngs.push(coords);
          const marker = window.L.marker(coords).addTo(map);
          marker.bindPopup(`<b>${step.stepNumber}. ${step.name}</b><br>${step.address}`);
        }
      });

      if (latLngs.length > 1) {
        window.L.polyline(latLngs, { color: '#10b981', weight: 4 }).addTo(map);
        const bounds = window.L.latLngBounds(latLngs);
        map.fitBounds(bounds, { padding: [50, 50] });
      }

      mapInstance.current = map;
      setTimeout(() => { map.invalidateSize(); }, 500);
    }

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [route]);

  const handleDownload = (format: 'json' | 'gpx' | 'pdf' | 'csv') => {
    const filename = `parcours-${route.summary.title.toLowerCase().replace(/\s+/g, '-')}.${format}`;
    if (format === 'pdf') { window.print(); return; }

    let content = '';
    let type = '';
    if (format === 'json') {
      content = JSON.stringify(route, null, 2);
      type = 'application/json';
    } else if (format === 'gpx') {
        content = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="NirmieApp">\n  <trk>\n    <name>${route.summary.title}</name>\n    <trkseg>\n      ${route.steps.map(s => `<trkpt lat="${s.lat}" lon="${s.lng}"><name>${s.name}</name></trkpt>`).join('\n')}\n    </trkseg>\n  </trk>\n</gpx>`;
      type = 'application/gpx+xml';
    } else if (format === 'csv') {
      const headers = ['Titre', 'Thème', 'Ville', 'Etape #', 'Nom', 'Adresse', 'Lat', 'Lng', 'Description', 'Anecdote Historique'];
      const rows = route.steps.map(s => [
        `"${route.summary.title}"`, `"${route.summary.theme}"`, `"${route.summary.city}"`,
        s.stepNumber, `"${s.name}"`, `"${s.address}"`, s.lat, s.lng, `"${s.description}"`, `"${s.historyAnecdote || ''}"`
      ]);
      content = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      type = 'text/csv;charset=utf-8;';
    }

    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const openGoogleMaps = () => {
    if (route.steps.length < 2) return;
    const origin = `${route.steps[0].lat},${route.steps[0].lng}`;
    const destination = `${route.steps[route.steps.length - 1].lat},${route.steps[route.steps.length - 1].lng}`;
    let waypoints = "";
    if (route.steps.length > 2) {
      const intermediate = route.steps.slice(1, -1);
      waypoints = "&waypoints=" + intermediate.map(s => `${s.lat},${s.lng}`).join('|');
    }
    const url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypoints}&travelmode=walking`;
    window.open(url, '_blank');
  };

  const handleSaveToggle = () => {
      if (onSave && !localSaved) {
          onSave(route);
          setLocalSaved(true);
      }
  };

  return (
    <div className="animate-fade-in space-y-8" id="printable-content">
      
      {/* Header Result */}
      <div className="relative bg-nirmie-600 text-white p-8 rounded-3xl shadow-lg overflow-hidden no-print">
        <div className="absolute top-0 right-0 w-32 h-32 bg-white opacity-10 rounded-full -mr-10 -mt-10" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-black opacity-10 rounded-full -ml-10 -mb-10" />
        
        <div className="absolute top-6 left-6 flex items-center gap-3">
            <button onClick={onBack} className="p-2 bg-white/20 rounded-full hover:bg-white/30 transition-colors">
            <ArrowLeft className="w-5 h-5" />
            </button>
        </div>

        {onSave && (
            <button 
                onClick={handleSaveToggle}
                disabled={localSaved}
                className={`absolute top-6 right-6 px-4 py-2 rounded-full font-bold text-sm flex items-center gap-2 transition-all ${localSaved ? 'bg-white text-nirmie-600 cursor-default' : 'bg-nirmie-700 text-white hover:bg-nirmie-800'}`}
            >
                {localSaved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                {localSaved ? 'Sauvegardé' : 'Sauvegarder'}
            </button>
        )}

        <div className="relative z-10 text-center mt-6">
          <div className="flex justify-center mb-3">
             <span className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest border ${THEME_CHIPS[route.summary.theme || ''] || 'bg-white/10 text-white border-white/20'}`}>
               <Tag className="w-3.5 h-3.5" />
               {route.summary.theme || 'Exploration'}
             </span>
          </div>
          <h2 className="text-3xl font-bold mb-2 leading-tight">{route.summary.title}</h2>
          <div className="flex justify-center gap-6 mt-4 text-nirmie-50">
            <div className="flex items-center gap-2">
              <Map className="w-5 h-5" />
              <span className="font-medium">{route.summary.totalDistance}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              <span className="font-medium">{route.summary.estimatedDuration}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Timeline List */}
        <div className="lg:col-span-2 space-y-6">
          <h3 className="text-xl font-bold text-gray-800 px-2 no-print">Parcours détaillé</h3>
          
          <div className="relative space-y-0 before:absolute before:inset-0 before:ml-8 before:w-0.5 before:-translate-x-px before:bg-gray-200 before:h-full before:z-0">
            
            {route.steps.map((step, idx) => (
              <div key={idx} className="relative flex gap-6 z-10 group break-inside-avoid step-item">
                <div className="flex flex-col items-center">
                   <div className="w-16 h-16 rounded-full border-4 border-white shadow-md bg-nirmie-100 text-nirmie-600 flex items-center justify-center font-bold text-xl z-10 overflow-hidden relative print:border-gray-300">
                      {step.stepNumber}
                   </div>
                </div>
                
                <div className="flex-1 bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow mb-8 group-last:mb-0 print:border print:shadow-none print:mb-4">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div className="flex-1">
                      <h4 className="text-lg font-bold text-gray-800">{step.name}</h4>
                      <p className="text-sm text-gray-500 mb-3 font-medium">{step.category} • {step.address}</p>
                      <p className="text-gray-600 text-sm leading-relaxed mb-4">{step.description}</p>
                      
                      {/* Encart Anecdote Historique */}
                      {step.historyAnecdote && (
                        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 mt-2 relative overflow-hidden group/hist">
                           <div className="flex items-center gap-2 mb-2">
                              <History className="w-4 h-4 text-amber-600" />
                              <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">Histoire & Anecdote</span>
                           </div>
                           <p className="text-xs text-amber-900 leading-relaxed font-medium italic relative z-10">
                              "{step.historyAnecdote}"
                           </p>
                           <Quote className="absolute -bottom-2 -right-2 w-12 h-12 text-amber-100 -rotate-12 group-hover/hist:rotate-0 transition-transform" />
                        </div>
                      )}

                      <div className="mt-4 flex items-center gap-4 bg-gray-50 p-2 rounded-lg border border-gray-200 inline-flex no-print">
                        <div className="flex items-center gap-1.5 text-[10px] text-gray-400 font-mono">
                          <MapPin className="w-3 h-3 text-nirmie-400" />
                          <span>Lat: {step.lat?.toFixed(5)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-gray-400 font-mono">
                          <MapPin className="w-3 h-3 text-nirmie-400" />
                          <span>Lng: {step.lng?.toFixed(5)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="w-full md:w-24 h-24 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0 no-print border border-gray-100">
                       <img 
                          src={`https://picsum.photos/seed/${step.name.replace(/\s/g,'')}${idx}/200/200`} 
                          alt="Lieu"
                          className="w-full h-full object-cover opacity-90 hover:opacity-100 transition-opacity"
                       />
                    </div>
                  </div>
                </div>
              </div>
            ))}

          </div>
        </div>

        {/* Sidebar / Actions */}
        <div className="space-y-6">
          <div className="bg-white p-2 rounded-3xl shadow-sm border border-gray-100 h-80 relative overflow-hidden group z-0 print:h-96 print:border-2 print:border-gray-300 print:shadow-none" id="map-container">
            <div id="map" ref={mapRef} className="w-full h-full rounded-2xl z-0"></div>
          </div>

          <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 space-y-4 no-print">
             <button 
                onClick={openGoogleMaps}
                className="w-full py-4 bg-white border-2 border-nirmie-500 text-nirmie-600 font-bold rounded-xl hover:bg-nirmie-50 transition-colors flex items-center justify-center gap-2 group"
             >
               <ExternalLink className="w-5 h-5 group-hover:scale-110 transition-transform" />
               Naviguer avec Google Maps
             </button>

             <div className="h-px bg-gray-100 my-2"></div>

             <h3 className="font-bold text-gray-800 pt-2">Téléchargements</h3>
             <div className="grid grid-cols-1 gap-3">
               <button onClick={() => handleDownload('pdf')} className="flex items-center justify-center gap-2 w-full py-3 bg-red-50 text-red-600 font-bold rounded-xl hover:bg-red-100 transition-colors">
                  <Download className="w-4 h-4" /> PDF / Impression
               </button>
               <button onClick={() => handleDownload('csv')} className="flex items-center justify-center gap-2 w-full py-3 bg-green-50 text-green-700 font-bold rounded-xl hover:bg-green-100 transition-colors">
                  <FileSpreadsheet className="w-4 h-4" /> Export CSV (Excel)
               </button>
             </div>
          </div>
        </div>

      </div>
    </div>
  );
};
