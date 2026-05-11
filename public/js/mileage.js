import { geocodeCity } from './weather.js';

export async function calcMileageDetail(itineraryItems) {
  const sorted = [...itineraryItems]
    .filter(i => i.location && i.location.trim())
    .sort((a, b) => `${a.date}T${a.time || ''}`.localeCompare(`${b.date}T${b.time || ''}`));

  const unique = sorted.filter((p, i) => i === 0 || p.location !== sorted[i - 1].location);

  if (unique.length < 2) return { total: 0, segments: [] };

  const coords = await Promise.all(unique.map(p => geocodeCity(p.location)));

  let total = 0;
  const segments = [];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i];
    if (!a || !b) continue;
    let km = 0;
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.code === 'Ok' && data.routes?.[0]) {
        km = Math.round(data.routes[0].distance / 1000);
      } else {
        km = Math.round(haversine(a.lat, a.lng, b.lat, b.lng));
      }
    } catch (_) {
      km = Math.round(haversine(a.lat, a.lng, b.lat, b.lng));
    }
    total += km;
    segments.push({ from: unique[i - 1].location, to: unique[i].location, km });
  }
  return { total, segments };
}

export async function calcMileage(itineraryItems) {
  const { total } = await calcMileageDetail(itineraryItems);
  return total;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
