const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateDurationSeconds } = require('../route-estimate');
const auth = require('../auth');
const gps = require('../public/js/gps-utils');

test('moto e carro usam média de 110 km/h', () => {
  assert.deepEqual(estimateDurationSeconds(110, 'MOTO'), {
    durationSeconds: 3600,
    averageSpeedKmh: 110,
    stopMinutes: 0
  });
  assert.equal(estimateDurationSeconds(110, 'CARRO').durationSeconds, 3600);
});

test('ônibus usa média de 80 km/h', () => {
  assert.deepEqual(estimateDurationSeconds(80, 'ÔNIBUS'), {
    durationSeconds: 3600,
    averageSpeedKmh: 80,
    stopMinutes: 0
  });
});

test('adiciona 20 minutos apenas acima de 220 km', () => {
  assert.equal(estimateDurationSeconds(220, 'MOTO').stopMinutes, 0);
  assert.equal(estimateDurationSeconds(221, 'MOTO').durationSeconds, (221 / 110) * 3600 + 1200);
  assert.equal(estimateDurationSeconds(221, 'ÔNIBUS').stopMinutes, 20);
});

test('sequência visual tem seis letras e valida somente seu HMAC', () => {
  const userId = 'user-1';
  const secret = 'test-secret';
  const code = auth.generateChallengeCode();
  const hash = auth.hashChallengeCode(userId, code, secret);
  assert.match(code, /^[A-Z]{6}$/);
  assert.equal(auth.verifyChallengeCode(userId, code, hash, secret), true);
  assert.equal(auth.verifyChallengeCode(userId, code === 'AAAAAA' ? 'BBBBBB' : 'AAAAAA', hash, secret), false);
  assert.equal(auth.verifyChallengeCode('other-user', code, hash, secret), false);
  assert.notEqual(auth.generateChallengeCode(code), code);
});

test('valida coordenadas e monta a linha do percurso GPS em ordem', () => {
  assert.equal(gps.isValidCoordinate(-17.3, -48.42), true);
  assert.equal(gps.isValidCoordinate(91, -48.42), false);
  assert.deepEqual(gps.buildTrackFeature([
    { lat: -17.3, lng: -48.28 },
    { lat: -17.32, lng: -48.42 },
    { lat: 100, lng: -48 }
  ]).geometry.coordinates, [[-48.28, -17.3], [-48.42, -17.32]]);
  assert.equal(gps.buildTrackFeature([{ lat: -17.3, lng: -48.28 }]), null);
});

test('reverse geocoding prefere o município e inclui a UF', () => {
  assert.equal(gps.extractMunicipality({ village: 'Palmelo', 'ISO3166-2-lvl4': 'BR-GO' }), 'Palmelo - GO');
  assert.equal(gps.extractMunicipality({ county: 'Pires do Rio', state_code: 'GO' }), 'Pires do Rio - GO');
  assert.equal(gps.extractMunicipality({ road: 'GO-020' }), '');
});

test('registra uma passagem com cidade e horário quando o GPS entra em outro município', () => {
  const checkin = gps.buildGpsCheckin({
    lat: -17.326,
    lng: -48.422,
    timestamp: '2026-09-28T12:00:00.000Z',
    reverseGeocodedCity: 'Palmelo - GO'
  }, 'Pires do Rio - GO');
  assert.equal(checkin.tipo, 'city_passage');
  assert.equal(checkin.cidade, 'Palmelo - GO');
  assert.equal(checkin.descricao, 'Passagem por Palmelo - GO');
  assert.equal(checkin.timestamp, '2026-09-28T12:00:00.000Z');

  const repeated = gps.buildGpsCheckin({ lat: -17.326, lng: -48.422, reverseGeocodedCity: 'Palmelo - GO' }, 'Palmelo - GO');
  assert.equal(repeated.tipo, 'gps');
});

test('validação de corredor de rota aceita cidades do trajeto e rejeita IP de provedor fora da rota (Catalão)', () => {
  const origemPires = { lat: -17.30138, lon: -48.27868 };
  const destinoCaldas = { lat: -17.74083, lon: -48.63815 };

  // Palmelo fica no trajeto entre Pires do Rio e Caldas Novas (~10km do eixo)
  const palmelo = { lat: -17.326, lng: -48.422 };
  assert.equal(gps.isPointInRouteCorridor(palmelo.lat, palmelo.lng, origemPires, destinoCaldas), true);

  // Catalão fica a ~87km fora do eixo da viagem (localização de IP de provedor)
  const catalao = { lat: -18.1602, lng: -47.9354 };
  assert.equal(gps.isPointInRouteCorridor(catalao.lat, catalao.lng, origemPires, destinoCaldas), false);
});

test('buildWhatsAppProtocolMessage gera a ficha completa com formatação oficial do Insanos MC', () => {
  const viagemMock = {
    id: 'INS-AMMH-9638',
    status: 'EM ANDAMENTO',
    origem: 'Caldas Novas - GO',
    data_saida: '2026-09-27',
    hora_saida: '18:20',
    destino: 'Pires do Rio - GO',
    previsao_chegada: '19:27 (69 km | ~1h 7min)',
    data_retorno: '2026-09-27',
    nome_colete: 'White',
    grau: 'EXPANSÃO REGIONAL - V',
    telefone: '(64) 99262-2700',
    transporte_tipo: 'CARRO',
    transporte_placa: 'QTR-7C39',
    transporte_detalhe: 'Placa: QTR-7C39 | JEEP COMPASS',
    vai_acompanhado: 'Sim',
    quem_vai_junto: 'Juliana',
    emergencia_contato: 'Juliana',
    emergencia_telefone: '(26) 22700-',
    observacoes_notas: '',
    observacoes_resumo: ''
  };

  const url = 'https://gpissi.vercel.app/tracker?id=INS-AMMH-9638';
  const msg = gps.buildWhatsAppProtocolMessage(viagemMock, url);

  assert.match(msg, /\*GPISSI - PROTOCOLO DE VIAGEM - INSANOS MC\*/);
  assert.match(msg, /🏍️ INSANO NA ESTRADA/);
  assert.match(msg, /Origem: Caldas Novas - GO/);
  assert.match(msg, /Data de Saída: 27\/09\/2026/);
  assert.match(msg, /Hora de Saída: 18:20/);
  assert.match(msg, /Destino: Pires do Rio - GO/);
  assert.match(msg, /Previsão de Chegada: 19:27 \(69 km \| ~1h 7min\)/);
  assert.match(msg, /Nome do Colete: White/);
  assert.match(msg, /Função\/Grau: EXPANSÃO REGIONAL - V/);
  assert.match(msg, /\[X\] CARRO \(Placa: QTR-7C39 \| JEEP COMPASS\)/);
  assert.match(msg, /\[ \] MOTO/);
  assert.match(msg, /Quem vai junto\? Juliana/);
  assert.match(msg, /🔴 STATUS: EM ANDAMENTO \(NA ESTRADA\)/);
  assert.match(msg, /https:\/\/gpissi\.vercel\.app\/tracker\?id=INS-AMMH-9638/);
  assert.match(msg, /\*\(Ficha válida por até 72h\)\*/);
});

test('haversineDistanceKm e isAtDestination calculam proximidade do destino', () => {
  const p1 = { lat: -23.5505, lon: -46.6333 }; // Marco Zero SP
  const p2 = { lat: -23.5510, lon: -46.6340 }; // ~100 metros
  const p3 = { lat: -22.9068, lon: -43.1729 }; // Rio de Janeiro (~360 km)

  const distClose = gps.haversineDistanceKm(p1.lat, p1.lon, p2.lat, p2.lon);
  assert.ok(distClose < 0.2);
  assert.equal(gps.isAtDestination(p2, p1, 1.5), true);

  const distFar = gps.haversineDistanceKm(p1.lat, p1.lon, p3.lat, p3.lon);
  assert.ok(distFar > 300 && distFar < 400);
  assert.equal(gps.isAtDestination(p3, p1, 1.5), false);
});

test('evaluateTripOverdue identifica quando o piloto ultrapassa a previsão sem chegar', () => {
  const baseTrip = {
    id: 'TRIP-TEST-1',
    status: 'EM ANDAMENTO',
    data_saida: '2026-10-05',
    hora_saida: '08:00',
    previsao_chegada: '12:00 (400 km | 4h)',
    destino_geo: { lat: -17.7408, lon: -48.6381 },
    checkins: [
      { lat: -17.326, lng: -48.422, timestamp: '2026-10-05T11:30:00Z', cidade: 'Palmelo - GO' }
    ]
  };

  // 12:15 -> previsão é 12:00, com tolerância de 30m limite é 12:30 -> NÃO deve alertar ainda
  const time1215 = new Date('2026-10-05T12:15:00').getTime();
  const res1215 = gps.evaluateTripOverdue(baseTrip, time1215, 30);
  assert.equal(res1215.isOverdue, false);

  // 12:45 -> 45 minutos após a previsão (ultrapassou tolerância de 30m) -> DEVE alertar
  const time1245 = new Date('2026-10-05T12:45:00').getTime();
  const res1245 = gps.evaluateTripOverdue(baseTrip, time1245, 30);
  assert.equal(res1245.isOverdue, true);
  assert.equal(res1245.overdueMinutes, 45);
  assert.equal(res1245.lastLocation.cidade, 'Palmelo - GO');

  // Se o piloto chegou no destino (distância < 1.5km), não deve alertar mesmo após o horário
  const arrivedTrip = {
    ...baseTrip,
    checkins: [
      { lat: -17.7405, lng: -48.6380, timestamp: '2026-10-05T12:40:00Z', cidade: 'Caldas Novas - GO' }
    ]
  };
  const resArrived = gps.evaluateTripOverdue(arrivedTrip, time1245, 30);
  assert.equal(resArrived.isOverdue, false);
  assert.equal(resArrived.arrivedAtDestination, true);

  // Se a viagem está CONCLUÍDA, não deve alertar
  const closedTrip = { ...baseTrip, status: 'CONCLUÍDA' };
  const resClosed = gps.evaluateTripOverdue(closedTrip, time1245, 30);
  assert.equal(resClosed.isOverdue, false);
});