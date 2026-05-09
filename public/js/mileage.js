import { geocodeCity } from './weather.js';

export async function calcMileage(itineraryItems) {
  // Sort by date+time, keep items that have a location string
  const sorted = [...itineraryItems]
    .filter(i => i.location && i.location.trim())
    .sort((a, b) => `${a.date}T${a.time || ''}`.localeCompare(`${b.date}T${b.time || ''}`));

  // Deduplicate consecutive identical locations
  const unique = sorted.filter((p, i) => i === 0 || p.location !== sorted[i - 1].location);

  if (unique.length < 2) return 0;

  // Geocode all locations
  const coords = await Promise.all(unique.map(p => geocodeCity(p.location)));

  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i];
    if (!a || !b) continue;
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.code === 'Ok' && data.routes?.[0]) {
        total += data.routes[0].distance;
      } else {
        total += haversine(a.lat, a.lng, b.lat, b.lng) * 1000;
      }
    } catch (_) {
      total += haversine(a.lat, a.lng, b.lat, b.lng) * 1000;
    }
  }
  return Math.round(total / 1000);
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
