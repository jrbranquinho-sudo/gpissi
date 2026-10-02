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
    : Math.max(35, Math.min(100, tripDirectKm * 0.3));

  const dist = distToSegmentKm(pLat, pLng, oLat, oLon, dLat, dLon);
  return dist <= effectiveMaxOffset;
}

function formatDateBR(dateString) {
  if (!dateString) return 'A definir';
  const parts = String(dateString).split('-');
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
  const busCheck = tTipo === 'ÔNIBUS' ? `[X] ÔNIBUS${vSuffix}` : '[ ] ÔNIBUS';

  const statusUpper = String(viagem.status || 'EM ANDAMENTO').toUpperCase();
  let statusLine = '🔴 STATUS: EM ANDAMENTO (NA ESTRADA)';
  if (statusUpper === 'CONCLUÍDA' || statusUpper === 'CONCLUIDA') {
    statusLine = '🟢 STATUS: CONCLUÍDA (DESTINO ALCANÇADO)';
  } else if (statusUpper === 'CANCELADA') {
    statusLine = '⚪ STATUS: CANCELADA';
  }

  const vaiAcomp = viagem.vai_acompanhado === 'Sim' ? 'Sim' : 'Não';
  const quemJunto = vaiAcomp === 'Sim' ? (viagem.quem_vai_junto || 'Não informado') : 'Nenhum (Solo)';

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

const gpsUtils = {
  isValidCoordinate,
  extractMunicipality,
  buildTrackFeature,
  buildGpsCheckin,
  distToSegmentKm,
  isPointInRouteCorridor,
  formatDateBR,
  buildWhatsAppProtocolMessage
};

if (typeof module !== 'undefined' && module.exports) module.exports = gpsUtils;
if (typeof globalThis !== 'undefined') globalThis.GPISSIGps = gpsUtils;