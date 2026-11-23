// Photon returns GeoJSON Point coordinates in longitude, latitude order.
const resultLimit = 5;
const cacheLimit = 256;
const cacheTtl = 30 * 60_000;

export class PlaceSearchError extends Error {
  constructor(status, message, retryAfter = 0) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function results(data) {
  if (!Array.isArray(data?.features)) {
    throw new PlaceSearchError(503, 'Сервис поиска адресов вернул неполный ответ. Укажите точку вручную.');
  }
  const places = [];
  const seen = new Set();
  for (const feature of data.features) {
    if (feature?.geometry?.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) continue;
    const [lon, lat] = feature.geometry.coordinates;
    if (!Number.isFinite(lon) || Math.abs(lon) > 180 || !Number.isFinite(lat) || Math.abs(lat) > 90) continue;
    const p = feature.properties ?? {};
    const street = [p.street, p.housenumber].filter(Boolean).join(' ');
    const parts = [p.city || p.district, street, p.name, p.state, p.country]
      .filter(value => typeof value === 'string' && value.trim()).map(value => value.trim());
    const label = [...new Set(parts)].join(', ');
    const key = JSON.stringify([label, lat, lon]);
    if (!label || seen.has(key)) continue;
    seen.add(key);
    places.push({ label, lat, lon });
    if (places.length === resultLimit) break;
  }
  return places;
}

export function createPlaceSearch(settings, { fetchImpl = fetch, now = Date.now } = {}) {
  const cache = new Map();
  const pending = new Map();
  let nextRequest = 0;

  async function lookup(query) {
    const url = new URL(settings.url);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(resultLimit));
    const signal = AbortSignal.timeout(settings.timeoutMs);
    try {
      const response = await fetchImpl(url, {
        signal, headers: { Accept: 'application/json', 'User-Agent': 'Farvater/0.1 (operator address search)' },
      });
      if (response.status === 429) {
        const seconds = Number(response.headers.get('retry-after')) || 30;
        const pause = Math.min(3600, Math.max(1, Math.ceil(seconds)));
        nextRequest = Math.max(nextRequest, now() + pause * 1000);
        throw new PlaceSearchError(429, 'Сервис адресов временно ограничил частоту поиска. Повторите позже.', pause);
      }
      if (!response.ok) throw new Error('upstream');
      return results(await response.json());
    } catch (error) {
      if (error instanceof PlaceSearchError) throw error;
      if (signal.aborted) throw new PlaceSearchError(504, 'Поиск адреса занял слишком много времени. Повторите запрос или поставьте точку вручную.');
      throw new PlaceSearchError(503, 'Сервис поиска адресов временно недоступен. Можно поставить точку вручную.');
    }
  }

  return async function search(text) {
    if (!settings.enabled) throw new PlaceSearchError(503, 'Поиск адресов отключён. Укажите точку на карте вручную.');
    const query = text.trim().replace(/\s+/g,' ');
    const key = query.toLowerCase();
    const timestamp = now();
    const hit = cache.get(key);
    if (hit && hit.until > timestamp) return hit.places;
    if (pending.has(key)) return pending.get(key);
    if (timestamp < nextRequest) {
      throw new PlaceSearchError(429, 'Слишком частые запросы адреса. Повторите чуть позже.', Math.ceil((nextRequest - timestamp) / 1000));
    }
    nextRequest = timestamp + settings.minIntervalMs;
    const request = lookup(query).then(places => {
      cache.delete(key);
      if (cache.size >= cacheLimit) cache.delete(cache.keys().next().value);
      cache.set(key, { places, until: now() + cacheTtl });
      return places;
    }).finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };
}
