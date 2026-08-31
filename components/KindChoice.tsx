import React from 'react';
import { ArrowRight, Clock, Footprints, Landmark, MapPin, Repeat, Sparkles } from 'lucide-react';
import { RouteKind } from '../types';

interface Props {
  onChoose: (kind: RouteKind) => void;
}

const OPTIONS: {
  kind: RouteKind;
  title: string;
  tagline: string;
  description: string;
  points: { icon: React.ReactNode; text: string }[];
  accent: string;
  icon: React.ReactNode;
}[] = [
  {
    kind: 'tour',
    title: 'Parcours touristique',
    tagline: 'Les lieux commandent',
    description:
      "On relève tous les lieux touristiques de la ville, vous choisissez ceux à retenir, et le générateur les enchaîne en parcours de visite.",
    points: [
      { icon: <MapPin className="w-3.5 h-3.5" />, text: 'Des arrêts précis, avec temps de visite' },
      { icon: <Sparkles className="w-3.5 h-3.5" />, text: 'Descriptions et anecdotes par étape' },
      { icon: <Landmark className="w-3.5 h-3.5" />, text: "Inventaire complet avant de composer" },
    ],
    accent: 'nirmie',
    icon: <Landmark className="w-7 h-7" />,
  },
  {
    kind: 'free',
    title: 'Parcours libre',
    tagline: 'La distance commande',
    description:
      "Vous donnez une distance et un point de départ, le générateur trace une boucle de cette longueur par les rues et les chemins. Aucun arrêt imposé.",
    points: [
      { icon: <Footprints className="w-3.5 h-3.5" />, text: 'Balade, footing, sortie vélo' },
      { icon: <Repeat className="w-3.5 h-3.5" />, text: 'Boucle qui revient au départ' },
      { icon: <Clock className="w-3.5 h-3.5" />, text: "Durée = temps d'effort, sans visite" },
    ],
    accent: 'blue',
    icon: <Repeat className="w-7 h-7" />,
  },
];

export const KindChoice: React.FC<Props> = ({ onChoose }) => (
  <div className="max-w-4xl mx-auto space-y-10 animate-fade-in">
    <div className="text-center space-y-3">
      <h2 className="text-4xl font-extrabold text-gray-900 tracking-tight">
        Quel type de parcours&nbsp;?
      </h2>
      <p className="text-gray-500 leading-relaxed max-w-xl mx-auto">
        Deux familles, deux logiques. Vous pourrez changer d'avis à tout moment.
      </p>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {OPTIONS.map((option) => {
        const isTour = option.accent === 'nirmie';
        return (
          <button
            key={option.kind}
            onClick={() => onChoose(option.kind)}
            className={`text-left bg-white p-7 rounded-3xl border-2 transition-all group shadow-sm hover:shadow-md ${
              isTour
                ? 'border-nirmie-100 hover:border-nirmie-500'
                : 'border-blue-100 hover:border-blue-500'
            }`}
          >
            <div
              className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-5 text-white ${
                isTour ? 'bg-nirmie-500' : 'bg-blue-500'
              }`}
            >
              {option.icon}
            </div>

            <p
              className={`text-[10px] font-black uppercase tracking-widest mb-1 ${
                isTour ? 'text-nirmie-600' : 'text-blue-600'
              }`}
            >
              {option.tagline}
            </p>
            <h3 className="text-2xl font-extrabold text-gray-900 mb-3">{option.title}</h3>
            <p className="text-sm text-gray-500 leading-relaxed mb-5">{option.description}</p>

            <ul className="space-y-2 mb-6">
              {option.points.map((point) => (
                <li key={point.text} className="flex items-center gap-2 text-xs text-gray-600">
                  <span className={isTour ? 'text-nirmie-500' : 'text-blue-500'}>
                    {point.icon}
                  </span>
                  {point.text}
                </li>
              ))}
            </ul>

            <span
              className={`inline-flex items-center gap-2 text-sm font-bold ${
                isTour ? 'text-nirmie-600' : 'text-blue-600'
              }`}
            >
              Choisir
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </span>
          </button>
        );
      })}
    </div>
  </div>
);
