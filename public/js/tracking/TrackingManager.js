/**
 * GPISSI - Unified Background Tracking Manager
 * Orquestrador principal de telemetria GPS em segundo plano.
 * Integra LocationProvider, TrackingQueue, TrackingApi e TrackingStatus.
 */
class TrackingManager {
  constructor(options = {}) {
    this.options = {
      syncBatchSize: options.syncBatchSize || 25,
      syncIntervalMs: options.syncIntervalMs || 10000,
      maxBackoffMs: options.maxBackoffMs || 60000,
      baseUrl: options.baseUrl || '',
      ...options
    };

    const StatusEnum = typeof TrackingStatus !== 'undefined' ? TrackingStatus : {
      IDLE: 'IDLE',
      STARTING: 'STARTING',
      TRACKING: 'TRACKING',
      PAUSED: 'PAUSED',
      SYNC_PENDING: 'SYNC_PENDING',
      STOPPING: 'STOPPING',
      STOPPED: 'STOPPED',
      ERROR: 'ERROR'
    };

    this.Status = StatusEnum;
    this.status = this.Status.IDLE;
    this.currentTripId = null;
    this.currentSessionId = null;
    this.credentials = {};
    this.listeners = new Map();

    const ApiClass = typeof TrackingApi !== 'undefined' ? TrackingApi : require('./TrackingApi');
    const QueueClass = typeof TrackingQueue !== 'undefined' ? TrackingQueue : require('./TrackingQueue');
    const ProviderClass = typeof LocationProvider !== 'undefined' ? LocationProvider : require('./LocationProvider');

    this.api = new ApiClass(this.options.baseUrl);
    this.queue = new QueueClass('gpissi_tracking_queue_' + (options.storageSuffix || 'default'));
    this.provider = new ProviderClass(options);

    this.syncTimer = null;
    this.backoffMs = 2000;
    this.isSyncing = false;
    this.lastLocation = null;

    this._restoreActiveSession();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (!this.listeners.has(event)) return;
    this.listeners.set(event, this.listeners.get(event).filter(cb => cb !== callback));
  }

  emit(event, data) {
    if (!this.listeners.has(event)) return;
    this.listeners.get(event).forEach(cb => {
      try { cb(data); } catch (e) { console.warn('[TrackingManager] Listener error:', e); }
    });
  }

  _setStatus(newStatus) {
    this.status = newStatus;
    this.emit('statusChange', { status: this.status, tripId: this.currentTripId, sessionId: this.currentSessionId });
    this._persistActiveSession();
  }

  _persistActiveSession() {
    try {
      if (typeof localStorage !== 'undefined') {
        if (this.status === this.Status.TRACKING || this.status === this.Status.PAUSED) {
          localStorage.setItem('gpissi_active_tracking_session', JSON.stringify({
            tripId: this.currentTripId,
            sessionId: this.currentSessionId,
            credentials: this.credentials,
            status: this.status,
            updatedAt: new Date().toISOString()
          }));
        } else {
          localStorage.removeItem('gpissi_active_tracking_session');
        }
      }
    } catch (_) {}
  }

  _restoreActiveSession() {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem('gpissi_active_tracking_session');
        if (raw) {
          const sess = JSON.parse(raw);
          if (sess && sess.tripId) {
            this.currentTripId = sess.tripId;
            this.currentSessionId = sess.sessionId;
            this.credentials = sess.credentials || {};
            // Não inicia provider automaticamente sem ação explícita, mas restaura contexto
            this.status = sess.status || this.Status.IDLE;
          }
        }
      }
    } catch (_) {}
  }

  /**
   * Inicia rastreamento de GPS para uma viagem
   */
  async start(tripId, credentials = {}, options = {}) {
    if (!tripId) throw new Error('ID da viagem é obrigatório.');
    if (this.status === this.Status.TRACKING && this.currentTripId === tripId) {
      return { alreadyRunning: true, sessionId: this.currentSessionId };
    }

    this.currentTripId = tripId;
    this.credentials = credentials;
    this._setStatus(this.Status.STARTING);

    try {
      // 1. Notifica o backend
      const res = await this.api.start(tripId, credentials, options);
      this.currentSessionId = res.session?.id || crypto.randomUUID();

      // 2. Inicia o LocationProvider
      await this.provider.startWatch(
        (location) => this._handleNewLocation(location),
        (error) => this._handleLocationError(error)
      );

      this._setStatus(this.Status.TRACKING);

      // 3. Inicia o loop de sincronização periódica
      this._startSyncLoop();

      return { success: true, sessionId: this.currentSessionId };
    } catch (err) {
      this._setStatus(this.Status.ERROR);
      throw err;
    }
  }

  _handleNewLocation(location) {
    if (this.status !== this.Status.TRACKING) return;

    this.lastLocation = location;
    this.emit('locationUpdate', location);

    // Enfileira na fila offline persistente
    this.queue.enqueue({
      viagem_id: this.currentTripId,
      session_id: this.currentSessionId,
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy_m: location.accuracy_m,
      speed_mps: location.speed_mps,
      speed_kmh: location.speed_kmh,
      heading: location.heading,
      altitude: location.altitude,
      recorded_at: location.recorded_at,
      cidade: location.cidade || ''
    });

    // Se houver mais de 5 pontos acumulados, dispara sincronização antecipada
    if (this.queue.size() >= 5) {
      this.syncPendingPoints();
    }
  }

  _handleLocationError(error) {
    console.warn('[TrackingManager] Erro no provedor de localização:', error);
    this.emit('locationError', error);
  }

  _startSyncLoop() {
    this._stopSyncLoop();
    this.syncTimer = setInterval(() => {
      this.syncPendingPoints();
    }, this.options.syncIntervalMs);
  }

  _stopSyncLoop() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * Sincroniza pontos pendentes da fila com o servidor em lotes
   */
  async syncPendingPoints() {
    if (this.isSyncing) return;
    const batch = this.queue.peek(this.options.syncBatchSize);
    if (!batch || batch.length === 0) return;

    this.isSyncing = true;
    try {
      const tripId = this.currentTripId || batch[0].viagem_id;
      const res = await this.api.sendBatch(tripId, batch, this.credentials, this.currentSessionId);

      // Confirmação recebida do servidor: remove os pontos enviados da fila local
      const uids = batch.map(b => b.point_uid);
      this.queue.remove(uids);

      this.backoffMs = 2000; // restaura backoff após sucesso
      this.emit('syncSuccess', { count: batch.length, remaining: this.queue.size(), response: res });

      // Se ainda houver pontos remanescentes na fila, agenda próximo lote imediatamente
      if (this.queue.size() > 0) {
        setTimeout(() => this.syncPendingPoints(), 300);
      }
    } catch (err) {
      console.warn('[TrackingManager] Falha ao sincronizar lote (offline ou erro):', err.message);
      this.emit('syncError', { error: err.message, pending: this.queue.size() });

      // Exponential backoff
      this.backoffMs = Math.min(this.backoffMs * 1.8, this.options.maxBackoffMs);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Pausa o rastreamento
   */
  async pause() {
    if (this.status !== this.Status.TRACKING) return;
    try {
      await this.api.pause(this.currentTripId, this.credentials);
    } catch (_) {}
    this.provider.stopWatch();
    this._stopSyncLoop();
    this._setStatus(this.Status.PAUSED);
  }

  /**
   * Retoma o rastreamento
   */
  async resume() {
    if (this.status !== this.Status.PAUSED) return;
    try {
      await this.api.resume(this.currentTripId, this.credentials);
    } catch (_) {}
    await this.provider.startWatch(
      (loc) => this._handleNewLocation(loc),
      (err) => this._handleLocationError(err)
    );
    this._startSyncLoop();
    this._setStatus(this.Status.TRACKING);
  }

  /**
   * Encerra o rastreamento
   */
  async stop() {
    this._stopSyncLoop();
    this.provider.stopWatch();

    // Tenta descarregar todos os pontos pendentes antes de parar
    try {
      await this.syncPendingPoints();
    } catch (_) {}

    try {
      if (this.currentTripId) {
        await this.api.stop(this.currentTripId, this.credentials);
      }
    } catch (_) {}

    this._setStatus(this.Status.STOPPED);
    this.currentTripId = null;
    this.currentSessionId = null;
    this._persistActiveSession();
  }

  getStatus() {
    return {
      status: this.status,
      tripId: this.currentTripId,
      sessionId: this.currentSessionId,
      queueSize: this.queue.size(),
      lastLocation: this.lastLocation,
      isCapacitor: this.provider.isCapacitorNative()
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TrackingManager;
}
if (typeof window !== 'undefined') {
  window.TrackingManager = TrackingManager;
}
