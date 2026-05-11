const CACHE_TTL = 60 * 60 * 1000;

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
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_sum,precipitation_probability_max&current_weather=true&timezone=auto&forecast_days=7`;
    const res = await fetch(url);
    const raw = await res.json();

    const days = raw.daily.time.map((date, i) => ({
      date,
      maxTemp: Math.round(raw.daily.temperature_2m_max[i]),
      minTemp: Math.round(raw.daily.temperature_2m_min[i]),
      code: raw.daily.weathercode[i],
      icon: weatherIcon(raw.daily.weathercode[i]),
      precipitation: raw.daily.precipitation_sum[i],
      precip: raw.daily.precipitation_probability_max?.[i] ?? null,
      precipIsProb: true,
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

  const isPast = end < today;
  const baseUrl = isPast
    ? 'https://archive-api.open-meteo.com/v1/archive'
    : 'https://api.open-meteo.com/v1/forecast';
  const precipParam = isPast ? 'precipitation_sum' : 'precipitation_probability_max';

  try {
    const url = `${baseUrl}?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,weathercode,${precipParam}&start_date=${start}&end_date=${end}&timezone=auto`;
    const res = await fetch(url);
    const raw = await res.json();
    if (!raw.daily) return null;
    return raw.daily.time.map((date, i) => ({
      date,
      maxTemp: Math.round(raw.daily.temperature_2m_max[i]),
      minTemp: Math.round(raw.daily.temperature_2m_min[i]),
      icon: weatherIcon(raw.daily.weathercode[i]),
      precip: raw.daily[precipParam]?.[i] ?? null,
      precipIsProb: !isPast,
    }));
  } catch (_) {
    return null;
  }
}

export async function geocodeCity(city, countryHint) {
  if (!city) return null;
  const key = city.toLowerCase().trim();
  const cacheKey = `geo_${key.replace(/\s+/g, '_')}`;
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || '{}');
    if (cached.lat) return cached;
  } catch (_) {}

  const tryGeocode = async (q) => {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'ko,en' } });
      const data = await res.json();
      if (data.length > 0) {
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), name: data[0].display_name };
      }
    } catch (_) {}
    return null;
  };

  const alreadyHasCountry = countryHint && city.toLowerCase().includes(countryHint.toLowerCase());
  const withCountry = (q) => (countryHint && !alreadyHasCountry) ? `${q}, ${countryHint}` : q;

  let result = await tryGeocode(withCountry(city));
  if (!result && countryHint && !alreadyHasCountry) result = await tryGeocode(city);
  if (!result && city.includes(',')) {
    const parts = city.split(',').map(s => s.trim());
    for (let i = 1; i < parts.length - 1; i++) {
      result = await tryGeocode(withCountry(parts.slice(i).join(', ')));
      if (result) break;
    }
  }

  if (result) {
    localStorage.setItem(cacheKey, JSON.stringify(result));
    return result;
  }
  return null;
}
