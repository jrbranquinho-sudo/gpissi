/**
 * GPISSI - Location Provider (Agnóstico a Plataforma)
 * Suporta Capacitor (@capgo/background-geolocation), Cordova, ou Web Geolocation API
 * com Screen WakeLock e tratamento de precisão e velocidade.
 */
class LocationProvider {
  constructor(options = {}) {
    this.options = {
      desiredAccuracy: options.desiredAccuracy || 10, // metros
      distanceFilter: options.distanceFilter || 15,    // metros
      interval: options.interval || 10000,            // ms
      fastestInterval: options.fastestInterval || 5000,
      notificationTitle: options.notificationTitle || 'GPISSI - Telemetria na Estrada',
      notificationText: options.notificationText || 'Rastreamento GPS ativo em segundo plano.',
      ...options
    };

    this.isWatching = false;
    this.watchId = null;
    this.wakeLock = null;
    this.onLocationCallback = null;
    this.onErrorCallback = null;
  }

  isCapacitorNative() {
    return typeof window !== 'undefined' &&
      window.Capacitor &&
      typeof window.Capacitor.isNativePlatform === 'function' &&
      window.Capacitor.isNativePlatform();
  }

  async requestPermissions() {
    // 1. Capacitor Native Platform
    if (this.isCapacitorNative()) {
      try {
        const bgPlugin = window.Capacitor.Plugins?.BackgroundGeolocation;
        if (bgPlugin && typeof bgPlugin.requestPermissions === 'function') {
          const res = await bgPlugin.requestPermissions();
          return { granted: res.location === 'granted' || res.location === 'always' };
        }
      } catch (err) {
        console.warn('[LocationProvider] Erro ao solicitar permissões Capacitor:', err.message);
      }
    }

    // 2. Web Browser
    if (typeof navigator !== 'undefined' && navigator.permissions && navigator.permissions.query) {
      try {
        const status = await navigator.permissions.query({ name: 'geolocation' });
        return { granted: status.state === 'granted' || status.state === 'prompt' };
      } catch (_) {}
    }

    return { granted: typeof navigator !== 'undefined' && 'geolocation' in navigator };
  }

  async _acquireWakeLock() {
    try {
      if (typeof navigator !== 'undefined' && 'wakeLock' in navigator && !this.wakeLock) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => {
          this.wakeLock = null;
        });
      }
    } catch (_) {}
  }

  _releaseWakeLock() {
    if (this.wakeLock) {
      try {
        this.wakeLock.release();
      } catch (_) {}
      this.wakeLock = null;
    }
  }

  _normalizePosition(rawCoords, timestamp) {
    const lat = Number(rawCoords.latitude);
    const lng = Number(rawCoords.longitude);

    let speedMps = null;
    let speedKmh = null;

    if (rawCoords.speed != null && Number.isFinite(Number(rawCoords.speed)) && Number(rawCoords.speed) >= 0) {
      speedMps = parseFloat(Number(rawCoords.speed).toFixed(2));
      speedKmh = Math.round(speedMps * 3.6);
    }

    return {
      latitude: lat,
      longitude: lng,
      accuracy_m: rawCoords.accuracy != null ? Math.round(Number(rawCoords.accuracy)) : null,
      speed_mps: speedMps,
      speed_kmh: speedKmh,
      heading: rawCoords.heading != null && Number.isFinite(Number(rawCoords.heading)) && Number(rawCoords.heading) >= 0 ? Math.round(Number(rawCoords.heading)) : null,
      altitude: rawCoords.altitude != null && Number.isFinite(Number(rawCoords.altitude)) ? Math.round(Number(rawCoords.altitude)) : null,
      recorded_at: timestamp && !Number.isNaN(Date.parse(timestamp)) ? new Date(timestamp).toISOString() : new Date().toISOString()
    };
  }

  async startWatch(onLocation, onError) {
    this.onLocationCallback = onLocation;
    this.onErrorCallback = onError;
    this.isWatching = true;

    await this._acquireWakeLock();

    // 1. Capacitor Native Background Geolocation
    if (this.isCapacitorNative()) {
      const bgPlugin = window.Capacitor.Plugins?.BackgroundGeolocation;
      if (bgPlugin && typeof bgPlugin.addWatcher === 'function') {
        try {
          this.watchId = await bgPlugin.addWatcher(
            {
              backgroundMessage: this.options.notificationText,
              backgroundTitle: this.options.notificationTitle,
              requestPermissions: true,
              stale: false,
              distanceFilter: this.options.distanceFilter
            },
            (location, error) => {
              if (error) {
                if (this.onErrorCallback) this.onErrorCallback(error);
                return;
              }
              if (location && this.onLocationCallback) {
                const norm = this._normalizePosition(location, location.time ? new Date(location.time).toISOString() : new Date().toISOString());
                this.onLocationCallback(norm);
              }
            }
          );
          return;
        } catch (err) {
          console.warn('[LocationProvider] Fallback do plugin Capacitor para Web Geolocation:', err.message);
        }
      }
    }

    // 2. Web Browser Geolocation fallback
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      this.watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (!this.isWatching) return;
          const norm = this._normalizePosition(pos.coords, pos.timestamp);
          if (this.onLocationCallback) this.onLocationCallback(norm);
        },
        (err) => {
          console.warn('[LocationProvider] Erro de geolocalização:', err.message);
          if (this.onErrorCallback) this.onErrorCallback(err);
        },
        {
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 5000
        }
      );
    } else {
      const err = new Error('Geolocalização não é suportada neste ambiente.');
      if (this.onErrorCallback) this.onErrorCallback(err);
    }
  }

  stopWatch() {
    this.isWatching = false;
    this._releaseWakeLock();

    if (this.isCapacitorNative() && this.watchId) {
      const bgPlugin = window.Capacitor.Plugins?.BackgroundGeolocation;
      if (bgPlugin && typeof bgPlugin.removeWatcher === 'function') {
        try {
          bgPlugin.removeWatcher({ id: this.watchId });
        } catch (_) {}
      }
    }

    if (typeof navigator !== 'undefined' && 'geolocation' in navigator && this.watchId != null) {
      try {
        navigator.geolocation.clearWatch(this.watchId);
      } catch (_) {}
    }

    this.watchId = null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LocationProvider;
}
if (typeof window !== 'undefined') {
  window.LocationProvider = LocationProvider;
}
