/**
 * GPISSI - Tracking API Client
 * Comunicação HTTP com os endpoints /api/viagens/:id/tracking/*
 */
class TrackingApi {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  _buildHeaders(credentials = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (credentials.token) headers['x-creator-token'] = credentials.token;
    if (credentials.pin) headers['x-creator-pin'] = String(credentials.pin).trim();
    return headers;
  }

  async start(tripId, credentials = {}, options = {}) {
    const res = await fetch(`${this.baseUrl}/api/viagens/${encodeURIComponent(tripId)}/tracking/start`, {
      method: 'POST',
      headers: this._buildHeaders(credentials),
      body: JSON.stringify({ ...credentials, ...options })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Erro ao iniciar rastreamento (${res.status})`);
    return data;
  }

  async pause(tripId, credentials = {}) {
    const res = await fetch(`${this.baseUrl}/api/viagens/${encodeURIComponent(tripId)}/tracking/pause`, {
      method: 'POST',
      headers: this._buildHeaders(credentials),
      body: JSON.stringify(credentials)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Erro ao pausar rastreamento (${res.status})`);
    return data;
  }

  async resume(tripId, credentials = {}) {
    const res = await fetch(`${this.baseUrl}/api/viagens/${encodeURIComponent(tripId)}/tracking/resume`, {
      method: 'POST',
      headers: this._buildHeaders(credentials),
      body: JSON.stringify(credentials)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Erro ao retomar rastreamento (${res.status})`);
    return data;
  }

  async stop(tripId, credentials = {}) {
    const res = await fetch(`${this.baseUrl}/api/viagens/${encodeURIComponent(tripId)}/tracking/stop`, {
      method: 'POST',
      headers: this._buildHeaders(credentials),
      body: JSON.stringify(credentials)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Erro ao encerrar rastreamento (${res.status})`);
    return data;
  }

  async sendBatch(tripId, points, credentials = {}, sessionId = null) {
    const payload = {
      points,
      session_id: sessionId,
      ...credentials
    };
    const res = await fetch(`${this.baseUrl}/api/viagens/${encodeURIComponent(tripId)}/tracking/points/batch`, {
      method: 'POST',
      headers: this._buildHeaders(credentials),
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Erro ao enviar lote de telemetria (${res.status})`);
    return data;
  }

  async getPoints(tripId, limit = 1000, since = null) {
    let url = `${this.baseUrl}/api/viagens/${encodeURIComponent(tripId)}/tracking/points?limit=${limit}`;
    if (since) url += `&since=${encodeURIComponent(since)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Erro ao buscar pontos de telemetria (${res.status})`);
    return data.points || [];
  }

  async getStatus(tripId) {
    const res = await fetch(`${this.baseUrl}/api/viagens/${encodeURIComponent(tripId)}/tracking/status`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Erro ao consultar status (${res.status})`);
    return data;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TrackingApi;
}
if (typeof window !== 'undefined') {
  window.TrackingApi = TrackingApi;
}
