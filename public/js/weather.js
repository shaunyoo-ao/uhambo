const CACHE_TTL = 60 * 60 * 1000; // 1h

const WMO_ICONS = {
  0:  '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
  45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌦️',
  61: '🌧️', 63: '🌧️', 65: '🌧️',
  71: '🌨️', 73: '🌨️', 75: '🌨️',
  77: '🌨️',
  80: '🌦️', 81: '🌦️', 82: '⛈️',
  85: '🌨️', 86: '🌨️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
};

export function weatherIcon(code) {
  return WMO_ICONS[code] || '🌡️';
}

export async function getWeather(lat, lng) {
  if (!lat || !lng) return null;

  const cacheKey = `wx_${lat.toFixed(2)}_${lng.toFixed(2)}`;
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || '{}');
    if (cached.ts && Date.now() - cached.ts < CACHE_TTL && cached.data) {
      return cached.data;
    }
  } catch (_) {}

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_sum&current_weather=true&timezone=auto&forecast_days=7`;
    const res = await fetch(url);
    const raw = await res.json();

    const days = raw.daily.time.map((date, i) => ({
      date,
      maxTemp: Math.round(raw.daily.temperature_2m_max[i]),
      minTemp: Math.round(raw.daily.temperature_2m_min[i]),
      code: raw.daily.weathercode[i],
      icon: weatherIcon(raw.daily.weathercode[i]),
      precipitation: raw.daily.precipitation_sum[i],
    }));

    const current = raw.current_weather ? {
      temp: Math.round(raw.current_weather.temperature),
      code: raw.current_weather.weathercode,
      icon: weatherIcon(raw.current_weather.weathercode),
    } : null;

    const data = { days, current };
    sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data }));
    return data;
  } catch (e) {
    console.warn('Weather fetch failed:', e);
    return null;
  }
}

export async function getTripWeather(lat, lng, startDate, endDate) {
  if (!lat || !lng) return null;
  const today = new Date().toISOString().slice(0, 10);
  const start = startDate || today;
  const end   = endDate   || new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);

  const baseUrl = end < today
    ? 'https://archive-api.open-meteo.com/v1/archive'
    : 'https://api.open-meteo.com/v1/forecast';

  try {
    const url = `${baseUrl}?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,weathercode&start_date=${start}&end_date=${end}&timezone=auto`;
    const res = await fetch(url);
    const raw = await res.json();
    if (!raw.daily) return null;
    return raw.daily.time.map((date, i) => ({
      date,
      maxTemp: Math.round(raw.daily.temperature_2m_max[i]),
      minTemp: Math.round(raw.daily.temperature_2m_min[i]),
      icon: weatherIcon(raw.daily.weathercode[i]),
    }));
  } catch (_) {
    return null;
  }
}

// Geocode a city name to lat/lng via Nominatim (OpenStreetMap, free)
export async function geocodeCity(city) {
  if (!city) return null;
  const cacheKey = `geo_${city.toLowerCase().replace(/\s+/g, '_')}`;
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || '{}');
    if (cached.lat) return cached;
  } catch (_) {}

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();
    if (data.length > 0) {
      const result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), name: data[0].display_name };
      localStorage.setItem(cacheKey, JSON.stringify(result));
      return result;
    }
  } catch (_) {}
  return null;
}
