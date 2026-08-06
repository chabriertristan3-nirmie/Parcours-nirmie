import React, { useEffect, useRef } from 'react';
import { PathPoint, POI, THEME_COLORS, PoiTheme } from '../types';

declare global {
  interface Window {
    L: any;
  }
}

interface Props {
  pois: POI[];
  /** Numérote les marqueurs et relie les points. */
  drawPath?: boolean;
  /**
   * Tracé réel à dessiner. Absent, les points sont reliés en ligne droite.
   */
  path?: PathPoint[];
  loop?: boolean;
  /** POI mis en avant (survol dans la liste). */
  highlightId?: string | null;
  className?: string;
  onSelect?: (poi: POI) => void;
}

const markerHtml = (poi: POI, index: number | null, highlighted: boolean) => {
  const color = THEME_COLORS[poi.theme as PoiTheme] || '#10b981';
  const size = highlighted ? 30 : index !== null ? 26 : 14;
  const label = index !== null ? `<span style="font-size:12px">${index}</span>` : '';
  return `<div style="
    width:${size}px;height:${size}px;border-radius:50%;
    background:${color};border:2px solid #fff;
    box-shadow:0 1px 4px rgba(0,0,0,.4);
    display:flex;align-items:center;justify-content:center;
    color:#fff;font-weight:700;line-height:1;
    transform:${highlighted ? 'scale(1.15)' : 'none'};
  ">${label}</div>`;
};

/**
 * Carte OpenStreetMap partagée par l'inventaire et la fiche parcours.
 * Leaflet est chargé par index.html, on le pilote directement.
 */
export const MapView: React.FC<Props> = ({
  pois,
  drawPath = false,
  path,
  loop = false,
  highlightId = null,
  className = '',
  onSelect,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);

  // Création / destruction de la carte
  useEffect(() => {
    if (!containerRef.current || mapRef.current || !window.L) return;

    const map = window.L.map(containerRef.current, { scrollWheelZoom: false }).setView(
      [48.8566, 2.3522],
      13
    );
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = window.L.layerGroup().addTo(map);

    // Le conteneur est souvent encore en train de se dimensionner au montage.
    setTimeout(() => map.invalidateSize(), 200);

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Redessin des marqueurs
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer || !window.L) return;

    layer.clearLayers();
    const points = pois.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (points.length === 0) return;

    points.forEach((poi, i) => {
      const highlighted = poi.id === highlightId;
      const icon = window.L.divIcon({
        html: markerHtml(poi, drawPath ? i + 1 : null, highlighted),
        className: 'nirmie-marker',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      const marker = window.L.marker([poi.lat, poi.lng], {
        icon,
        zIndexOffset: highlighted ? 1000 : 0,
      }).addTo(layer);
      marker.bindPopup(
        `<b>${drawPath ? `${i + 1}. ` : ''}${poi.name}</b><br><span style="color:#666">${poi.subtype}</span>`
      );
      if (onSelect) marker.on('click', () => onSelect(poi));
    });

    // Le tracé réel suit les rues ; sans lui, on relie les arrêts en direct.
    let line: [number, number][] = [];
    if (path && path.length > 1) {
      line = path.map((p) => [p[0], p[1]] as [number, number]);
    } else if (drawPath && points.length > 1) {
      line = points.map((p) => [p.lat, p.lng] as [number, number]);
      if (loop) line.push(line[0]);
    }

    if (line.length > 1) {
      // Un liseré blanc sous le tracé le garde lisible sur fond de carte chargé.
      window.L.polyline(line, { color: '#ffffff', weight: 7, opacity: 0.9 }).addTo(layer);
      window.L.polyline(line, { color: '#10b981', weight: 4, opacity: 1 }).addTo(layer);
    }

    const bounds = window.L.latLngBounds(
      line.length > 1 ? line : points.map((p) => [p.lat, p.lng])
    );
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }, [pois, drawPath, path, loop, highlightId, onSelect]);

  // Recentrage sur le POI survolé, sans changer le niveau de zoom
  useEffect(() => {
    if (!highlightId || !mapRef.current) return;
    const poi = pois.find((p) => p.id === highlightId);
    if (poi) mapRef.current.panTo([poi.lat, poi.lng], { animate: true, duration: 0.4 });
  }, [highlightId, pois]);

  return <div ref={containerRef} className={`rounded-2xl z-0 ${className}`} />;
};
