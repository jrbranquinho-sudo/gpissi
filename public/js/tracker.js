// GPISSI Tracker Script - OpenFreeMap (MapLibre GL JS) & 5-Minute Real-Time Trajectory Tracking

let map = null;
let currentTrip = null;
let isCreatorAuth = false;
let userAuthToken = null;
let userAuthPin = null;

// Markers reference
let originMarker = null;
let destMarker = null;
let checkinMarkers = [];
let routeSourceAdded = false;

// 5-minute GPS tracking timer
const TRACK_INTERVAL_SECONDS = 300; // 5 minutos
let trackCountdown = TRACK_INTERVAL_SECONDS;
let autoTrackingInterval = null;
let countdownTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const tripId = urlParams.get('id');
  const tokenParam = urlParams.get('token');
  const pinParam = urlParams.get('pin');

  if (!tripId) {
    alert('Nenhum identificador de viagem fornecido.');
    window.location.href = '/radar';
    return;
  }

  const cachedAuth = JSON.parse(localStorage.getItem(`insanos_trip_${tripId}`) || 'null');
  if (tokenParam) {
    userAuthToken = tokenParam;
  } else if (cachedAuth && cachedAuth.admin_token) {
    userAuthToken = cachedAuth.admin_token;
  }

  if (pinParam) {
    userAuthPin = pinParam;
  } else if (cachedAuth && cachedAuth.creator_pin) {
    userAuthPin = cachedAuth.creator_pin;
  }

  initOpenFreeMap();
  loadTripData(tripId);

  // Auto-refresh for viewers every 25 seconds
  setInterval(() => {
    if (currentTrip && currentTrip.status === 'EM ANDAMENTO') {
      loadTripData(tripId, true);
    }
  }, 25000);

  setupEventListeners(tripId);
  setupNetworkListeners(tripId);
});

// Initialize MapLibre GL with OpenFreeMap (Liberty Style)
function initOpenFreeMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: [-46.6333, -23.5505],
    zoom: 8
  });

  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.addControl(new maplibregl.FullscreenControl(), 'top-right');

  document.getElementById('btnFitMap').addEventListener('click', () => {
    fitRouteBounds();
  });
}

async function loadTripData(tripId, isSilent = false) {
  try {
    const headers = {};
    if (userAuthToken) headers['x-creator-token'] = userAuthToken;
    if (userAuthPin) headers['x-creator-pin'] = userAuthPin;

    const res = await fetch(`/api/viagens/${tripId}`, { headers });
    if (!res.ok) {
      if (res.status === 404) {
        alert('Protocolo de viagem não encontrado ou expirado após 72h.');
        window.location.href = '/radar';
        return;
      }
      throw new Error('Falha ao carregar telemetria.');
    }

    const trip = await res.json();
    currentTrip = trip;
    isCreatorAuth = trip.is_creator || false;

    renderTripDetails(trip);
    renderMapElements(trip);
    updateExternalMapLinks(trip);
    updateCreatorPanelUI(trip);

    // If creator is viewing and trip is open, start 5-minute auto tracker
    if (isCreatorAuth && trip.status === 'EM ANDAMENTO' && !autoTrackingInterval) {
      start5MinuteAutoTracking(tripId);
    }

  } catch (err) {
    if (!isSilent) {
      console.error(err);
      alert('Erro ao carregar dados do protocolo: ' + err.message);
    }
  }
}

function formatDateBR(dateString) {
  if (!dateString) return 'A definir';
  const parts = dateString.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateString;
}

function renderTripDetails(trip) {
  document.getElementById('heroTripTitle').innerHTML = `🏍️ INSANO NA ESTRADA - ${trip.nome_colete.toUpperCase()} &bull; <span class="gp-blue">GP</span><span class="issi-orange">ISSI</span>`;
  document.getElementById('tripIdBadge').textContent = `ID: ${trip.id}`;
  
  if (trip.created_at) {
    const d = new Date(trip.created_at);
    document.getElementById('tripTimestamp').textContent = `Registrado em: ${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  }

  // Status Badge
  const statusContainer = document.getElementById('tripStatusContainer');
  if (trip.status === 'CONCLUÍDA') {
    statusContainer.innerHTML = `
      <div class="status-badge closed">
        <span class="status-dot"></span>
        <span>VIAGEM CONCLUÍDA (CHEGOU COM SEGURANÇA)</span>
      </div>
    `;
    document.getElementById('closedNoticeCard').style.display = 'block';
    if (trip.closed_at) {
      const d = new Date(trip.closed_at);
      document.getElementById('closedTimestamp').textContent = `Encerramento registrado em: ${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    }
    if (trip.encerramento_motivo) {
      document.getElementById('closedNoticeText').textContent = `"${trip.encerramento_motivo}"`;
    }
    stop5MinuteAutoTracking();
  } else {
    statusContainer.innerHTML = `
      <div class="status-badge open">
        <span class="status-dot"></span>
        <span>EM ANDAMENTO (NA ESTRADA)</span>
      </div>
    `;
    document.getElementById('closedNoticeCard').style.display = 'none';
  }

  document.getElementById('statRouteName').textContent = `${trip.origem} ➔ ${trip.destino}`;

  // Integrante
  document.getElementById('valNomeColete').textContent = trip.nome_colete;
  document.getElementById('valGrau').textContent = trip.grau || 'CAMISETA - X';
  document.getElementById('valTelefone').textContent = trip.telefone;
  document.getElementById('valTransporte').textContent = trip.transporte_tipo;
  
  let vDesc = trip.transporte_detalhe;
  if (!vDesc && trip.transporte_placa) {
    vDesc = `Placa: ${trip.transporte_placa}`;
  }
  document.getElementById('valTransporteDetalhe').textContent = vDesc || 'Nenhum detalhe informado';
  document.getElementById('valAcompanhante').textContent = trip.vai_acompanhado === 'Sim' ? (trip.quem_vai_junto || 'Sim (acompanhado)') : 'Não (Solo)';

  // Rota
  document.getElementById('valOrigem').textContent = trip.origem;
  document.getElementById('valDestino').textContent = trip.destino;
  document.getElementById('valSaida').textContent = `${formatDateBR(trip.data_saida)} às ${trip.hora_saida || 'A definir'}`;
  document.getElementById('valPrevisao').textContent = trip.previsao_chegada || 'Conforme tráfego';
  document.getElementById('valRetorno').textContent = formatDateBR(trip.data_retorno);

  // Emergência
  document.getElementById('valEmergenciaContato').textContent = trip.emergencia_contato || 'Não informado';
  document.getElementById('valEmergenciaTel').textContent = trip.emergencia_telefone || 'Não informado';

  const callBtn = document.getElementById('btnCallEmergencia');
  if (trip.emergencia_telefone) {
    const rawTel = trip.emergencia_telefone.replace(/\D/g, '');
    callBtn.href = `tel:${rawTel}`;
    callBtn.style.display = 'inline-flex';
  } else {
    callBtn.style.display = 'none';
  }

  // Notas
  document.getElementById('valNotas').textContent = trip.observacoes_notas || 'Nenhuma anotação informada.';
  document.getElementById('valResumo').textContent = trip.observacoes_resumo || 'Sem relato prévio.';

  // Checkins & Last GPS position
  if (trip.checkins && trip.checkins.length > 0) {
    const last = trip.checkins[trip.checkins.length - 1];
    const d = new Date(last.timestamp);
    document.getElementById('lastCheckinTime').textContent = `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    document.getElementById('lastCheckinDesc').textContent = `${last.descricao} (${last.cidade || 'Ponto na Rodovia'})`;
  }

  // WhatsApp Share Text
  const trackerShareUrl = window.location.href;
  const waShareMsg = `*GPISSI - INSANO NA ESTRADA - INSANOS MC*\n👤 Integrante: ${trip.nome_colete} (${trip.grau})\n🛣️ Rota: ${trip.origem} ➔ ${trip.destino}\n🚦 Status: ${trip.status}\n\n📍 *Acompanhe em tempo real no mapa OpenFreeMap:*\n${trackerShareUrl}`;
  document.getElementById('btnShareTrackerWa').href = `https://api.whatsapp.com/send?text=${encodeURIComponent(waShareMsg)}`;
}

function updateExternalMapLinks(trip) {
  let targetLat = -23.5505;
  let targetLng = -46.6333;

  if (trip.checkins && trip.checkins.length > 1) {
    const last = trip.checkins[trip.checkins.length - 1];
    targetLat = last.lat;
    targetLng = last.lng;
  } else if (trip.destino_geo) {
    targetLat = trip.destino_geo.lat;
    targetLng = trip.destino_geo.lon;
  } else if (trip.origem_geo) {
    targetLat = trip.origem_geo.lat;
    targetLng = trip.origem_geo.lon;
  }

  const googleBtn = document.getElementById('btnOpenGoogleMaps');
  if (trip.origem && trip.destino) {
    googleBtn.href = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(trip.origem)}&destination=${encodeURIComponent(trip.destino)}`;
  } else {
    googleBtn.href = `https://www.google.com/maps/search/?api=1&query=${targetLat},${targetLng}`;
  }

  const wazeBtn = document.getElementById('btnOpenWaze');
  wazeBtn.href = `https://waze.com/ul?ll=${targetLat},${targetLng}&navigate=yes`;

  const appleBtn = document.getElementById('btnOpenAppleMaps');
  appleBtn.href = `https://maps.apple.com/?daddr=${targetLat},${targetLng}&dirflg=d`;
}

function updateCreatorPanelUI(trip) {
  const authMsg = document.getElementById('creatorAuthMessage');
  const activeActions = document.getElementById('creatorActiveActions');
  const authPrompt = document.getElementById('creatorAuthPrompt');
  const gpsStatusBox = document.getElementById('creatorGpsStatusBox');

  if (trip.status === 'CONCLUÍDA') {
    activeActions.style.display = 'none';
    authPrompt.style.display = 'none';
    if (gpsStatusBox) gpsStatusBox.style.display = 'none';
    authMsg.innerHTML = '<span style="color: var(--accent-green); font-weight: bold;">✓ Este protocolo de viagem já foi encerrado pelo autor.</span>';
    return;
  }

  if (isCreatorAuth) {
    authMsg.innerHTML = '<strong>👑 Autenticado como Piloto:</strong> Você registrou este protocolo. O rastreamento atualiza seu trajeto a cada 5 minutos automaticamente:';
    activeActions.style.display = 'flex';
    authPrompt.style.display = 'none';
    if (gpsStatusBox) gpsStatusBox.style.display = 'block';
  } else {
    authMsg.innerHTML = '🔒 <strong>Modo Visitante:</strong> Você está visualizando o rastreamento em tempo real. Apenas o integrante que registrou o protocolo possui autorização para encerrar a viagem.';
    activeActions.style.display = 'flex';
    authPrompt.style.display = 'block';
    if (gpsStatusBox) gpsStatusBox.style.display = 'none';
  }
}

// 5-MINUTE AUTOMATIC GPS TRACKING LOGIC (WITH OFFLINE RESILIENCE)
function start5MinuteAutoTracking(tripId) {
  if (autoTrackingInterval) clearInterval(autoTrackingInterval);
  if (countdownTimer) clearInterval(countdownTimer);

  trackCountdown = TRACK_INTERVAL_SECONDS;

  // Immediate initial check-in if none yet
  if (currentTrip && currentTrip.checkins && currentTrip.checkins.length <= 1) {
    transmitGpsLocation(tripId, true);
  }

  // Countdown display updater every second
  countdownTimer = setInterval(() => {
    trackCountdown--;
    if (trackCountdown <= 0) {
      trackCountdown = TRACK_INTERVAL_SECONDS;
    }
    const mins = String(Math.floor(trackCountdown / 60)).padStart(2, '0');
    const secs = String(trackCountdown % 60).padStart(2, '0');
    const cdEl = document.getElementById('autoGpsCountdown');
    if (cdEl) cdEl.textContent = `${mins}:${secs}`;
  }, 1000);

  // 5-Minute interval execution
  autoTrackingInterval = setInterval(() => {
    transmitGpsLocation(tripId, true);
  }, TRACK_INTERVAL_SECONDS * 1000);
}

function stop5MinuteAutoTracking() {
  if (autoTrackingInterval) clearInterval(autoTrackingInterval);
  if (countdownTimer) clearInterval(countdownTimer);
  autoTrackingInterval = null;
  countdownTimer = null;
}

// TRANSMIT GPS LOCATION (Handles online transmission or offline queueing if cell signal drops)
function transmitGpsLocation(tripId, isAutomatic = false) {
  if (!navigator.geolocation) {
    if (!isAutomatic) alert('Geolocalização não é suportada pelo seu dispositivo.');
    return;
  }

  const btn = document.getElementById('btnTransmitGps');
  if (!isAutomatic && btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>📡 Obtendo coordenadas GPS...</span>';
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const timestamp = new Date().toISOString();

      const pointData = {
        lat,
        lng,
        timestamp,
        descricao: isAutomatic ? 'Ponto Automático no Trajeto (5 min)' : 'Ponto Marcado no Trajeto',
        cidade: 'Rodovia / Em Trânsito'
      };

      // Check online status
      if (!navigator.onLine) {
        saveOfflineCheckin(tripId, pointData);
        showOfflineNotice(true);
        if (!isAutomatic && btn) {
          btn.disabled = false;
          btn.innerHTML = '<span>📡 Transmitir Ponto no Trajeto Agora</span>';
        }
        return;
      }

      try {
        const headers = { 'Content-Type': 'application/json' };
        if (userAuthToken) headers['x-creator-token'] = userAuthToken;
        if (userAuthPin) headers['x-creator-pin'] = userAuthPin;

        const res = await fetch(`/api/viagens/${tripId}/checkin`, {
          method: 'POST',
          headers,
          body: JSON.stringify(pointData)
        });

        if (!res.ok) {
          throw new Error('Servidor retornou erro ao gravar ponto.');
        }

        showOfflineNotice(false);
        loadTripData(tripId, true);

        // Also check if any offline points were pending
        syncOfflineCheckins(tripId);

      } catch (err) {
        console.warn('Falha de rede ao transmitir ponto GPS:', err);
        // Fallback: save to offline queue, keep last known position on UI
        saveOfflineCheckin(tripId, pointData);
        showOfflineNotice(true);
      } finally {
        if (!isAutomatic && btn) {
          btn.disabled = false;
          btn.innerHTML = '<span>📡 Transmitir Ponto no Trajeto Agora</span>';
        }
      }
    },
    (err) => {
      console.warn('Erro ao obter GPS:', err);
      // If signal drops or GPS fails, keep last recorded position intact!
      showOfflineNotice(true);
      if (!isAutomatic && btn) {
        btn.disabled = false;
        btn.innerHTML = '<span>📡 Transmitir Ponto no Trajeto Agora</span>';
        alert('Não foi possível obter sinal de satélite. O último registro de localização foi mantido.');
      }
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
  );
}

// OFFLINE QUEUE MANAGEMENT (Preserves last known point and queues points if signal drops)
function saveOfflineCheckin(tripId, point) {
  try {
    const key = `insanos_offline_points_${tripId}`;
    const queue = JSON.parse(localStorage.getItem(key) || '[]');
    queue.push(point);
    localStorage.setItem(key, JSON.stringify(queue));
    console.log('Ponto salvo na fila offline. Mantendo último ponto conhecido.');
  } catch (e) {
    console.error(e);
  }
}

async function syncOfflineCheckins(tripId) {
  try {
    const key = `insanos_offline_points_${tripId}`;
    const queue = JSON.parse(localStorage.getItem(key) || '[]');
    if (queue.length === 0) return;

    const headers = { 'Content-Type': 'application/json' };
    if (userAuthToken) headers['x-creator-token'] = userAuthToken;
    if (userAuthPin) headers['x-creator-pin'] = userAuthPin;

    const res = await fetch(`/api/viagens/${tripId}/checkin`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ batch: queue })
    });

    if (res.ok) {
      localStorage.removeItem(key);
      showOfflineNotice(false);
      loadTripData(tripId, true);
    }
  } catch (e) {
    console.warn('Tentativa de sincronização offline aguarda sinal de rede.');
  }
}

function showOfflineNotice(isOffline) {
  const banner = document.getElementById('offlineNoticeBanner');
  const badge = document.getElementById('signalStatusBadge');
  if (isOffline) {
    if (banner) banner.style.display = 'block';
    if (badge) {
      badge.style.color = '#ffaa00';
      badge.style.background = 'rgba(255,170,0,0.15)';
      badge.innerHTML = '⚠️ Sinal: Instável (Último Ponto Mantido)';
    }
  } else {
    if (banner) banner.style.display = 'none';
    if (badge) {
      badge.style.color = '#00e676';
      badge.style.background = 'rgba(0,230,118,0.1)';
      badge.innerHTML = '📶 Sinal: Conectado';
    }
  }
}

function setupNetworkListeners(tripId) {
  window.addEventListener('online', () => {
    showOfflineNotice(false);
    syncOfflineCheckins(tripId);
  });
  window.addEventListener('offline', () => {
    showOfflineNotice(true);
  });
}

// RENDER MAP WITH OPENFREEMAP & MAPLIBRE GL JS
function renderMapElements(trip) {
  if (!map) return;

  const oGeo = trip.origem_geo;
  const dGeo = trip.destino_geo;
  if (!oGeo || !dGeo) return;

  // Wait for map style to be loaded if not yet ready
  if (!map.isStyleLoaded()) {
    map.once('load', () => renderMapElements(trip));
    return;
  }

  // Clear existing markers
  if (originMarker) originMarker.remove();
  if (destMarker) destMarker.remove();
  checkinMarkers.forEach(m => m.remove());
  checkinMarkers = [];

  // 1. Origin Marker
  const elOrigin = document.createElement('div');
  elOrigin.className = 'custom-maplibre-marker';
  elOrigin.innerHTML = `<div style="background: #00e676; color: #000; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 800; border: 3px solid #000; box-shadow: 0 0 15px rgba(0, 230, 118, 0.8);">🏁</div>`;

  originMarker = new maplibregl.Marker({ element: elOrigin })
    .setLngLat([oGeo.lon, oGeo.lat])
    .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(`
      <div style="font-family: sans-serif; color: #000;">
        <strong>Partida (Origem):</strong><br>${trip.origem}<br>
        <small>Saída: ${formatDateBR(trip.data_saida)} às ${trip.hora_saida}</small>
      </div>
    `))
    .addTo(map);

  // 2. Destination Marker (with caveirasembg.png)
  const elDest = document.createElement('div');
  elDest.className = 'custom-maplibre-marker';
  elDest.innerHTML = `<div style="background: #ff6600; color: #fff; width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 3px solid #000; box-shadow: 0 0 20px rgba(255, 102, 0, 0.9);"><img src="/images/caveirasembg.png" style="height: 24px; width: auto;" alt="Caveira"></div>`;

  destMarker = new maplibregl.Marker({ element: elDest })
    .setLngLat([dGeo.lon, dGeo.lat])
    .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(`
      <div style="font-family: sans-serif; color: #000;">
        <strong>Destino Final:</strong><br>${trip.destino}<br>
        <small>Previsão: ${trip.previsao_chegada || 'N/A'}</small>
      </div>
    `))
    .addTo(map);

  // 3. Trajectory Checkpoints (including 5-min points)
  if (trip.checkins && trip.checkins.length > 0) {
    trip.checkins.forEach((chk, idx) => {
      if (idx === 0) return; // skip initial origin

      const isLast = (idx === trip.checkins.length - 1 && trip.status === 'EM ANDAMENTO');
      const elChk = document.createElement('div');
      elChk.className = 'custom-maplibre-marker';
      elChk.innerHTML = `<div style="background: ${isLast ? '#ffaa00' : '#00b0ff'}; color: #000; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 15px; border: 2px solid #000; box-shadow: 0 0 15px rgba(255, 170, 0, 0.9);">${isLast ? '🏍️' : '📍'}</div>`;

      const d = new Date(chk.timestamp);
      const chkMarker = new maplibregl.Marker({ element: elChk })
        .setLngLat([chk.lng, chk.lat])
        .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(`
          <div style="font-family: sans-serif; color: #000; min-width: 170px;">
            <strong>${chk.descricao}</strong><br>
            <span>${chk.cidade || ''}</span><br>
            <small>${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR')}</small>
          </div>
        `))
        .addTo(map);

      checkinMarkers.push(chkMarker);
    });
  }

  // 4. Fetch road geometry from OSRM and draw on OpenFreeMap
  fetchRoadRoute([oGeo.lon, oGeo.lat], [dGeo.lon, dGeo.lat]);
}

async function fetchRoadRoute(startCoord, endCoord) {
  try {
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${startCoord[0]},${startCoord[1]};${endCoord[0]},${endCoord[1]}?overview=full&geometries=geojson`;
    const res = await fetch(osrmUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const geojson = {
          type: 'Feature',
          properties: {},
          geometry: route.geometry
        };

        const distanceKm = Math.round(route.distance / 1000);
        const durationHours = Math.floor(route.duration / 3600);
        const durationMinutes = Math.round((route.duration % 3600) / 60);

        document.getElementById('statDistance').textContent = `${distanceKm} km`;
        document.getElementById('statDuration').textContent = `${durationHours}h ${durationMinutes}min`;

        drawRouteOnMap(geojson);
        fitRouteBounds();
        return;
      }
    }
  } catch (e) {
    console.warn('OSRM route fetch fallback:', e);
  }

  // Fallback straight line GeoJSON
  const straightGeoJson = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: [startCoord, endCoord]
    }
  };
  drawRouteOnMap(straightGeoJson);
  fitRouteBounds();
}

function drawRouteOnMap(geojson) {
  if (!map) return;

  if (map.getSource('route-line')) {
    map.getSource('route-line').setData(geojson);
  } else {
    map.addSource('route-line', {
      type: 'geojson',
      data: geojson
    });

    map.addLayer({
      id: 'route-line-layer',
      type: 'line',
      source: 'route-line',
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': '#ff6600',
        'line-width': 6,
        'line-opacity': 0.95
      }
    });
  }
}

function fitRouteBounds() {
  if (!map || !currentTrip) return;

  const oGeo = currentTrip.origem_geo;
  const dGeo = currentTrip.destino_geo;
  if (!oGeo || !dGeo) return;

  const bounds = new maplibregl.LngLatBounds();
  bounds.extend([oGeo.lon, oGeo.lat]);
  bounds.extend([dGeo.lon, dGeo.lat]);

  if (currentTrip.checkins) {
    currentTrip.checkins.forEach(chk => {
      bounds.extend([chk.lng, chk.lat]);
    });
  }

  map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
}

function setupEventListeners(tripId) {
  const btnAuthPin = document.getElementById('btnAuthPin');
  if (btnAuthPin) {
    btnAuthPin.addEventListener('click', () => {
      const pin = document.getElementById('inputPinAuth').value.trim();
      if (!pin) {
        alert('Digite o PIN de 4 dígitos cadastrado na criação do protocolo.');
        return;
      }
      userAuthPin = pin;
      loadTripData(tripId);
    });
  }

  const btnCloseTrip = document.getElementById('btnCloseTrip');
  const closeTripModal = document.getElementById('closeTripModal');
  const btnCancelCloseModal = document.getElementById('btnCancelCloseModal');
  const btnCancelCloseTrip = document.getElementById('btnCancelCloseTrip');
  const btnConfirmCloseTrip = document.getElementById('btnConfirmCloseTrip');
  const pinConfirmBox = document.getElementById('pinConfirmBox');

  btnCloseTrip.addEventListener('click', () => {
    if (!isCreatorAuth && !userAuthPin) {
      pinConfirmBox.style.display = 'block';
    } else {
      pinConfirmBox.style.display = 'none';
    }
    closeTripModal.classList.add('active');
  });

  const closeModal = () => {
    closeTripModal.classList.remove('active');
  };
  btnCancelCloseModal.addEventListener('click', closeModal);
  btnCancelCloseTrip.addEventListener('click', closeModal);

  btnConfirmCloseTrip.addEventListener('click', async () => {
    const motivo = document.getElementById('closeMotivoInput').value.trim();
    let pinToSend = userAuthPin;

    if (!isCreatorAuth && !userAuthToken) {
      const inputPin = document.getElementById('closePinInput').value.trim();
      if (!inputPin) {
        alert('Por favor, informe seu PIN de Segurança para confirmar que você é o autor.');
        return;
      }
      pinToSend = inputPin;
    }

    btnConfirmCloseTrip.disabled = true;
    btnConfirmCloseTrip.textContent = 'Encerrando...';

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (userAuthToken) headers['x-creator-token'] = userAuthToken;
      if (pinToSend) headers['x-creator-pin'] = pinToSend;

      const res = await fetch(`/api/viagens/${tripId}/encerrar`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          motivo,
          pin: pinToSend,
          token: userAuthToken
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Acesso negado para encerrar a viagem.');
      }

      closeModal();
      alert('✓ VIAGEM ENCERRADA COM SUCESSO!\n\nChegada confirmada pelo integrante. O protocolo foi marcado como concluído no GPISSI.');
      stop5MinuteAutoTracking();
      loadTripData(tripId);

    } catch (err) {
      alert('⚠️ ' + err.message);
    } finally {
      btnConfirmCloseTrip.disabled = false;
      btnConfirmCloseTrip.textContent = 'Confirmar Encerramento 🏁';
    }
  });

  const btnTransmitGps = document.getElementById('btnTransmitGps');
  btnTransmitGps.addEventListener('click', () => {
    transmitGpsLocation(tripId, false);
  });
}
