import { geocodeCity } from './weather.js';

function geoCache(location) {
  const key = `geo_${location.toLowerCase().trim().replace(/\s+/g, '_')}`;
  try { const c = JSON.parse(localStorage.getItem(key) || '{}'); return c.lat ? c : null; } catch(_) { return null; }
}

export async function calcMileageDetail(itineraryItems) {
  const sorted = [...itineraryItems]
    .filter(i => i.location && i.location.trim())
    .sort((a, b) => `${a.date}T${a.time || ''}`.localeCompare(`${b.date}T${b.time || ''}`));

  const unique = sorted.filter((p, i) => i === 0 || p.location !== sorted[i - 1].location);

  if (unique.length < 2) return { total: 0, segments: [] };

  // Geocode sequentially to respect Nominatim 1-req/s rate limit.
  // Stored lat/lng (set at save time) skips network entirely.
  const coords = [];
  for (const p of unique) {
    if (p.lat && p.lng) {
      coords.push({ lat: p.lat, lng: p.lng });
    } else {
      const cached = geoCache(p.location);
      if (cached) {
        coords.push(cached);
      } else {
        coords.push(await geocodeCity(p.location));
        await new Promise(r => setTimeout(r, 1100)); // rate-limit gap
      }
    }
  }

  let total = 0;
  const segments = [];
  for (let i = 1; i < unique.length; i++) {
    const a = coords[i - 1], b = coords[i];
    if (!a || !b) {
      segments.push({ from: unique[i - 1].location, to: unique[i].location, km: null, geocodeFailed: true });
      continue;
    }
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
