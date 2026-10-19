/**
 * GPISSI - Tracking Offline Persistent Queue
 * Armazena pontos de GPS localmente no dispositivo (IndexedDB / localStorage)
 * com deduplicação por point_uid, persistência resiliente e sincronização em lote.
 */
class TrackingQueue {
  constructor(storageKey = 'gpissi_tracking_queue_v1') {
    this.storageKey = storageKey;
    this.maxQueueSize = 5000;
    this.points = this._loadLocal();
  }

  _loadLocal() {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(this.storageKey);
        if (raw) {
          const list = JSON.parse(raw);
          return Array.isArray(list) ? list : [];
        }
      }
    } catch (e) {
      console.warn('[TrackingQueue] Falha ao carregar fila local:', e.message);
    }
    return [];
  }

  _persistLocal() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(this.points));
      }
    } catch (e) {
      console.warn('[TrackingQueue] Falha ao persistir fila local:', e.message);
      // Se estourar a cota de armazenamento, descarta os pontos mais antigos (FIFO)
      if (this.points.length > 200) {
        this.points = this.points.slice(-Math.floor(this.points.length / 2));
        try {
          localStorage.setItem(this.storageKey, JSON.stringify(this.points));
        } catch (_) {}
      }
    }
  }

  /**
   * Adiciona um ponto de localização à fila persistente
   */
  enqueue(point) {
    if (!point || typeof point.latitude !== 'number' || typeof point.longitude !== 'number') {
      return null;
    }

    const uid = point.point_uid || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'pt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9));

    // Deduplicação na fila local
    if (this.points.some(p => p.point_uid === uid)) {
      return null;
    }

    const item = {
      point_uid: uid,
      viagem_id: point.viagem_id,
      session_id: point.session_id || '',
      latitude: point.latitude,
      longitude: point.longitude,
      accuracy_m: point.accuracy_m != null ? point.accuracy_m : null,
      speed_mps: point.speed_mps != null ? point.speed_mps : null,
      speed_kmh: point.speed_kmh != null ? point.speed_kmh : null,
      heading: point.heading != null ? point.heading : null,
      altitude: point.altitude != null ? point.altitude : null,
      recorded_at: point.recorded_at || new Date().toISOString(),
      cidade: point.cidade || '',
      attempts: 0,
      enqueued_at: new Date().toISOString()
    };

    if (this.points.length >= this.maxQueueSize) {
      this.points.shift(); // descarta o ponto mais antigo se atingir o teto
    }

    this.points.push(item);
    this._persistLocal();
    return item;
  }

  /**
   * Retorna os N primeiros pontos pendentes sem removê-los
   */
  peek(limit = 100) {
    return this.points.slice(0, limit);
  }

  /**
   * Remove pontos da fila apenas após confirmação do servidor
   */
  remove(pointUids = []) {
    if (!Array.isArray(pointUids) || pointUids.length === 0) return 0;
    const set = new Set(pointUids);
    const initial = this.points.length;
    this.points = this.points.filter(p => !set.has(p.point_uid));
    const removed = initial - this.points.length;
    if (removed > 0) {
      this._persistLocal();
    }
    return removed;
  }

  size() {
    return this.points.length;
  }

  clear() {
    this.points = [];
    this._persistLocal();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TrackingQueue;
}
if (typeof window !== 'undefined') {
  window.TrackingQueue = TrackingQueue;
}
