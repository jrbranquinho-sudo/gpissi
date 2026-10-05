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

function distToSegmentKm(pLat, pLng, aLat, aLng, bLat, bLng) {
  if (!isValidCoordinate(pLat, pLng) || !isValidCoordinate(aLat, aLng) || !isValidCoordinate(bLat, bLng)) {
    return Infinity;
  }
  const midLat = ((Number(aLat) + Number(bLat)) / 2) * (Math.PI / 180);
  const kx = Math.cos(midLat) * 111.32;
  const ky = 110.574;

  const ax = Number(aLng) * kx;
  const ay = Number(aLat) * ky;
  const bx = Number(bLng) * kx;
  const by = Number(bLat) * ky;
  const px = Number(pLng) * kx;
  const py = Number(pLat) * ky;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function isPointInRouteCorridor(pLat, pLng, origemGeo, destinoGeo, maxOffsetKm) {
  if (!origemGeo || !destinoGeo) return true;
  const oLat = origemGeo.lat || origemGeo.latitude;
  const oLon = origemGeo.lon || origemGeo.lng || origemGeo.longitude;
  const dLat = destinoGeo.lat || destinoGeo.latitude;
  const dLon = destinoGeo.lon || destinoGeo.lng || destinoGeo.longitude;

  if (!isValidCoordinate(oLat, oLon) || !isValidCoordinate(dLat, dLon)) return true;

  const tripDirectKm = distToSegmentKm(dLat, dLon, oLat, oLon, oLat, oLon);
  const effectiveMaxOffset = Number.isFinite(maxOffsetKm) && maxOffsetKm > 0
    ? maxOffsetKm
    : Math.max(35, Math.min(120, tripDirectKm * 0.4));

  const dist = distToSegmentKm(pLat, pLng, oLat, oLon, dLat, dLon);
  return dist <= effectiveMaxOffset;
}

function formatDateBR(dateString) {
  if (!dateString) return 'A definir';
  const cleanDate = String(dateString).split('T')[0];
  const parts = cleanDate.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return String(dateString);
}

function buildWhatsAppProtocolMessage(viagem, trackerUrl) {
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

  const notas = viagem.observacoes_notas && viagem.observacoes_notas.trim()
    ? viagem.observacoes_notas.trim()
    : 'Nenhuma observação informada.';
  const resumo = viagem.observacoes_resumo && viagem.observacoes_resumo.trim()
    ? viagem.observacoes_resumo.trim()
    : 'Sem relato prévio.';

  const urlFinal = trackerUrl || (viagem.id ? `https://gpissi.vercel.app/tracker?id=${viagem.id}` : '');

  return `*GPISSI - PROTOCOLO DE VIAGEM - INSANOS MC*
🏍️ INSANO NA ESTRADA

📍 INFORMAÇÕES DA ROTA
Origem: ${viagem.origem || 'Não informada'}
Data de Saída: ${formatDateBR(viagem.data_saida)}
Hora de Saída: ${viagem.hora_saida || 'A definir'}
Destino: ${viagem.destino || 'Não informado'}
Previsão de Chegada: ${viagem.previsao_chegada || 'Conforme condições de tráfego'}
Data de Retorno: ${formatDateBR(viagem.data_retorno || viagem.data_saida)}

👤 DADOS DO INTEGRANTE
Nome do Colete: ${viagem.nome_colete || 'Não informado'}
Função/Grau: ${viagem.grau || 'Integrante'}
Telefone: ${viagem.telefone || 'Não informado'}

🚌 VEÍCULO
${motoCheck}
${carroCheck}
${busCheck}

👥 ACOMPANHANTE(S)
Vai acompanhado? ${vaiAcomp}
Quem vai junto? ${quemJunto}

🆘 EMERGÊNCIA
Contato: ${viagem.emergencia_contato || 'Não informado'}
Telefone: ${viagem.emergencia_telefone || 'Não informado'}

📝 OBSERVAÇÕES E RESUMO
Notas: ${notas}
Resumo: ${resumo}

${statusLine}
🗺️ ACOMPANHE EM TEMPO REAL NO MAPA (GPISSI):
${urlFinal}
*(Ficha válida por até 72h)*`;
}

function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  if (!isValidCoordinate(lat1, lon1) || !isValidCoordinate(lat2, lon2)) return Infinity;
  const R = 6371;
  const dLat = (Number(lat2) - Number(lat1)) * (Math.PI / 180);
  const dLon = (Number(lon2) - Number(lon1)) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(Number(lat1) * (Math.PI / 180)) * Math.cos(Number(lat2) * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function isAtDestination(lastPoint, destinoGeo, thresholdKm = 1.5) {
  if (!lastPoint || !destinoGeo) return false;
  const pLat = lastPoint.lat ?? lastPoint.latitude;
  const pLng = lastPoint.lng ?? lastPoint.lon ?? lastPoint.longitude;
  const dLat = destinoGeo.lat ?? destinoGeo.latitude;
  const dLon = destinoGeo.lon ?? destinoGeo.lng ?? destinoGeo.longitude;
  const dist = haversineDistanceKm(pLat, pLng, dLat, dLon);
  return dist <= thresholdKm;
}

function parseEstimatedArrivalMs(viagem) {
  if (!viagem) return null;
  if (viagem.estimated_arrival_iso) {
    const t = Date.parse(viagem.estimated_arrival_iso);
    if (!Number.isNaN(t)) return t;
  }

  const prevStr = String(viagem.previsao_chegada || '');
  const match = prevStr.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const [_, arrH, arrM] = match;
  const baseDateStr = viagem.data_saida
    ? String(viagem.data_saida).split('T')[0]
    : (viagem.created_at ? String(viagem.created_at).split('T')[0] : new Date().toISOString().split('T')[0]);

  const [y, mo, d] = baseDateStr.split('-').map(Number);
  if (!y || !mo || !d) return null;

  const arrivalDate = new Date(y, mo - 1, d, Number(arrH), Number(arrM), 0, 0);

  if (viagem.hora_saida) {
    const [depH, depM] = String(viagem.hora_saida).split(':').map(Number);
    if (Number.isFinite(depH) && (Number(arrH) < depH || (Number(arrH) === depH && Number(arrM) < (depM || 0)))) {
      arrivalDate.setDate(arrivalDate.getDate() + 1);
    }
  }

  return arrivalDate.getTime();
}

function evaluateTripOverdue(viagem, nowMs = Date.now(), toleranceMinutes = 30) {
  if (!viagem || viagem.status !== 'EM ANDAMENTO') {
    return {
      isOverdue: false,
      overdueMinutes: 0,
      arrivedAtDestination: viagem?.status === 'CONCLUÍDA',
      estimatedArrivalMs: null,
      lastLocation: null
    };
  }

  const checkins = Array.isArray(viagem.checkins) ? viagem.checkins : [];
  const lastLocation = viagem.last_location || (checkins.length > 0 ? checkins[checkins.length - 1] : null);

  const arrived = isAtDestination(lastLocation, viagem.destino_geo);
  if (arrived) {
    return {
      isOverdue: false,
      overdueMinutes: 0,
      arrivedAtDestination: true,
      estimatedArrivalMs: null,
      lastLocation
    };
  }

  const arrivalMs = parseEstimatedArrivalMs(viagem);
  if (!arrivalMs) {
    return {
      isOverdue: false,
      overdueMinutes: 0,
      arrivedAtDestination: false,
      estimatedArrivalMs: null,
      lastLocation
    };
  }

  const toleranceMs = toleranceMinutes * 60 * 1000;
  const isOverdue = nowMs > (arrivalMs + toleranceMs);
  const overdueMinutes = isOverdue ? Math.floor((nowMs - arrivalMs) / 60000) : 0;

  return {
    isOverdue,
    overdueMinutes,
    arrivedAtDestination: false,
    estimatedArrivalMs: arrivalMs,
    lastLocation
  };
}

const gpsUtils = {
  isValidCoordinate,
  extractMunicipality,
  buildTrackFeature,
  buildGpsCheckin,
  distToSegmentKm,
  isPointInRouteCorridor,
  formatDateBR,
  buildWhatsAppProtocolMessage,
  haversineDistanceKm,
  isAtDestination,
  parseEstimatedArrivalMs,
  evaluateTripOverdue
};

if (typeof module !== 'undefined' && module.exports) module.exports = gpsUtils;
if (typeof globalThis !== 'undefined') globalThis.GPISSIGps = gpsUtils;