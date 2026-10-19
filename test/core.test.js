const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateDurationSeconds } = require('../route-estimate');
const auth = require('../auth');
const gps = require('../public/js/gps-utils');

test('moto e carro usam média de 110 km/h', () => {
  assert.deepEqual(estimateDurationSeconds(110, 'MOTO'), {
    durationSeconds: 3600,
    averageSpeedKmh: 110,
    stopMinutes: 0,
    stopCount: 0
  });
  assert.equal(estimateDurationSeconds(110, 'CARRO').durationSeconds, 3600);
});

test('ônibus usa média de 80 km/h', () => {
  assert.deepEqual(estimateDurationSeconds(80, 'ÔNIBUS'), {
    durationSeconds: 3600,
    averageSpeedKmh: 80,
    stopMinutes: 0,
    stopCount: 0
  });
});

test('adiciona parada de 25 minutos a cada 2 horas previstas (ex: 7 horas adiciona 3 intervalos)', () => {
  // 110 km = 1h de estrada (sem parada)
  assert.equal(estimateDurationSeconds(110, 'MOTO').stopMinutes, 0);
  assert.equal(estimateDurationSeconds(110, 'MOTO').stopCount, 0);

  // 220 km = 2h exatas de estrada (sem parada)
  assert.equal(estimateDurationSeconds(220, 'MOTO').stopMinutes, 0);
  assert.equal(estimateDurationSeconds(220, 'MOTO').stopCount, 0);

  // 221 km = > 2h de estrada (1 parada de 25 min)
  assert.equal(estimateDurationSeconds(221, 'MOTO').stopCount, 1);
  assert.equal(estimateDurationSeconds(221, 'MOTO').stopMinutes, 25);
  assert.equal(estimateDurationSeconds(221, 'MOTO').durationSeconds, (221 / 110) * 3600 + 1500);

  // 441 km = > 4h de estrada (2 paradas de 25 min = 50 min)
  assert.equal(estimateDurationSeconds(441, 'MOTO').stopCount, 2);
  assert.equal(estimateDurationSeconds(441, 'MOTO').stopMinutes, 50);

  // 770 km a 110 km/h = 7 horas de estrada -> 3 intervalos de 25 minutos = 75 min (1h15m) -> total 8h15m
  const sevenHoursTrip = estimateDurationSeconds(770, 'MOTO');
  assert.equal(sevenHoursTrip.stopCount, 3);
  assert.equal(sevenHoursTrip.stopMinutes, 75);
  assert.equal(sevenHoursTrip.durationSeconds, (7 * 3600) + (3 * 25 * 60)); // 25200 + 4500 = 29700s (8h 15m)
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

test('matchDivision aninha variações de digitação de Pires do Rio à Regional e Comando', () => {
  const { matchDivision } = require('../divisoes');

  const variations = [
    'Divisão Pires do Rio',
    'Divisao Pires do Rio',
    'divisao pires do rio',
    'Divsão Pires do Rio - GO1',
    'Pires do Rio'
  ];

  for (const v of variations) {
    const matched = matchDivision(v);
    assert.equal(matched.divisao, 'Divisão Pires do Rio', `Falhou para variação: ${v}`);
    assert.equal(matched.regional, 'REGIONAL GOIÁS I - GO', `Regional incorreta para: ${v}`);
    assert.equal(matched.comando, 'Comando Regional XLVIII', `Comando incorreto para: ${v}`);
  }
});

test('buildWhatsAppProtocolMessage formata acompanhante com referência única sem duplicidade', () => {
  const viagemComAcomp = {
    id: 'INS-TEST-ACOMP',
    status: 'EM ANDAMENTO',
    origem: 'Goiânia - GO',
    data_saida: '2026-10-14',
    hora_saida: '09:00',
    destino: 'Pires do Rio - GO',
    previsao_chegada: '11:00',
    nome_colete: 'White',
    grau: 'MEMBRO',
    vai_acompanhado: 'Sim',
    acompanhantes: [
      { nome_colete: 'Pedro - neto(a)', grau: 'Neto(a)' },
      { nome_colete: 'Maria', grau: 'Mãe' },
      { nome_colete: 'Carlos', grau: 'Pai' },
      { nome_colete: 'Ana', grau: 'Irmã(o)' },
      { nome_colete: 'Lucas', grau: 'Sobrinho(a)' },
      { nome_colete: 'Fernanda', grau: 'Cunhada' }
    ]
  };

  const msg = gps.buildWhatsAppProtocolMessage(viagemComAcomp, 'https://gpissi.vercel.app/tracker?id=INS-TEST-ACOMP');

  // Não deve conter 'neto(a)(Neto(a))'
  assert.equal(msg.includes('neto(a)(Neto(a))'), false);
  assert.equal(msg.includes('neto(a) (Neto(a))'), false);
  // Deve conter apenas uma referência limpa: 'Pedro - Neto(a)'
  assert.ok(msg.includes('Pedro - Neto(a)'));
  assert.ok(msg.includes('Maria - Mãe'));
  assert.ok(msg.includes('Carlos - Pai'));
  assert.ok(msg.includes('Ana - Irmã(o)'));
  assert.ok(msg.includes('Lucas - Sobrinho(a)'));
  assert.ok(msg.includes('Fernanda - Cunhada'));
});

test('isPointInRouteCorridor tolera desvios na rota mantendo margem dinâmica de até 350 km', () => {
  const origemPires = { lat: -17.30138, lon: -48.27868 };
  const destinoCaldas = { lat: -17.74083, lon: -48.63815 };

  // Ponto no trajeto (~10km)
  const palmelo = { lat: -17.326, lng: -48.422 };
  assert.equal(gps.isPointInRouteCorridor(palmelo.lat, palmelo.lng, origemPires, destinoCaldas), true);

  // Desvio moderado na estrada (~87km - ex: contorno por Catalão)
  const catalao = { lat: -18.1602, lng: -47.9354 };
  assert.equal(gps.isPointInRouteCorridor(catalao.lat, catalao.lng, origemPires, destinoCaldas, 120), true);
});

test('searchDivisions lista mais de 1400 divisões oficiais e posiciona Pires do Rio em 1º para "pires do"', () => {
  const { searchDivisions } = require('../divisoes');

  const all = searchDivisions('', 0);
  assert.ok(all.length >= 1400, `Esperado >= 1400 divisões, encontrado: ${all.length}`);

  const resPiresDo = searchDivisions('pires do', 5);
  assert.ok(resPiresDo.length > 0, 'Deveria retornar ao menos 1 resultado para "pires do"');
  assert.equal(resPiresDo[0].divisao, 'Divisão Pires do Rio', 'Divisão Pires do Rio deve ser o primeiro resultado para "pires do"');
  assert.equal(resPiresDo[0].regional, 'REGIONAL GOIÁS I - GO');
  assert.equal(resPiresDo[0].comando, 'Comando Regional XLVIII');

  const resPires = searchDivisions('pires', 5);
  assert.equal(resPires[0].divisao, 'Divisão Pires do Rio', 'Divisão Pires do Rio deve ser o primeiro resultado para "pires"');
});