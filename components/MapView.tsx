import React, { useEffect, useRef } from 'react';
import { POI, THEME_COLORS, PoiTheme } from '../types';

declare global {
  interface Window {
    L: any;
  }
}

interface Props {
  pois: POI[];
  /** Trace une ligne entre les points, dans l'ordre du tableau. */
  drawPath?: boolean;
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

    if (drawPath && points.length > 1) {
      const line = points.map((p) => [p.lat, p.lng] as [number, number]);
      if (loop) line.push(line[0]);
      window.L.polyline(line, { color: '#10b981', weight: 4, opacity: 0.85 }).addTo(layer);
    }

    const bounds = window.L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }, [pois, drawPath, loop, highlightId, onSelect]);

  // Recentrage sur le POI survolé, sans changer le niveau de zoom
  useEffect(() => {
    if (!highlightId || !mapRef.current) return;
    const poi = pois.find((p) => p.id === highlightId);
    if (poi) mapRef.current.panTo([poi.lat, poi.lng], { animate: true, duration: 0.4 });
  }, [highlightId, pois]);

  return <div ref={containerRef} className={`rounded-2xl z-0 ${className}`} />;
};
