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
let plannedRouteKey = '';
let plannedRoutePromise = null;
let isSendingGps = false;

// 10-second GPS tracking timer & continuous GPS watcher
const TRACK_INTERVAL_SECONDS = 10; // Intervalo de 10 segundos ou menos
let trackCountdown = TRACK_INTERVAL_SECONDS;
let autoTrackingInterval = null;
let countdownTimer = null;
let gpsWatchId = null;
let lastKnownGpsPos = null;

document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  let tripId = urlParams.get('id');
  let shareToken = urlParams.get('share');
  const tokenParam = urlParams.get('token');
  const pinParam = urlParams.get('pin');

  if (tripId) {
    sessionStorage.setItem('tracker_trip_id', tripId);
    sessionStorage.setItem('on_tracker_page', '1');
    if (shareToken) sessionStorage.setItem('tracker_share_token', shareToken);
  } else {
    tripId = sessionStorage.getItem('tracker_trip_id');
    shareToken = sessionStorage.getItem('tracker_share_token');
  }

  // Mask tracking link in browser address bar to show only base domain
  try {
    window.history.replaceState({ tripId, shareToken }, document.title, '/');
  } catch (e) {}

  document.querySelectorAll('.navbar a').forEach(a => {
    a.addEventListener('click', () => {
      sessionStorage.removeItem('on_tracker_page');
    });
  });

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
  loadTripData(tripId, false, shareToken);

  // Auto-refresh for viewers every 10 seconds (tempo real)
  setInterval(() => {
    if (currentTrip && currentTrip.status === 'EM ANDAMENTO') {
      loadTripData(tripId, true, shareToken);
    }
  }, 10000);

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
  map.on('error', event => console.warn('Erro no mapa:', event.error || event));
  map.on('load', () => {
    map.resize();
    if (currentTrip) renderMapElements(currentTrip);
  });

  document.getElementById('btnFitMap').addEventListener('click', () => {
    fitRouteBounds();
  });
}

async function loadTripData(tripId, isSilent = false, shareToken = '') {
  try {
    const headers = {};
    if (userAuthToken) headers['x-creator-token'] = userAuthToken;
    if (userAuthPin) headers['x-creator-pin'] = userAuthPin;

    const shareQuery = shareToken ? `?share=${encodeURIComponent(shareToken)}` : '';
    const res = await fetch(`/api/viagens/${tripId}${shareQuery}`, { headers });
    if (!res.ok) {
      if (res.status === 404) {
        alert('Link de rastreamento inválido ou expirado. Acompanhe a viagem pelo link compartilhado pelo responsável.');
        window.location.href = '/conta';
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

  const historyList = document.getElementById('locationHistoryList');
  const locationPoints = (trip.checkins || []).slice(-12).reverse();
  historyList.replaceChildren();
  if (locationPoints.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'Aguardando registros GPS.';
    historyList.append(empty);
  } else {
    locationPoints.forEach(point => {
      const item = document.createElement('li');
      const date = new Date(point.timestamp);
      const type = point.tipo === 'city_passage' ? 'Passagem por' : (point.tipo === 'arrival' ? 'Chegada em' : 'Ponto de passagem em');
      item.textContent = `${type} ${point.cidade || 'Localização GPS'} · ${date.toLocaleDateString('pt-BR')} ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      if (point.tipo === 'city_passage' || point.tipo === 'arrival') item.classList.add('location-passage');
      historyList.append(item);
    });
  }

  // WhatsApp Share Text (Ficha Oficial Completa)
  const origin = window.location.origin;
  const shareParam = trip.share_token ? `&share=${encodeURIComponent(trip.share_token)}` : '';
  const trackerShareUrl = `${origin}/tracker?id=${trip.id}${shareParam}`;
  const buildOfficialMsg = (viagem, trackerUrl) => {
    if (typeof GPISSIGps !== 'undefined' && GPISSIGps.buildWhatsAppProtocolMessage) {
      return GPISSIGps.buildWhatsAppProtocolMessage(viagem, trackerUrl);
    }
    const formatDate = (dateString) => {
      if (!dateString) return 'A definir';
      const cleanDate = String(dateString).split('T')[0];
      const parts = cleanDate.split('-');
      if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
      return String(dateString);
    };
    const tTipo = String(viagem.transporte_tipo || 'MOTO').toUpperCase();
    let vDetalhe = viagem.transporte_detalhe || '';
    if (!vDetalhe) {
      const parts = [];
      if (viagem.transporte_placa) parts.push(`Placa: ${viagem.transporte_placa}`);
      const mm = `${viagem.transporte_marca || ''} ${viagem.transporte_modelo || ''}`.trim();
      if (mm) parts.push(mm);
      vDetalhe = parts.join(' | ');
    }
    const vSuffix = vDetalhe ? ` (${vDetalhe})` : '';
    const motoCheck = tTipo === 'MOTO' ? `[X] MOTO${vSuffix}` : '[ ] MOTO';
    const carroCheck = tTipo === 'CARRO' ? `[X] CARRO${vSuffix}` : '[ ] CARRO';
    const busCheck = (tTipo === 'ÔNIBUS' || tTipo === 'ONIBUS') ? `[X] ÔNIBUS${vSuffix}` : '[ ] ÔNIBUS';
    const statusUpper = String(viagem.status || 'EM ANDAMENTO').toUpperCase();
    let statusLine = '🔴 STATUS: EM ANDAMENTO (NA ESTRADA)';
    if (statusUpper === 'CONCLUÍDA' || statusUpper === 'CONCLUIDA') {
      statusLine = '🟢 STATUS: CONCLUÍDA (DESTINO ALCANÇADO)';
    } else if (statusUpper === 'CANCELADA') {
      statusLine = '⚪ STATUS: CANCELADA';
    }
    const vaiAcomp = viagem.vai_acompanhado === 'Sim' ? 'Sim' : 'Não';
    let quemJunto = vaiAcomp === 'Sim' ? (viagem.quem_vai_junto || 'Não informado') : 'Nenhum (Solo)';
    if (vaiAcomp === 'Sim' && Array.isArray(viagem.acompanhantes) && viagem.acompanhantes.length > 0) {
      const nomes = viagem.acompanhantes.map(a => `${a.nome_colete || a.nome || 'Integrante'}${a.grau ? ` (${a.grau})` : ''}`).join(', ');
      if (nomes) quemJunto = nomes;
    }
    const notas = viagem.observacoes_notas && viagem.observacoes_notas.trim() ? viagem.observacoes_notas.trim() : 'Nenhuma observação informada.';
    const resumo = viagem.observacoes_resumo && viagem.observacoes_resumo.trim() ? viagem.observacoes_resumo.trim() : 'Sem relato prévio.';
    const urlFinal = trackerUrl || (viagem.id ? `https://gpissi.vercel.app/tracker?id=${viagem.id}` : '');
    return `*GPISSI - PROTOCOLO DE VIAGEM - INSANOS MC*\n🏍️ INSANO NA ESTRADA\n\n📍 INFORMAÇÕES DA ROTA\nOrigem: ${viagem.origem || 'Não informada'}\nData de Saída: ${formatDate(viagem.data_saida)}\nHora de Saída: ${viagem.hora_saida || 'A definir'}\nDestino: ${viagem.destino || 'Não informado'}\nPrevisão de Chegada: ${viagem.previsao_chegada || 'Conforme condições de tráfego'}\nData de Retorno: ${formatDate(viagem.data_retorno || viagem.data_saida)}\n\n👤 DADOS DO INTEGRANTE\nNome do Colete: ${viagem.nome_colete || 'Não informado'}\nFunção/Grau: ${viagem.grau || 'Integrante'}\nTelefone: ${viagem.telefone || 'Não informado'}\n\n🚌 VEÍCULO\n${motoCheck}\n${carroCheck}\n${busCheck}\n\n👥 ACOMPANHANTE(S)\nVai acompanhado? ${vaiAcomp}\nQuem vai junto? ${quemJunto}\n\n🆘 EMERGÊNCIA\nContato: ${viagem.emergencia_contato || 'Não informado'}\nTelefone: ${viagem.emergencia_telefone || 'Não informado'}\n\n📝 OBSERVAÇÕES E RESUMO\nNotas: ${notas}\nResumo: ${resumo}\n\n${statusLine}\n🗺️ ACOMPANHE EM TEMPO REAL NO MAPA (GPISSI):\n${urlFinal}\n*(Ficha válida por até 72h)*`;
  };
  const waShareMsg = buildOfficialMsg(trip, trackerShareUrl);
  
  const waBtn = document.getElementById('btnShareTrackerWa');
  if (waBtn) {
    waBtn.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(waShareMsg)}`;
  }

  const copyFichaBtn = document.getElementById('btnCopyTrackerFicha');
  if (copyFichaBtn) {
    copyFichaBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(waShareMsg);
        const prevText = copyFichaBtn.innerHTML;
        copyFichaBtn.innerHTML = '<span>✓ Ficha Copiada!</span>';
        setTimeout(() => { copyFichaBtn.innerHTML = prevText; }, 2500);
      } catch (e) {
        alert('Texto pronto para cópia.');
      }
    };
  }
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
  const creatorShareSection = document.getElementById('creatorShareSection');
  const btnEditTrip = document.getElementById('btnEditTrip');
  const btnDeleteTrip = document.getElementById('btnDeleteTrip');

  // Control visibility of WhatsApp share & copy buttons (strictly for creator)
  if (creatorShareSection) {
    creatorShareSection.style.display = isCreatorAuth ? 'block' : 'none';
  }

  if (trip.status === 'CONCLUÍDA') {
    activeActions.style.display = 'none';
    authPrompt.style.display = 'none';
    if (gpsStatusBox) gpsStatusBox.style.display = 'none';
    authMsg.innerHTML = '<span style="color: var(--accent-green); font-weight: bold;">✓ Este protocolo de viagem já foi encerrado pelo autor.</span>';
    // Allow creator to delete even if closed
    if (isCreatorAuth && btnDeleteTrip) {
      activeActions.style.display = 'flex';
      btnDeleteTrip.style.display = 'flex';
      const btnTransmitGps = document.getElementById('btnTransmitGps');
      const btnCloseTrip = document.getElementById('btnCloseTrip');
      if (btnTransmitGps) btnTransmitGps.style.display = 'none';
      if (btnEditTrip) btnEditTrip.style.display = 'none';
      if (btnCloseTrip) btnCloseTrip.style.display = 'none';
    }
    return;
  }

  if (isCreatorAuth) {
    authMsg.innerHTML = '<strong>👑 Autenticado como Piloto:</strong> Você registrou este protocolo. O rastreamento atualiza seu trajeto e pontos de passagem a cada 10 segundos ou ao registrar sinal de internet:';
    activeActions.style.display = 'flex';
    authPrompt.style.display = 'none';
    if (gpsStatusBox) gpsStatusBox.style.display = 'block';
    if (btnEditTrip) btnEditTrip.style.display = 'flex';
    if (btnDeleteTrip) btnDeleteTrip.style.display = 'flex';
  } else {
    authMsg.innerHTML = '🔒 <strong>Modo Visitante:</strong> Você está visualizando o rastreamento em tempo real. Apenas o integrante que registrou o protocolo possui autorização para gerenciar a viagem.';
    activeActions.style.display = 'none';
    authPrompt.style.display = 'block';
    if (gpsStatusBox) gpsStatusBox.style.display = 'none';
  }
}

// CONTINUOUS GPS WATCHER (Mantém coordenadas frescas de satélite sem atraso de fix)
function startGpsWatcher() {
  if (!navigator.geolocation || gpsWatchId !== null) return;
  try {
    gpsWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (pos && pos.coords && Number.isFinite(pos.coords.latitude) && Number.isFinite(pos.coords.longitude)) {
          lastKnownGpsPos = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp || Date.now()
          };
        }
      },
      (err) => {
        console.warn('GPS Watcher oscilando:', err.message);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  } catch (e) {
    console.warn('Não foi possível iniciar watchPosition:', e);
  }
}

function stopGpsWatcher() {
  if (gpsWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
}

// 10-SECOND AUTOMATIC GPS TRACKING LOGIC (WITH REALTIME PASSAGE POINTS & OFFLINE RESILIENCE)
function start10SecondAutoTracking(tripId) {
  if (autoTrackingInterval) clearInterval(autoTrackingInterval);
  if (countdownTimer) clearInterval(countdownTimer);

  startGpsWatcher();
  trackCountdown = TRACK_INTERVAL_SECONDS;

  // Sincroniza eventuais pontos pendentes na fila offline
  syncOfflineCheckins(tripId);

  // Transmite a primeira posição imediatamente se a viagem estiver em andamento
  if (currentTrip && currentTrip.status === 'EM ANDAMENTO') {
    transmitGpsLocation(tripId, true);
  }

  // Atualizador do HUD de contagem regressiva a cada 1 segundo
  countdownTimer = setInterval(() => {
    trackCountdown--;
    const cdEl = document.getElementById('autoGpsCountdown');
    if (cdEl) {
      cdEl.textContent = `${String(Math.max(0, trackCountdown)).padStart(2, '0')}s`;
    }
    if (trackCountdown <= 0) {
      trackCountdown = TRACK_INTERVAL_SECONDS;
      if (currentTrip && currentTrip.status === 'EM ANDAMENTO') {
        transmitGpsLocation(tripId, true);
      }
    }
  }, 1000);

  // Intervalo de segurança a cada 10 segundos
  autoTrackingInterval = setInterval(() => {
    if (currentTrip && currentTrip.status === 'EM ANDAMENTO') {
      transmitGpsLocation(tripId, true);
    }
  }, TRACK_INTERVAL_SECONDS * 1000);
}

// Alias de retrocompatibilidade
function start5MinuteAutoTracking(tripId) {
  start10SecondAutoTracking(tripId);
}

function stop10SecondAutoTracking() {
  if (autoTrackingInterval) clearInterval(autoTrackingInterval);
  if (countdownTimer) clearInterval(countdownTimer);
  autoTrackingInterval = null;
  countdownTimer = null;
  stopGpsWatcher();
}

function stop5MinuteAutoTracking() {
  stop10SecondAutoTracking();
}

// TRANSMIT GPS LOCATION (Atualiza ponto de passagem a cada 10s ou ao registrar sinal de internet)
async function transmitGpsLocation(tripId, isAutomatic = false) {
  if (isSendingGps) return;
  if (!navigator.geolocation) {
    if (!isAutomatic) alert('Geolocalização não é suportada pelo seu dispositivo.');
    return;
  }

  const btn = document.getElementById('btnTransmitGps');
  if (!isAutomatic && btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>📡 Obtendo coordenadas GPS...</span>';
  }

  const handleCoords = async (lat, lng, accuracy, timestampMs) => {
    isSendingGps = true;
    try {
      const timestamp = new Date(timestampMs || Date.now()).toISOString();

      // Descartar leituras com erro extremo (> 2500m) para evitar IP estático de provedor
      if (accuracy && accuracy > 2500) {
        console.warn(`[GPISSI Telemetria] Ponto descartado por imprecisão (${Math.round(accuracy)}m).`);
        isSendingGps = false;
        if (!isAutomatic && btn) {
          btn.disabled = false;
          btn.innerHTML = '<span>📡 Transmitir Ponto no Trajeto Agora</span>';
          alert(`Localização aproximada com margem de erro alta (${Math.round(accuracy / 1000)} km). Transmita pelo celular com GPS de satélite ativo.`);
        }
        return;
      }

      // Validação de corredor da rota no frontend
      if (currentTrip && currentTrip.origem_geo && currentTrip.destino_geo) {
        const inCorridor = (typeof GPISSIGps !== 'undefined' && GPISSIGps.isPointInRouteCorridor)
          ? GPISSIGps.isPointInRouteCorridor(lat, lng, currentTrip.origem_geo, currentTrip.destino_geo)
          : true;
        if (!inCorridor) {
          console.warn(`[GPISSI Telemetria] Ponto [${lat}, ${lng}] fora do corredor da rota. Ignorado.`);
          isSendingGps = false;
          if (!isAutomatic && btn) {
            btn.disabled = false;
            btn.innerHTML = '<span>📡 Transmitir Ponto no Trajeto Agora</span>';
            alert('A localização detectada está distante da rota oficial planejada. Ponto não transmitido para manter a integridade do mapa.');
          }
          return;
        }
      }

      const pointData = {
        lat,
        lng,
        timestamp,
        descricao: isAutomatic ? 'Ponto de passagem no trajeto' : 'Ponto marcado no trajeto',
        cidade: currentTrip?.last_city || 'Localização GPS'
      };

      // Se não há internet, guarda na fila offline
      if (!navigator.onLine) {
        saveOfflineCheckin(tripId, pointData);
        showOfflineNotice(true);
        isSendingGps = false;
        if (!isAutomatic && btn) {
          btn.disabled = false;
          btn.innerHTML = '<span>📡 Transmitir Ponto no Trajeto Agora</span>';
        }
        return;
      }

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
      loadTripData(tripId, true, shareToken);

      // Sincroniza qualquer ponto que tenha ficado acumulado offline
      syncOfflineCheckins(tripId);

    } catch (err) {
      console.warn('Falha de rede ao transmitir ponto GPS:', err.message);
      saveOfflineCheckin(tripId, {
        lat,
        lng,
        timestamp: new Date(timestampMs || Date.now()).toISOString(),
        descricao: isAutomatic ? 'Ponto de passagem no trajeto' : 'Ponto marcado no trajeto',
        cidade: currentTrip?.last_city || 'Localização GPS'
      });
      showOfflineNotice(true);
    } finally {
      isSendingGps = false;
      if (!isAutomatic && btn) {
        btn.disabled = false;
        btn.innerHTML = '<span>📡 Transmitir Ponto no Trajeto Agora</span>';
      }
    }
  };

  // Se temos leitura recente (< 25s) do watchPosition, usa diretamente sem delay
  if (lastKnownGpsPos && (Date.now() - lastKnownGpsPos.timestamp < 25000)) {
    handleCoords(lastKnownGpsPos.latitude, lastKnownGpsPos.longitude, lastKnownGpsPos.accuracy, lastKnownGpsPos.timestamp);
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      lastKnownGpsPos = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        timestamp: pos.timestamp || Date.now()
      };
      handleCoords(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.timestamp);
    },
    (err) => {
      console.warn('Erro ao obter GPS:', err);
      showOfflineNotice(true);
      if (!isAutomatic && btn) {
        btn.disabled = false;
        btn.innerHTML = '<span>📡 Transmitir Ponto no Trajeto Agora</span>';
        alert('Não foi possível obter sinal de satélite. O último registro de localização foi mantido.');
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 }
  );
}

// OFFLINE QUEUE MANAGEMENT (Preserva pontos e descarrega quando a internet volta)
function saveOfflineCheckin(tripId, point) {
  try {
    const key = `insanos_offline_points_${tripId}`;
    const queue = JSON.parse(localStorage.getItem(key) || '[]');
    // Evita duplicatas idênticas no mesmo segundo
    const isDup = queue.some(p => Math.abs(p.lat - point.lat) < 0.0001 && Math.abs(p.lng - point.lng) < 0.0001 && p.timestamp === point.timestamp);
    if (!isDup) {
      queue.push(point);
      localStorage.setItem(key, JSON.stringify(queue.slice(-150))); // Guarda até 150 pontos
      console.log('Ponto de passagem salvo na fila offline. Será sincronizado ao registrar sinal de internet.');
    }
  } catch (e) {
    console.error('Erro ao salvar offline:', e);
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
      loadTripData(tripId, true, shareToken);
      console.log(`✓ Sincronizados ${queue.length} pontos de passagem acumulados offline.`);
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
      badge.innerHTML = '📶 Sinal: Conectado (10s)';
    }
  }
}

function setupNetworkListeners(tripId) {
  // Dispara imediatamente ao registrar sinal de internet
  window.addEventListener('online', () => {
    showOfflineNotice(false);
    if (currentTrip && isCreatorAuth && currentTrip.status === 'EM ANDAMENTO') {
      syncOfflineCheckins(tripId).finally(() => transmitGpsLocation(tripId, true));
    }
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
  const hasOrigin = oGeo && GPISSIGps.isValidCoordinate(oGeo.lat, oGeo.lon);
  const hasDestination = dGeo && GPISSIGps.isValidCoordinate(dGeo.lat, dGeo.lon);
  if (!hasOrigin && !hasDestination && !(trip.checkins || []).some(point => GPISSIGps.isValidCoordinate(point.lat, point.lng))) return;

  // Wait for map style to be loaded if not yet ready
  if (!map.isStyleLoaded()) {
    map.once('style.load', () => renderMapElements(trip));
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

  elOrigin.title = `Partida: ${trip.origem}`;
  if (hasOrigin) originMarker = new maplibregl.Marker({ element: elOrigin })
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

  elDest.title = `Destino: ${trip.destino}`;
  if (hasDestination) destMarker = new maplibregl.Marker({ element: elDest })
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

      if (!GPISSIGps.isValidCoordinate(chk.lat, chk.lng)) return;
      const isPassage = chk.tipo === 'city_passage';
      const isArrival = chk.tipo === 'arrival';
      const isLast = (idx === trip.checkins.length - 1 && trip.status === 'EM ANDAMENTO');
      const elChk = document.createElement('div');
      elChk.className = 'custom-maplibre-marker';
      const markerColor = isPassage || isArrival ? '#00e676' : (isLast ? '#ffaa00' : '#00b0ff');
      const markerIcon = isArrival ? '🏁' : (isPassage ? '🏙️' : (isLast ? '🏍️' : '📍'));
      elChk.title = chk.descricao || chk.cidade || 'Ponto GPS';
      elChk.innerHTML = `<div style="background: ${markerColor}; color: #000; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 15px; border: 2px solid #000; box-shadow: 0 0 15px rgba(255, 170, 0, 0.9);">${markerIcon}</div>`;

      const d = new Date(chk.timestamp);
      const popupContent = document.createElement('div');
      popupContent.style.cssText = 'font-family:sans-serif;color:#000;min-width:170px';
      const title = document.createElement('strong');
      title.textContent = chk.descricao || (isPassage ? `Passagem por ${chk.cidade}` : 'Ponto GPS');
      const city = document.createElement('div');
      city.textContent = chk.cidade || 'Localização GPS';
      const time = document.createElement('small');
      time.textContent = `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR')}`;
      popupContent.append(title, city, time);
      const chkMarker = new maplibregl.Marker({ element: elChk })
        .setLngLat([chk.lng, chk.lat])
        .setPopup(new maplibregl.Popup({ offset: 25 }).setDOMContent(popupContent))
        .addTo(map);

      checkinMarkers.push(chkMarker);
    });
  }

  drawRecordedTrack(trip.checkins || []);
  if (hasOrigin && hasDestination) fetchRoadRoute([oGeo.lon, oGeo.lat], [dGeo.lon, dGeo.lat]);
  else fitRouteBounds();
}

async function fetchRoadRoute(startCoord, endCoord) {
  const routeKey = `${startCoord.join(',')}:${endCoord.join(',')}`;
  if (routeKey === plannedRouteKey && plannedRoutePromise) return plannedRoutePromise;
  plannedRouteKey = routeKey;
  plannedRoutePromise = (async () => {
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
  })();
  return plannedRoutePromise;
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

    const routeLayer = {
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
    };
    map.addLayer(routeLayer, map.getLayer('recorded-track-layer') ? 'recorded-track-layer' : undefined);
  }
  routeSourceAdded = true;
}

function drawRecordedTrack(checkins) {
  if (!map || !map.isStyleLoaded()) return;
  const feature = GPISSIGps.buildTrackFeature(checkins);
  const data = feature || { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } };
  if (map.getSource('recorded-track')) {
    map.getSource('recorded-track').setData(data);
    return;
  }
  map.addSource('recorded-track', { type: 'geojson', data });
  map.addLayer({
    id: 'recorded-track-layer',
    type: 'line',
    source: 'recorded-track',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#00b0ff', 'line-width': 4, 'line-opacity': 0.95 }
  });
}

function fitRouteBounds() {
  if (!map || !currentTrip) return;

  const oGeo = currentTrip.origem_geo;
  const dGeo = currentTrip.destino_geo;
  const hasOrigin = oGeo && GPISSIGps.isValidCoordinate(oGeo.lat, oGeo.lon);
  const hasDestination = dGeo && GPISSIGps.isValidCoordinate(dGeo.lat, dGeo.lon);

  const bounds = new maplibregl.LngLatBounds();
  if (hasOrigin) bounds.extend([oGeo.lon, oGeo.lat]);
  if (hasDestination) bounds.extend([dGeo.lon, dGeo.lat]);

  if (currentTrip.checkins) {
    currentTrip.checkins.forEach(chk => {
      if (GPISSIGps.isValidCoordinate(chk.lat, chk.lng)) bounds.extend([chk.lng, chk.lat]);
    });
  }

  if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
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
      loadTripData(tripId, false, shareToken);
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
  if (btnTransmitGps) {
    btnTransmitGps.addEventListener('click', () => {
      transmitGpsLocation(tripId, false);
    });
  }

  // Delete trip listener
  const btnDeleteTrip = document.getElementById('btnDeleteTrip');
  if (btnDeleteTrip) {
    btnDeleteTrip.addEventListener('click', async () => {
      const confirmDelete = confirm('⚠️ ATENÇÃO: Tem certeza de que deseja apagar permanentemente esta viagem?\n\nEsta ação excluirá o protocolo e todo o histórico de rastreamento.');
      if (!confirmDelete) return;

      let pinToSend = userAuthPin;
      if (!isCreatorAuth && !userAuthToken && !pinToSend) {
        pinToSend = prompt('Digite seu PIN de segurança para autorizar a exclusão:');
        if (!pinToSend) return;
      }

      try {
        const headers = { 'Content-Type': 'application/json' };
        if (userAuthToken) headers['x-creator-token'] = userAuthToken;
        if (pinToSend) headers['x-creator-pin'] = pinToSend;

        const res = await fetch(`/api/viagens/${tripId}`, {
          method: 'DELETE',
          headers,
          body: JSON.stringify({ pin: pinToSend, token: userAuthToken })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Falha ao apagar viagem.');

        stop5MinuteAutoTracking();
        localStorage.removeItem(`insanos_trip_${tripId}`);
        sessionStorage.removeItem('tracker_trip_id');
        sessionStorage.removeItem('on_tracker_page');

        alert('✓ Viagem apagada com sucesso!');
        window.location.href = '/';
      } catch (e) {
        alert('⚠️ ' + e.message);
      }
    });
  }

  // Edit trip listener & modal
  const btnEditTrip = document.getElementById('btnEditTrip');
  const editTripModal = document.getElementById('editTripModal');
  const btnCancelEditModal = document.getElementById('btnCancelEditModal');
  const btnCancelEditTrip = document.getElementById('btnCancelEditTrip');
  const editTripForm = document.getElementById('editTripForm');
  const editPinConfirmBox = document.getElementById('editPinConfirmBox');

  const closeEditModal = () => {
    if (editTripModal) editTripModal.classList.remove('active');
  };
  if (btnCancelEditModal) btnCancelEditModal.addEventListener('click', closeEditModal);
  if (btnCancelEditTrip) btnCancelEditTrip.addEventListener('click', closeEditModal);

  if (btnEditTrip) {
    btnEditTrip.addEventListener('click', () => {
      if (!currentTrip) return;
      document.getElementById('editOrigem').value = currentTrip.origem || '';
      document.getElementById('editDestino').value = currentTrip.destino || '';
      document.getElementById('editDataSaida').value = currentTrip.data_saida || '';
      document.getElementById('editHoraSaida').value = currentTrip.hora_saida || '';
      document.getElementById('editPrevisao').value = currentTrip.previsao_chegada || '';
      document.getElementById('editDataRetorno').value = currentTrip.data_retorno || '';

      const tipoSel = document.getElementById('editTransporteTipo');
      if (tipoSel) tipoSel.value = currentTrip.transporte_tipo || 'MOTO';
      document.getElementById('editTransportePlaca').value = currentTrip.transporte_placa || '';
      document.getElementById('editTransporteModelo').value = [currentTrip.transporte_marca, currentTrip.transporte_modelo].filter(Boolean).join(' ') || '';

      document.getElementById('editQuemVaiJunto').value = currentTrip.quem_vai_junto || '';
      document.getElementById('editEmergenciaContato').value = currentTrip.emergencia_contato || '';
      document.getElementById('editEmergenciaTelefone').value = currentTrip.emergencia_telefone || '';

      document.getElementById('editNotas').value = currentTrip.observacoes_notas || '';
      document.getElementById('editResumo').value = currentTrip.observacoes_resumo || '';

      if (editPinConfirmBox) {
        editPinConfirmBox.style.display = (!isCreatorAuth && !userAuthPin) ? 'block' : 'none';
      }

      editTripModal.classList.add('active');
    });
  }

  if (editTripForm) {
    editTripForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveBtn = document.getElementById('btnSaveEditTrip');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Salvando...';

      let pinToSend = userAuthPin;
      if (!isCreatorAuth && !userAuthToken) {
        const inputPin = document.getElementById('editPinInput')?.value.trim();
        if (inputPin) pinToSend = inputPin;
      }

      const payload = {
        origem: document.getElementById('editOrigem').value.trim(),
        destino: document.getElementById('editDestino').value.trim(),
        data_saida: document.getElementById('editDataSaida').value,
        hora_saida: document.getElementById('editHoraSaida').value,
        previsao_chegada: document.getElementById('editPrevisao').value.trim(),
        data_retorno: document.getElementById('editDataRetorno').value,
        transporte_tipo: document.getElementById('editTransporteTipo').value,
        transporte_placa: document.getElementById('editTransportePlaca').value.trim(),
        transporte_modelo: document.getElementById('editTransporteModelo').value.trim(),
        quem_vai_junto: document.getElementById('editQuemVaiJunto').value.trim(),
        vai_acompanhado: document.getElementById('editQuemVaiJunto').value.trim() ? 'Sim' : 'Não',
        emergencia_contato: document.getElementById('editEmergenciaContato').value.trim(),
        emergencia_telefone: document.getElementById('editEmergenciaTelefone').value.trim(),
        observacoes_notas: document.getElementById('editNotas').value.trim(),
        observacoes_resumo: document.getElementById('editResumo').value.trim(),
        pin: pinToSend,
        token: userAuthToken
      };

      try {
        const headers = { 'Content-Type': 'application/json' };
        if (userAuthToken) headers['x-creator-token'] = userAuthToken;
        if (pinToSend) headers['x-creator-pin'] = pinToSend;

        const res = await fetch(`/api/viagens/${tripId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Falha ao atualizar dados da viagem.');

        closeEditModal();
        alert('✓ Dados da ficha atualizados com sucesso!');
        loadTripData(tripId);
      } catch (err) {
        alert('⚠️ ' + err.message);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Salvar Alterações 💾';
      }
    });
  }
}
