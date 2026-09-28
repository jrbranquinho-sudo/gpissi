function isValidCoordinate(lat, lng) {
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) &&
    Number(lat) >= -90 && Number(lat) <= 90 && Number(lng) >= -180 && Number(lng) <= 180;
}

function extractMunicipality(address = {}) {
  const city = address.city || address.town || address.village || address.municipality || address.county;
  if (!city) return '';
  const state = address['ISO3166-2-lvl4']?.split('-').pop() || address.state_code || '';
  return state ? `${city} - ${state}` : city;
}

function buildTrackFeature(checkins = []) {
  const coordinates = checkins
    .filter(point => isValidCoordinate(point.lat, point.lng))
    .map(point => [Number(point.lng), Number(point.lat)]);
  if (coordinates.length < 2) return null;
  return {
    type: 'Feature',
    properties: { kind: 'recorded-track' },
    geometry: { type: 'LineString', coordinates }
  };
}

function buildGpsCheckin({ lat, lng, timestamp, description, city, reverseGeocodedCity }, previousCity) {
  const isPassage = Boolean(reverseGeocodedCity && reverseGeocodedCity !== previousCity);
  const parsedTimestamp = timestamp && !Number.isNaN(Date.parse(timestamp)) ? new Date(timestamp).toISOString() : new Date().toISOString();
  return {
    timestamp: parsedTimestamp,
    lat: Number(lat),
    lng: Number(lng),
    descricao: isPassage ? `Passagem por ${reverseGeocodedCity}` : (description || 'Ponto GPS no trajeto'),
    cidade: reverseGeocodedCity || city || 'Localização GPS',
    tipo: isPassage ? 'city_passage' : 'gps'
  };
}

const gpsUtils = { isValidCoordinate, extractMunicipality, buildTrackFeature, buildGpsCheckin };

if (typeof module !== 'undefined' && module.exports) module.exports = gpsUtils;
if (typeof globalThis !== 'undefined') globalThis.GPISSIGps = gpsUtils;