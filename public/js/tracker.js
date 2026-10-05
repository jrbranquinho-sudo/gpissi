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

// 5-second GPS tracking timer & continuous GPS watcher
const TRACK_INTERVAL_SECONDS = 5; // Intervalo de 5 segundos
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

  // Auto-refresh for viewers every 5 seconds (tempo real)
  setInterval(() => {
    if (currentTrip && currentTrip.status === 'EM ANDAMENTO') {
      loadTripData(tripId, true, shareToken);
    }
  }, 5000);

  setupEventListeners(tripId);
  setupNetworkListeners(tripId);

  // Inicializa verificação de fila offline
  const offlineCount = getOfflineQueue(tripId).length;
  if (!navigator.onLine || offlineCount > 0) {
    showOfflineNotice(!navigator.onLine, offlineCount);
  }
  if (navigator.onLine && offlineCount > 0) {
    syncOfflineCheckins(tripId);
  }
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
  
  const onReady = () => {
    map.resize();
    if (currentTrip) renderMapElements(currentTrip);
  };
  map.on('load', onReady);
  map.on('styledata', () => {
    map.resize();
    if (currentTrip) renderMapElements(currentTrip);
  });
  window.addEventListener('resize', () => {
    if (map) map.resize();
  });

  const btnFitMap = document.getElementById('btnFitMap');
  if (btnFitMap) {
    btnFitMap.addEventListener('click', () => {
      fitRouteBounds();
    });
  }
}

async function loadTripData(tripId, isSilent = false, shareToken = '') {
  try {
    const headers = {};
    if (userAuthToken) headers['x-creator-token'] = userAuthToken;
    if (userAuthPin) headers['x-creator-pin'] = userAuthPin;

    const shareQuery = shareToken ? `?share=${encodeURIComponent(shareToken)}` : '';
    const res = await fetch(`/api/viagens/${tripId}${shareQuery}`, {
      headers,
      credentials: 'same-origin'
    });
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
  const heroTripTitle = document.getElementById('heroTripTitle');
  if (heroTripTitle) heroTripTitle.innerHTML = `🏍️ INSANO NA ESTRADA - ${(trip.nome_colete || '').toUpperCase()} &bull; <span class="gp-blue">GP</span><span class="issi-orange">ISSI</span>`;
  
  const tripIdBadge = document.getElementById('tripIdBadge');
  if (tripIdBadge) tripIdBadge.textContent = `ID: ${trip.id}`;
  
  if (trip.created_at) {
    const d = new Date(trip.created_at);
    const tripTimestamp = document.getElementById('tripTimestamp');
    if (tripTimestamp) tripTimestamp.textContent = `Registrado em: ${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  }

  // Status Badge
  const isClosed = trip.status === 'CONCLUÍDA';
  const statusContainer = document.getElementById('tripStatusContainer');
  const closedNoticeCard = document.getElementById('closedNoticeCard');
  if (isClosed) {
    if (statusContainer) {
      statusContainer.innerHTML = `
        <div class="status-badge closed">
          <span class="status-dot"></span>
          <span>VIAGEM CONCLUÍDA (CHEGOU COM SEGURANÇA)</span>
        </div>
      `;
    }
    if (closedNoticeCard) closedNoticeCard.style.display = 'block';
    if (trip.closed_at) {
      const d = new Date(trip.closed_at);
      const closedTimestamp = document.getElementById('closedTimestamp');
      if (closedTimestamp) closedTimestamp.textContent = `Encerramento registrado em: ${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    }
    if (trip.encerramento_motivo) {
      const closedNoticeText = document.getElementById('closedNoticeText');
      if (closedNoticeText) closedNoticeText.textContent = `"${trip.encerramento_motivo}"`;
    }
    stop5MinuteAutoTracking();
  } else {
    if (statusContainer) {
      statusContainer.innerHTML = `
        <div class="status-badge open">
          <span class="status-dot"></span>
          <span>EM ANDAMENTO (NA ESTRADA)</span>
        </div>
      `;
    }
    if (closedNoticeCard) closedNoticeCard.style.display = 'none';
  }

  // BOTÕES DE VIAGEM DE RETORNO (VÁLIDOS POR ATÉ 72H)
  const tripAgeMs = trip.created_at ? (Date.now() - new Date(trip.created_at).getTime()) : Infinity;
  const canReturn = tripAgeMs <= 72 * 60 * 60 * 1000;
  const btnReturnTrip = document.getElementById('btnReturnTrip');
  if (btnReturnTrip) {
    if (isClosed && canReturn) {
      btnReturnTrip.style.display = 'flex';
      btnReturnTrip.onclick = () => {
        window.location.href = `/novo?retorno_de=${encodeURIComponent(trip.id)}`;
      };
    } else {
      btnReturnTrip.style.display = 'none';
    }
  }

  const btnReturnTripActive = document.getElementById('btnReturnTripActive');
  if (btnReturnTripActive) {
    if (!isClosed && canReturn) {
      btnReturnTripActive.style.display = 'flex';
      btnReturnTripActive.onclick = () => {
        window.location.href = `/novo?retorno_de=${encodeURIComponent(trip.id)}`;
      };
    } else {
      btnReturnTripActive.style.display = 'none';
    }
  }

  const statRouteName = document.getElementById('statRouteName');
  if (statRouteName) statRouteName.textContent = `${trip.origem || '--'} ➔ ${trip.destino || '--'}`;

  // Estimativa prévia imediata de distância e duração (evita ficar 'Calculando...')
  if (trip.origem_geo && trip.destino_geo) {
    const R = 6371;
    const dLat = (trip.destino_geo.lat - trip.origem_geo.lat) * Math.PI / 180;
    const dLon = (trip.destino_geo.lon - trip.origem_geo.lon) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(trip.origem_geo.lat * Math.PI / 180) * Math.cos(trip.destino_geo.lat * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distEst = Math.round(R * c * 1.25);
    const speed = (trip.transporte_tipo === 'ÔNIBUS' || trip.transporte_tipo === 'ONIBUS') ? 80 : 110;
    const durH = Math.floor(distEst / speed);
    const durM = Math.round(((distEst / speed) % 1) * 60);

    const distEl = document.getElementById('statDistance');
    const durEl = document.getElementById('statDuration');
    if (distEl) distEl.textContent = `${distEst} km`;
    if (durEl) durEl.textContent = `${durH}h ${durM}min`;
  }

  // Integrante
  const valNomeColete = document.getElementById('valNomeColete');
  if (valNomeColete) valNomeColete.textContent = trip.nome_colete || '--';
  const valGrau = document.getElementById('valGrau');
  if (valGrau) valGrau.textContent = trip.grau || 'CAMISETA - X';
  
  const telContainer = document.getElementById('valTelefone');
  if (telContainer) {
    if (trip.telefone) {
      const rawDigits = trip.telefone.replace(/\D/g, '');
      const fullWaNumber = rawDigits.startsWith('55') ? rawDigits : `55${rawDigits}`;
      telContainer.innerHTML = `<a href="https://wa.me/${fullWaNumber}" target="_blank" rel="noopener noreferrer" style="color: #25d366; text-decoration: none; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 700; white-space: nowrap;" title="Conversar no WhatsApp"><span>📱</span> <span>${trip.telefone}</span></a>`;
    } else {
      telContainer.textContent = 'Não informado';
    }
  }

  const valTransporte = document.getElementById('valTransporte');
  if (valTransporte) valTransporte.textContent = trip.transporte_tipo || '--';
  
  let vDesc = trip.transporte_detalhe;
  if (!vDesc && trip.transporte_placa) {
    vDesc = `Placa: ${trip.transporte_placa}`;
  }
  const valTransporteDetalhe = document.getElementById('valTransporteDetalhe');
  if (valTransporteDetalhe) valTransporteDetalhe.textContent = vDesc || 'Nenhum detalhe informado';
  const valAcompanhante = document.getElementById('valAcompanhante');
  if (valAcompanhante) valAcompanhante.textContent = trip.vai_acompanhado === 'Sim' ? (trip.quem_vai_junto || 'Sim (acompanhado)') : 'Não (Solo)';

  // Rota
  const valOrigem = document.getElementById('valOrigem');
  if (valOrigem) valOrigem.textContent = trip.origem || '--';
  const valDestino = document.getElementById('valDestino');
  if (valDestino) valDestino.textContent = trip.destino || '--';
  const valSaida = document.getElementById('valSaida');
  if (valSaida) valSaida.textContent = `${formatDateBR(trip.data_saida)} às ${trip.hora_saida || 'A definir'}`;
  const valPrevisao = document.getElementById('valPrevisao');
  if (valPrevisao) valPrevisao.textContent = trip.previsao_chegada || 'Conforme tráfego';
  const valRetorno = document.getElementById('valRetorno');
  if (valRetorno) valRetorno.textContent = formatDateBR(trip.data_retorno);

  // Emergência
  const valEmergenciaContato = document.getElementById('valEmergenciaContato');
  if (valEmergenciaContato) valEmergenciaContato.textContent = trip.emergencia_contato || 'Não informado';
  const valEmergenciaTel = document.getElementById('valEmergenciaTel');
  if (valEmergenciaTel) valEmergenciaTel.textContent = trip.emergencia_telefone || 'Não informado';

  const callBtn = document.getElementById('btnCallEmergencia');
  if (callBtn) {
    if (trip.emergencia_telefone) {
      const rawTel = trip.emergencia_telefone.replace(/\D/g, '');
      callBtn.href = `tel:${rawTel}`;
      callBtn.style.display = 'inline-flex';
    } else {
      callBtn.style.display = 'none';
    }
  }

  // Notas
  const valNotas = document.getElementById('valNotas');
  if (valNotas) valNotas.textContent = trip.observacoes_notas || 'Nenhuma anotação informada.';
  const valResumo = document.getElementById('valResumo');
  if (valResumo) valResumo.textContent = trip.observacoes_resumo || 'Sem relato prévio.';

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
  if (googleBtn) {
    if (trip.origem && trip.destino) {
      googleBtn.href = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(trip.origem)}&destination=${encodeURIComponent(trip.destino)}`;
    } else {
      googleBtn.href = `https://www.google.com/maps/search/?api=1&query=${targetLat},${targetLng}`;
    }
  }

  const wazeBtn = document.getElementById('btnOpenWaze');
  if (wazeBtn) {
    wazeBtn.href = `https://waze.com/ul?ll=${targetLat},${targetLng}&navigate=yes`;
  }

  const appleBtn = document.getElementById('btnOpenAppleMaps');
  if (appleBtn) {
    appleBtn.href = `https://maps.apple.com/?daddr=${targetLat},${targetLng}&dirflg=d`;
  }
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
    if (activeActions) activeActions.style.display = 'none';
    if (authPrompt) authPrompt.style.display = 'none';
    if (gpsStatusBox) gpsStatusBox.style.display = 'none';
    if (authMsg) authMsg.innerHTML = '<span style="color: var(--accent-green); font-weight: bold;">✓ Este protocolo de viagem já foi encerrado pelo autor.</span>';
    // Allow creator to delete even if closed
    if (isCreatorAuth && btnDeleteTrip) {
      if (activeActions) activeActions.style.display = 'flex';
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
    if (authMsg) authMsg.innerHTML = '<strong>👑 Autenticado como Piloto:</strong> Você registrou este protocolo. O rastreamento atualiza seu trajeto e pontos de passagem a cada 5 segundos ou ao registrar sinal de internet:';
    if (activeActions) activeActions.style.display = 'flex';
    if (authPrompt) authPrompt.style.display = 'none';
    if (gpsStatusBox) gpsStatusBox.style.display = 'block';
    if (btnEditTrip) btnEditTrip.style.display = 'flex';
    if (btnDeleteTrip) btnDeleteTrip.style.display = 'flex';
  } else {
    if (authMsg) authMsg.innerHTML = '🔒 <strong>Modo Acompanhamento:</strong> Você está visualizando o rastreamento em tempo real. Apenas o integrante responsável possui autorização para gerenciar a viagem.';
    if (activeActions) activeActions.style.display = 'none';
    if (authPrompt) authPrompt.style.display = 'none';
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
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
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

// 5-SECOND AUTOMATIC GPS TRACKING LOGIC (WITH REALTIME PASSAGE POINTS & OFFLINE RESILIENCE)
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

  // Intervalo de segurança a cada 5 segundos
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

      // Se não há internet, guarda na fila offline localmente
      if (!navigator.onLine) {
        saveOfflineCheckin(tripId, pointData);
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

      // Timeout de 5s para evitar travamento em zonas de sombra de operadora com sinal fraco
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(`/api/viagens/${tripId}/checkin`, {
        method: 'POST',
        headers,
        body: JSON.stringify(pointData),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error('Servidor retornou erro ao gravar ponto.');
      }

      showOfflineNotice(false);
      loadTripData(tripId, true, shareToken);

      // Sincroniza qualquer ponto que tenha ficado acumulado offline
      syncOfflineCheckins(tripId);

    } catch (err) {
      console.warn('Sombra de sinal / falha de rede ao transmitir ponto GPS:', err.message);
      saveOfflineCheckin(tripId, {
        lat,
        lng,
        timestamp: new Date(timestampMs || Date.now()).toISOString(),
        descricao: isAutomatic ? 'Ponto gravado offline (sombra de sinal)' : 'Ponto marcado no trajeto',
        cidade: currentTrip?.last_city || 'Localização GPS',
        isOffline: true
      });
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
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
  );
}

// OFFLINE QUEUE MANAGEMENT (Preserva até 1000 pontos no celular e descarrega quando a internet volta)
function getOfflineQueue(tripId) {
  try {
    const key = `insanos_offline_points_${tripId}`;
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch (e) {
    return [];
  }
}

function saveOfflineCheckin(tripId, point) {
  try {
    const key = `insanos_offline_points_${tripId}`;
    const queue = getOfflineQueue(tripId);
    // Evita duplicatas idênticas no mesmo segundo
    const isDup = queue.some(p => Math.abs(p.lat - point.lat) < 0.0001 && Math.abs(p.lng - point.lng) < 0.0001 && p.timestamp === point.timestamp);
    if (!isDup) {
      queue.push(point);
      localStorage.setItem(key, JSON.stringify(queue.slice(-1000))); // Guarda até 1000 pontos (~3 horas sem sinal)
      console.log(`[GPISSI Offline] Ponto gravado na memória do celular. Total acumulado: ${queue.length}.`);
    }
    showOfflineNotice(true, queue.length);
  } catch (e) {
    console.error('Erro ao salvar offline:', e);
  }
}

let isSyncingOffline = false;
async function syncOfflineCheckins(tripId) {
  if (isSyncingOffline) return;
  try {
    const key = `insanos_offline_points_${tripId}`;
    const queue = getOfflineQueue(tripId);
    if (queue.length === 0) return;

    isSyncingOffline = true;
    const headers = { 'Content-Type': 'application/json' };
    if (userAuthToken) headers['x-creator-token'] = userAuthToken;
    if (userAuthPin) headers['x-creator-pin'] = userAuthPin;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(`/api/viagens/${tripId}/checkin`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ batch: queue }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      localStorage.removeItem(key);
      showOfflineNotice(false);
      loadTripData(tripId, true, shareToken);
      showSyncSuccessToast(queue.length);
      console.log(`✓ [GPISSI Sincronização] Descarregados com sucesso ${queue.length} pontos offline no banco de dados.`);
    }
  } catch (e) {
    console.warn('Tentativa de sincronização offline aguarda restabelecimento do sinal de internet:', e.message);
  } finally {
    isSyncingOffline = false;
  }
}

function showSyncSuccessToast(count) {
  const banner = document.getElementById('offlineNoticeBanner');
  if (banner) {
    banner.style.display = 'block';
    banner.style.background = 'rgba(0, 230, 118, 0.12)';
    banner.style.borderColor = 'rgba(0, 230, 118, 0.4)';
    banner.style.color = '#00e676';
    banner.innerHTML = `✓ <strong>Conexão restabelecida!</strong> ${count} ponto(s) do histórico de rota gravados offline foram descarregados com sucesso no GPISSI.`;
    setTimeout(() => {
      banner.style.display = 'none';
      banner.style.background = 'rgba(255, 170, 0, 0.12)';
      banner.style.borderColor = 'rgba(255, 170, 0, 0.4)';
      banner.style.color = '#ffaa00';
    }, 6000);
  }
}

function showOfflineNotice(isOffline, count = null) {
  const banner = document.getElementById('offlineNoticeBanner');
  const badge = document.getElementById('signalStatusBadge');
  const tripId = sessionStorage.getItem('tracker_trip_id') || currentTrip?.id;
  const currentCount = count !== null ? count : (tripId ? getOfflineQueue(tripId).length : 0);

  if (isOffline || currentCount > 0) {
    if (banner) {
      banner.style.display = 'block';
      banner.innerHTML = `⚠️ <strong>Sombra de Sinal de Operadora:</strong> Sem conexão no momento. As coordenadas continuam sendo registradas pelo satélite GPS e salvas na memória do celular (<strong>${currentCount} ponto(s) seguro(s)</strong>). O trajeto completo será descarregado automaticamente no banco de dados assim que a rede voltar.`;
    }
    if (badge) {
      badge.style.color = '#ffaa00';
      badge.style.background = 'rgba(255,170,0,0.15)';
      badge.innerHTML = `⚠️ Sinal: Sombra de Operadora (${currentCount} pontos offline)`;
    }
  } else {
    if (banner && banner.style.color !== 'rgb(0, 230, 118)') banner.style.display = 'none';
    if (badge) {
      badge.style.color = '#00e676';
      badge.style.background = 'rgba(0,230,118,0.1)';
      badge.innerHTML = '📶 Sinal: Conectado (Tempo Real)';
    }
  }
}

let wakeLockSentinel = null;
async function requestScreenWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLockSentinel) {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
      });
      console.log('Screen Wake Lock ativo.');
    }
  } catch (err) {
    console.warn('Screen Wake Lock indisponível:', err.message);
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

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (currentTrip && currentTrip.status === 'EM ANDAMENTO') {
        if (isCreatorAuth) requestScreenWakeLock();
        loadTripData(tripId, true, shareToken);
        if (isCreatorAuth) {
          syncOfflineCheckins(tripId).finally(() => transmitGpsLocation(tripId, true));
        }
      }
    }
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
    const onStyleReady = () => {
      if (map.isStyleLoaded()) {
        map.off('styledata', onStyleReady);
        map.off('load', onStyleReady);
        renderMapElements(trip);
      }
    };
    map.on('styledata', onStyleReady);
    map.on('load', onStyleReady);
    return;
  }

  // Clear existing markers
  if (originMarker) originMarker.remove();
  if (destMarker) destMarker.remove();
  checkinMarkers.forEach(m => m.remove());
  checkinMarkers = [];

  // 1. Origin Marker (Partida com a Caveira dos Insanos MC)
  const elOrigin = document.createElement('div');
  elOrigin.className = 'custom-maplibre-marker';
  elOrigin.innerHTML = `<div style="background: #ff6600; color: #fff; width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 3px solid #000; box-shadow: 0 0 20px rgba(255, 102, 0, 0.9);"><img src="/images/caveirasembg.png" style="height: 24px; width: auto;" alt="Caveira Insanos MC"></div>`;

  elOrigin.title = `Partida (Origem): ${trip.origem}`;
  if (hasOrigin) originMarker = new maplibregl.Marker({ element: elOrigin })
    .setLngLat([oGeo.lon, oGeo.lat])
    .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(`
      <div style="font-family: sans-serif; color: #000;">
        <strong>Partida (Origem):</strong><br>${trip.origem}<br>
        <small>Saída: ${formatDateBR(trip.data_saida)} às ${trip.hora_saida}</small>
      </div>
    `))
    .addTo(map);

  // 2. Destination Marker (Destino Final / Chegada com Bandeira Quadriculada Verde)
  const elDest = document.createElement('div');
  elDest.className = 'custom-maplibre-marker';
  elDest.innerHTML = `<div style="background: #00e676; color: #000; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 800; border: 3px solid #000; box-shadow: 0 0 18px rgba(0, 230, 118, 0.9);">🏁</div>`;

  elDest.title = `Destino Final: ${trip.destino}`;
  if (hasDestination) destMarker = new maplibregl.Marker({ element: elDest })
    .setLngLat([dGeo.lon, dGeo.lat])
    .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(`
      <div style="font-family: sans-serif; color: #000;">
        <strong>Destino Final (Chegada):</strong><br>${trip.destino}<br>
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
  const btnCloseTrip = document.getElementById('btnCloseTrip');
  const closeTripModal = document.getElementById('closeTripModal');
  const btnCancelCloseModal = document.getElementById('btnCancelCloseModal');
  const btnCancelCloseTrip = document.getElementById('btnCancelCloseTrip');
  const btnConfirmCloseTrip = document.getElementById('btnConfirmCloseTrip');

  if (btnCloseTrip) {
    btnCloseTrip.addEventListener('click', () => {
      if (closeTripModal) closeTripModal.classList.add('active');
    });
  }

  const closeModal = () => {
    if (closeTripModal) closeTripModal.classList.remove('active');
  };
  if (btnCancelCloseModal) btnCancelCloseModal.addEventListener('click', closeModal);
  if (btnCancelCloseTrip) btnCancelCloseTrip.addEventListener('click', closeModal);

  if (btnConfirmCloseTrip) {
    btnConfirmCloseTrip.addEventListener('click', async () => {
      const motivo = document.getElementById('closeMotivoInput').value.trim();

      btnConfirmCloseTrip.disabled = true;
      btnConfirmCloseTrip.textContent = 'Encerrando...';

      try {
        // Descarrega qualquer ponto offline pendente antes de fechar o protocolo
        if (navigator.onLine) {
          try { await syncOfflineCheckins(tripId); } catch (_) {}
        }

        const headers = { 'Content-Type': 'application/json' };
        if (userAuthToken) headers['x-creator-token'] = userAuthToken;

        const res = await fetch(`/api/viagens/${tripId}/encerrar`, {
          method: 'POST',
          headers,
          credentials: 'same-origin',
          body: JSON.stringify({
            motivo,
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
  }

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

      try {
        const headers = { 'Content-Type': 'application/json' };
        if (userAuthToken) headers['x-creator-token'] = userAuthToken;

        const res = await fetch(`/api/viagens/${tripId}`, {
          method: 'DELETE',
          headers,
          credentials: 'same-origin',
          body: JSON.stringify({ token: userAuthToken })
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

      if (editTripModal) editTripModal.classList.add('active');
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
