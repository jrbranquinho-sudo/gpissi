// GPISSI - Location & GPS Telemetry Service (Android & iOS)
// Coleta coordenadas, velocidade, precisão e geocodificação reversa

import * as Location from 'expo-location';

let locationSubscription = null;

/**
 * Solicita permissões de localização (Primeiro Plano e Segundo Plano)
 */
export async function requestLocationPermissions() {
  try {
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== 'granted') {
      return { granted: false, error: 'Permissão de localização em primeiro plano foi negada.' };
    }

    return { granted: true };
  } catch (err) {
    return { granted: false, error: err.message };
  }
}

/**
 * Obtém a posição atual em alta precisão
 */
export async function getCurrentPosition() {
  try {
    const perm = await requestLocationPermissions();
    if (!perm.granted) {
      throw new Error(perm.error || 'Permissão de GPS necessária.');
    }

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    const { latitude, longitude, speed, altitude, accuracy } = pos.coords;

    // Converte velocidade de m/s para km/h (evita números negativos em repouso)
    const speedKmH = speed != null && speed > 0 ? Math.round(speed * 3.6) : 0;

    // Tenta resolver a cidade nativamente
    let cityName = 'Em trânsito na Rodovia';
    try {
      const geo = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (geo && geo.length > 0) {
        const place = geo[0];
        const city = place.subregion || place.city || place.district || place.region;
        const state = place.region || '';
        if (city) {
          cityName = state && !city.includes(state) ? `${city} - ${state}` : city;
        }
      }
    } catch (e) {
      // Ignora erro de geocode se offline
    }

    return {
      lat: latitude,
      lng: longitude,
      speedKmH,
      altitude: altitude ? Math.round(altitude) : 0,
      accuracy: accuracy ? Math.round(accuracy) : 0,
      cidade: cityName,
      timestamp: new Date(pos.timestamp).toISOString(),
    };
  } catch (err) {
    console.warn('[GPISSI Location] Erro ao obter posição:', err.message);
    throw err;
  }
}

/**
 * Inicia monitoramento contínuo de GPS na estrada
 * Aciona callback sempre que houver deslocamento significativo (ex: 20 metros ou 10 segundos)
 */
export async function startLocationWatch(onLocation, onError) {
  try {
    const perm = await requestLocationPermissions();
    if (!perm.granted) {
      if (onError) onError(new Error(perm.error));
      return null;
    }

    if (locationSubscription) {
      locationSubscription.remove();
      locationSubscription = null;
    }

    locationSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 10000,     // a cada 10 segundos
        distanceInterval: 25,    // ou a cada 25 metros percorridos
      },
      async (pos) => {
        const { latitude, longitude, speed, altitude, accuracy } = pos.coords;
        const speedKmH = speed != null && speed > 0 ? Math.round(speed * 3.6) : 0;

        let cityName = 'Em trânsito na Rodovia';
        try {
          const geo = await Location.reverseGeocodeAsync({ latitude, longitude });
          if (geo && geo.length > 0) {
            const place = geo[0];
            const city = place.subregion || place.city || place.district;
            const state = place.region;
            if (city) cityName = state ? `${city} - ${state}` : city;
          }
        } catch (e) {
          // offline
        }

        if (onLocation) {
          onLocation({
            lat: latitude,
            lng: longitude,
            speedKmH,
            altitude: altitude ? Math.round(altitude) : 0,
            accuracy: accuracy ? Math.round(accuracy) : 0,
            cidade: cityName,
            timestamp: new Date(pos.timestamp).toISOString(),
          });
        }
      }
    );

    return locationSubscription;
  } catch (err) {
    if (onError) onError(err);
    return null;
  }
}

/**
 * Para o monitoramento de GPS
 */
export function stopLocationWatch() {
  if (locationSubscription) {
    locationSubscription.remove();
    locationSubscription = null;
  }
}
