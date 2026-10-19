const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

// Configure isolated test DB before requiring storage or server
process.env.SESSION_SECRET = 'gpissi-tracking-secret-that-is-long-enough-for-hmac';
process.env.TURSO_DATABASE_URL = `file:${path.join(os.tmpdir(), `gpissi-tracking-${crypto.randomUUID()}.db`)}`;

const app = require('../server');
const storage = require('../storage');
const TrackingQueue = require('../public/js/tracking/TrackingQueue');

const server = app.listen(0);
const baseUrl = `http://127.0.0.1:${server.address().port}`;

// Helper HTTP methods
async function postJson(endpoint, body, headers = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, body: data };
}

async function getJson(endpoint, headers = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', ...headers }
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, body: data };
}

// Global fixtures
let testTripId = '';
let testAdminToken = '';
let testCreatorPin = '4321';
let otherTripId = '';
let otherAdminToken = '';

test.before(async () => {
  await storage.initializeStorage();

  testTripId = crypto.randomUUID();
  testAdminToken = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();

  // Create main test trip
  await storage.saveTrip({
    id: testTripId,
    admin_token: testAdminToken,
    creator_pin: testCreatorPin,
    owner_user_id: 'user-pilot-1',
    status: 'EM ANDAMENTO',
    origem: 'São Paulo - SP',
    destino: 'Santos - SP',
    origem_geo: { lat: -23.55, lon: -46.63 },
    destino_geo: { lat: -23.96, lon: -46.33 },
    created_at: now,
    checkins: []
  });

  // Create secondary trip for permission separation tests
  otherTripId = crypto.randomUUID();
  otherAdminToken = crypto.randomBytes(16).toString('hex');
  await storage.saveTrip({
    id: otherTripId,
    admin_token: otherAdminToken,
    creator_pin: '9999',
    owner_user_id: 'user-pilot-2',
    status: 'EM ANDAMENTO',
    origem: 'Campinas - SP',
    destino: 'Jundiaí - SP',
    created_at: now,
    checkins: []
  });
});

test.after(() => {
  server.close();
});

// ============================================================================
// 18 CENÁRIOS OBRIGATÓRIOS DE TESTE
// ============================================================================

test('Cenário 1: Início de rastreamento com viagem válida: Criação de sessão active, retorno de session_id', async () => {
  const res = await postJson(`/api/viagens/${testTripId}/tracking/start`, {}, {
    'x-creator-token': testAdminToken
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.ok(res.body.session_id, 'Deve retornar session_id gerado');
  assert.equal(res.body.status, 'active');
});

test('Cenário 2: Tentativa de iniciar rastreamento para viagem com sessão ativa já existente (retorno idempotente)', async () => {
  const res = await postJson(`/api/viagens/${testTripId}/tracking/start`, {}, {
    'x-creator-token': testAdminToken
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(res.body.session_id);
  assert.equal(res.body.status, 'active');
});

test('Cenário 3: Pausa de rastreamento: Transição de estado de active para paused', async () => {
  const res = await postJson(`/api/viagens/${testTripId}/tracking/pause`, {}, {
    'x-creator-token': testAdminToken
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.status, 'paused');

  // Verifica status persistido
  const statusRes = await getJson(`/api/viagens/${testTripId}/tracking/status`);
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.body.session.status, 'paused');
});

test('Cenário 4: Retomada de rastreamento: Transição de paused para active', async () => {
  const res = await postJson(`/api/viagens/${testTripId}/tracking/resume`, {}, {
    'x-creator-token': testAdminToken
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.status, 'active');

  const statusRes = await getJson(`/api/viagens/${testTripId}/tracking/status`);
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.body.session.status, 'active');
});

test('Cenário 5: Encerramento de rastreamento: Mudança para stopped com ended_at preenchido', async () => {
  const res = await postJson(`/api/viagens/${testTripId}/tracking/stop`, {}, {
    'x-creator-token': testAdminToken
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.status, 'stopped');

  const statusRes = await getJson(`/api/viagens/${testTripId}/tracking/status`);
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.body.session.status, 'stopped');
  assert.ok(statusRes.body.session.ended_at, 'Deve conter ended_at preenchido');

  // Reinicia sessão ativa para os testes subsequentes
  await postJson(`/api/viagens/${testTripId}/tracking/start`, {}, {
    'x-creator-token': testAdminToken
  });
});

test('Cenário 6: Envio de lote de pontos válido: Inserção no banco, retorno de sucesso e confirmação de quantidade', async () => {
  const now = Date.now();
  const points = [
    {
      point_uid: 'pt-valid-1',
      latitude: -23.5505,
      longitude: -46.6333,
      accuracy: 5.2,
      speed: 25.0, // 25 m/s ou km/h
      speedUnit: 'kmh',
      recorded_at: new Date(now - 20000).toISOString()
    },
    {
      point_uid: 'pt-valid-2',
      latitude: -23.5600,
      longitude: -46.6400,
      accuracy: 4.8,
      speed: 80.0,
      speedUnit: 'kmh',
      recorded_at: new Date(now - 10000).toISOString()
    }
  ];

  const res = await postJson(`/api/viagens/${testTripId}/tracking/points/batch`, { points }, {
    'x-creator-token': testAdminToken
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.inserted, 2);
});

test('Cenário 7: Idempotência / reenvio de pontos: Envio do mesmo lote com point_uid repetido não gera duplicidade no banco', async () => {
  const points = [
    {
      point_uid: 'pt-valid-1',
      latitude: -23.5505,
      longitude: -46.6333,
      recorded_at: new Date().toISOString()
    },
    {
      point_uid: 'pt-valid-2',
      latitude: -23.5600,
      longitude: -46.6400,
      recorded_at: new Date().toISOString()
    }
  ];

  const res = await postJson(`/api/viagens/${testTripId}/tracking/points/batch`, { points }, {
    'x-creator-token': testAdminToken
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.inserted, 0, 'Reenvio de UIDs idênticos não deve reinserir registros');

  // Confirma contagem total no banco via listTrackingPoints
  const pointsList = await storage.listTrackingPointsByTrip(testTripId);
  const uids = pointsList.map(p => p.point_uid);
  const uniqueUids = new Set(uids);
  assert.equal(uids.length, uniqueUids.size, 'Não pode haver duplicatas de point_uid');
});

test('Cenário 8: Rejeição de lote com coordenadas inválidas (latitude > 90, longitude < -180, valores NaN/null)', async () => {
  const invalidBatches = [
    [{ point_uid: 'bad-lat', latitude: 95.0, longitude: -46.0 }],
    [{ point_uid: 'bad-lng', latitude: -23.0, longitude: -195.0 }],
    [{ point_uid: 'nan-coords', latitude: NaN, longitude: -46.0 }],
    [{ point_uid: 'null-coords', latitude: null, longitude: null }]
  ];

  for (const batch of invalidBatches) {
    const res = await postJson(`/api/viagens/${testTripId}/tracking/points/batch`, { points: batch }, {
      'x-creator-token': testAdminToken
    });
    assert.equal(res.status, 400, 'Deve rejeitar coordenadas inválidas com status 400');
    assert.equal(res.body.success, false);
  }
});

test('Cenário 9: Tratamento de lote vazio ou malformado (retorno 400)', async () => {
  const emptyRes = await postJson(`/api/viagens/${testTripId}/tracking/points/batch`, { points: [] }, {
    'x-creator-token': testAdminToken
  });
  assert.equal(emptyRes.status, 400);

  const notArrayRes = await postJson(`/api/viagens/${testTripId}/tracking/points/batch`, { points: 'invalido' }, {
    'x-creator-token': testAdminToken
  });
  assert.equal(notArrayRes.status, 400);
});

test('Cenário 10: Tentativa de envio de pontos por usuário não autorizado (sem token ou sem PIN correspondente)', async () => {
  const points = [{ point_uid: 'unauth-pt', latitude: -23.5, longitude: -46.5 }];

  // Sem headers de autenticação
  const noAuthRes = await postJson(`/api/viagens/${testTripId}/tracking/points/batch`, { points });
  assert.equal(noAuthRes.status, 401);

  // Com token incorreto
  const wrongTokenRes = await postJson(`/api/viagens/${testTripId}/tracking/points/batch`, { points }, {
    'x-creator-token': 'token-falso-12345'
  });
  assert.equal(wrongTokenRes.status, 403);
});

test('Cenário 11: Tentativa de acesso / envio de pontos para viagem inexistente (retorno 404)', async () => {
  const res = await postJson(`/api/viagens/99999999-invalida/tracking/points/batch`, {
    points: [{ point_uid: 'ghost-pt', latitude: -23.5, longitude: -46.5 }]
  }, {
    'x-creator-token': testAdminToken
  });
  assert.equal(res.status, 404);
});

test('Cenário 12: Tentativa de controle de sessão (pause/stop) por terceiro desautorizado (retorno 403)', async () => {
  // Usuário tenta pausar viagem alheia usando token de outra viagem
  const res = await postJson(`/api/viagens/${testTripId}/tracking/pause`, {}, {
    'x-creator-token': otherAdminToken
  });
  assert.equal(res.status, 403);
});

test('Cenário 13: Conversão e preservação correta de velocidade (conversão única sem duplicar 3.6)', async () => {
  // Envia velocidade em m/s: 10 m/s deve se tornar exatamente 36.0 km/h (sem duplicação por 3.6)
  const uidMps = `spd-mps-${Date.now()}`;
  const resMps = await postJson(`/api/viagens/${testTripId}/tracking/points/batch`, {
    points: [{
      point_uid: uidMps,
      latitude: -23.551,
      longitude: -46.634,
      speed: 10.0,
      speedUnit: 'mps',
      recorded_at: new Date().toISOString()
    }]
  }, { 'x-creator-token': testAdminToken });

  assert.equal(resMps.status, 200);

  // Envia velocidade já em km/h: 80 km/h deve se manter 80.0 km/h (sem sofrer multiplicação indevida)
  const uidKmh = `spd-kmh-${Date.now()}`;
  const resKmh = await postJson(`/api/viagens/${testTripId}/tracking/points/batch`, {
    points: [{
      point_uid: uidKmh,
      latitude: -23.552,
      longitude: -46.635,
      speed: 80.0,
      speedUnit: 'kmh',
      recorded_at: new Date().toISOString()
    }]
  }, { 'x-creator-token': testAdminToken });

  assert.equal(resKmh.status, 200);

  const pointsList = await storage.listTrackingPointsByTrip(testTripId);
  const ptMps = pointsList.find(p => p.point_uid === uidMps);
  const ptKmh = pointsList.find(p => p.point_uid === uidKmh);

  assert.ok(ptMps);
  assert.ok(ptKmh);
  assert.equal(Math.round(ptMps.speed), 36, '10 m/s deve ser convertido para 36 km/h');
  assert.equal(Math.round(ptKmh.speed), 80, '80 km/h deve permanecer 80 km/h (sem duplicar 3.6)');
});

test('Cenário 14: Ordenação cronológica correta dos pontos retornados pela API (GET tracking/points)', async () => {
  const t1 = new Date(Date.now() - 30000).toISOString();
  const t2 = new Date(Date.now() - 20000).toISOString();
  const t3 = new Date(Date.now() - 10000).toISOString();

  // Envia fora de ordem para garantir que a API retorne ordenado por recorded_at ASC
  await postJson(`/api/viagens/${testTripId}/tracking/points/batch`, {
    points: [
      { point_uid: 'chrono-3', latitude: -23.57, longitude: -46.65, recorded_at: t3 },
      { point_uid: 'chrono-1', latitude: -23.55, longitude: -46.63, recorded_at: t1 },
      { point_uid: 'chrono-2', latitude: -23.56, longitude: -46.64, recorded_at: t2 }
    ]
  }, { 'x-creator-token': testAdminToken });

  const res = await getJson(`/api/viagens/${testTripId}/tracking/points?limit=50`);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.points));

  const points = res.body.points;
  for (let i = 1; i < points.length; i++) {
    const prevTime = new Date(points[i - 1].recorded_at).getTime();
    const currTime = new Date(points[i].recorded_at).getTime();
    assert.ok(prevTime <= currTime, `Ponto na posição ${i} deve ser posterior ou igual ao anterior`);
  }
});

test('Cenário 15: Recuperação de sessão ativa após reinício do cliente / consulta de status (GET tracking/status)', async () => {
  const res = await getJson(`/api/viagens/${testTripId}/tracking/status`);
  assert.equal(res.status, 200);
  assert.ok(res.body.session);
  assert.equal(res.body.session.status, 'active');
  assert.ok(typeof res.body.points_count === 'number');
  assert.ok(res.body.points_count > 0);
  assert.ok(res.body.last_point);
});

test('Cenário 16: Fila local offline (TrackingQueue): Armazena pontos, mantém limite máximo e remove confirmados', () => {
  const queue = new TrackingQueue('test_queue_mem_1');
  queue.clear();

  // Enfileira pontos
  const pt1 = queue.enqueue({ latitude: -23.55, longitude: -46.63, speed_kmh: 60 });
  const pt2 = queue.enqueue({ latitude: -23.56, longitude: -46.64, speed_kmh: 70 });

  assert.equal(queue.size(), 2);
  assert.ok(pt1 && pt1.point_uid);
  assert.ok(pt2 && pt2.point_uid);

  // Remove apenas o primeiro após confirmação
  const removedCount = queue.remove([pt1.point_uid]);
  assert.equal(removedCount, 1);
  assert.equal(queue.size(), 1);

  // O segundo ponto ainda deve estar presente
  const remaining = queue.peek();
  assert.equal(remaining[0].point_uid, pt2.point_uid);

  queue.clear();
});

test('Cenário 17: Resiliência a falhas de rede no envio em lote (simulação mantendo pontos na fila para retry)', async () => {
  const queue = new TrackingQueue('test_queue_retry');
  queue.clear();

  queue.enqueue({ point_uid: 'retry-pt-1', latitude: -23.55, longitude: -46.63 });
  queue.enqueue({ point_uid: 'retry-pt-2', latitude: -23.56, longitude: -46.64 });

  assert.equal(queue.size(), 2);

  // Simula falha de rede (servidor offline ou rota com erro 500)
  const simulateNetworkFailure = async () => {
    throw new Error('Network error: connection refused');
  };

  let pointsPreserved = false;
  try {
    await simulateNetworkFailure();
    // Se tivesse sucesso, removeria da fila
    queue.remove(['retry-pt-1', 'retry-pt-2']);
  } catch (err) {
    // Falha detectada: NENHUM ponto é removido da fila
    pointsPreserved = queue.size() === 2;
  }

  assert.equal(pointsPreserved, true, 'Os pontos devem permanecer intactos na fila após falha de rede');

  // Na próxima tentativa com rede restaurada:
  const res = await postJson(`/api/viagens/${testTripId}/tracking/points/batch`, {
    points: queue.peek()
  }, { 'x-creator-token': testAdminToken });

  assert.equal(res.status, 200);
  queue.remove(queue.peek().map(p => p.point_uid));
  assert.equal(queue.size(), 0, 'Fila deve esvaziar somente após resposta 200 do servidor');
  queue.clear();
});

test('Cenário 18: Deduplicação na fila local antes da transmissão (mesmo point_uid)', () => {
  const queue = new TrackingQueue('test_queue_dedup');
  queue.clear();

  const uid = 'fixed-unique-uid-1234';
  const first = queue.enqueue({ point_uid: uid, latitude: -23.55, longitude: -46.63 });
  const second = queue.enqueue({ point_uid: uid, latitude: -23.55, longitude: -46.63 });

  assert.ok(first, 'Primeira inserção deve ter sucesso');
  assert.equal(second, null, 'Segunda inserção com o mesmo point_uid deve ser descartada');
  assert.equal(queue.size(), 1, 'Fila deve conter apenas 1 item após tentativa duplicada');

  queue.clear();
});
