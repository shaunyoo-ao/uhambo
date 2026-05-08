// Lazy-load OpenLayers from CDN only when a map is first needed
const OL_CSS = 'https://cdn.jsdelivr.net/npm/ol@9.2.4/ol.css';
const OL_JS  = 'https://cdn.jsdelivr.net/npm/ol@9.2.4/dist/ol.js';

let _olLoaded = false;

async function loadOL() {
  if (_olLoaded) return;
  if (!document.querySelector(`link[href="${OL_CSS}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = OL_CSS;
    document.head.appendChild(link);
  }
  if (!window.ol) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = OL_JS;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  _olLoaded = true;
}

export async function initMap(containerId, lat = 37.5665, lng = 126.978, zoom = 12) {
  await loadOL();
  const { Map, View } = window.ol;
  const TileLayer = window.ol.layer.Tile;
  const OSM = window.ol.source.OSM;
  const { fromLonLat } = window.ol.proj;

  const map = new Map({
    target: containerId,
    layers: [new TileLayer({ source: new OSM() })],
    view: new View({
      center: fromLonLat([lng, lat]),
      zoom,
    }),
    controls: [],
  });
  return map;
}

export function addMarker(map, lat, lng, label = '') {
  const { Feature } = window.ol;
  const { Point } = window.ol.geom;
  const { Vector: VectorLayer } = window.ol.layer;
  const { Vector: VectorSource } = window.ol.source;
  const { Style, Icon, Text, Fill, Stroke } = window.ol.style;
  const { fromLonLat } = window.ol.proj;

  const feature = new Feature({ geometry: new Point(fromLonLat([lng, lat])) });
  feature.setStyle(new Style({
    image: new Icon({
      src: 'data:image/svg+xml;utf8,' + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32">
          <path fill="#ee6c3a" d="M12 0C7.6 0 4 3.6 4 8c0 5.4 8 16 8 16s8-10.6 8-16c0-4.4-3.6-8-8-8z"/>
          <circle fill="#0c0d0f" cx="12" cy="8" r="3"/>
        </svg>`
      ),
      anchor: [0.5, 1],
      anchorXUnits: 'fraction',
      anchorYUnits: 'fraction',
    }),
    text: label ? new Text({
      text: label,
      offsetY: -38,
      font: '12px sans-serif',
      fill: new Fill({ color: '#f3f0ea' }),
      stroke: new Stroke({ color: '#0c0d0f', width: 3 }),
    }) : null,
  }));

  const source = new VectorSource({ features: [feature] });
  const layer = new VectorLayer({ source });
  map.addLayer(layer);
  return feature;
}

export function setMapCenter(map, lat, lng, zoom) {
  const { fromLonLat } = window.ol.proj;
  const view = map.getView();
  view.setCenter(fromLonLat([lng, lat]));
  if (zoom) view.setZoom(zoom);
}

export function destroyMap(map) {
  if (map) map.setTarget(null);
}
