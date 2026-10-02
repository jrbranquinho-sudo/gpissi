const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

process.env.SESSION_SECRET = 'gpissi-test-secret-that-is-long-enough-for-hmac';
process.env.TURSO_DATABASE_URL = `file:${path.join(os.tmpdir(), `gpissi-auth-${crypto.randomUUID()}.db`)}`;

const originalFetch = global.fetch;
global.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname === 'nominatim.openstreetmap.org' && url.pathname.endsWith('/search')) {
    const query = (url.searchParams.get('q') || '').toLowerCase();
    const isPalmelo = query.includes('palmelo');
    return new Response(JSON.stringify([{
      lat: isPalmelo ? '-17.326' : '-17.300',
      lon: isPalmelo ? '-48.422' : '-48.280',
      display_name: isPalmelo ? 'Palmelo, Goiás, Brasil' : 'Pires do Rio, Goiás, Brasil'
    }]), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.hostname === 'nominatim.openstreetmap.org' && url.pathname.endsWith('/reverse')) {
    const isPalmelo = Number(url.searchParams.get('lat')) < -17.31;
    return new Response(JSON.stringify({
      address: {
        town: isPalmelo ? 'Palmelo' : 'Pires do Rio',
        'ISO3166-2-lvl4': 'BR-GO'
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.hostname === 'router.project-osrm.org') {
    return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });
  }
  return originalFetch(input, init);
};

const app = require('../server');
const server = app.listen(0);
const baseUrl = `http://127.0.0.1:${server.address().port}`;

async function postJson(url, body, headers = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  return { response, body: await response.json() };
}

async function putJson(url, body, cookie) {
  const response = await fetch(`${baseUrl}${url}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body)
  });
  return { response, body: await response.json() };
}

function codeFromChallenge(challenge) {
  const svg = Buffer.from(challenge.image.split(',')[1], 'base64').toString('utf8');
  return svg.match(/<text[^>]*>([A-Z]{6})<\/text>/)[1];
}

test('cadastro e login mostram desafio visual e renovam sequência incorreta', async () => {
  const email = `member-${crypto.randomUUID()}@example.test`;
  const firstChallenge = await postJson('/api/auth/challenge', { purpose: 'register' });
  assert.equal(firstChallenge.response.status, 200);
  assert.match(firstChallenge.body.image, /^data:image\/svg\+xml;base64,/);
  const codeFromFirstChallenge = codeFromChallenge(firstChallenge.body);
  const wrongCode = codeFromFirstChallenge === 'AAAAAA' ? 'BBBBBB' : 'AAAAAA';

  const registration = await postJson('/api/auth/register', {
    nome: 'Integrante Teste',
    nome_colete: 'Teste',
    telefone: '11999999999',
    funcao_grau: 'FULL - VIII',
    email,
    password: 'senha-segura-123',
    challenge_id: firstChallenge.body.id,
    challenge_code: wrongCode
  });

  assert.equal(registration.response.status, 401);
  assert.match(registration.body.error, /nova sequência/);
  assert.ok(registration.body.challenge.id);
  const replacementCode = codeFromChallenge(registration.body.challenge);
  assert.notEqual(replacementCode, wrongCode);
  assert.notEqual(replacementCode, codeFromFirstChallenge);

  const createdAccount = await postJson('/api/auth/register', {
    nome: 'Integrante Teste',
    nome_colete: 'Teste',
    telefone: '11999999999',
    funcao_grau: 'FULL - VIII',
    email,
    password: 'senha-segura-123',
    challenge_id: registration.body.challenge.id,
    challenge_code: replacementCode
  });
  assert.equal(createdAccount.response.status, 201);
  const cookie = createdAccount.response.headers.get('set-cookie').split(';')[0];

  let login = await postJson('/api/auth/login', { email, password: 'senha-segura-123' });
  assert.equal(login.response.status, 200);
  assert.equal(login.body.requires_challenge, true);
  const firstLoginChallenge = login.body.challenge;
  const refreshedLoginChallenge = await postJson('/api/auth/challenge', {
    purpose: 'login',
    email,
    password: 'senha-segura-123'
  });
  assert.equal(refreshedLoginChallenge.response.status, 200);
  const loginCode = codeFromChallenge(refreshedLoginChallenge.body);
  assert.notEqual(loginCode, codeFromChallenge(firstLoginChallenge));
  const wrongLoginCode = loginCode === 'AAAAAA' ? 'BBBBBB' : 'AAAAAA';

  login = await postJson('/api/auth/login', {
    email,
    password: 'senha-segura-123',
    challenge_id: refreshedLoginChallenge.body.id,
    challenge_code: wrongLoginCode
  });
  assert.equal(login.response.status, 401);
  assert.ok(login.body.challenge.id);
  const renewedLoginCode = codeFromChallenge(login.body.challenge);
  assert.notEqual(renewedLoginCode, wrongLoginCode);
  assert.notEqual(renewedLoginCode, loginCode);

  login = await postJson('/api/auth/login', {
    email,
    password: 'senha-segura-123',
    challenge_id: login.body.challenge.id,
    challenge_code: renewedLoginCode
  });
  assert.equal(login.response.status, 200);
  assert.ok(login.response.headers.get('set-cookie'));

  const session = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie } });
  assert.equal(session.status, 200);
  const sessionData = await session.json();
  assert.equal(sessionData.user.profile.telefone, '(11) 9 9999-9999');
  assert.equal(sessionData.user.profile.funcao_grau, 'FULL - VIII');

  const invalidCompanions = await putJson('/api/account/companions', {
    companions: Array.from({ length: 5 }, (_, index) => ({ nome: `Contato ${index}`, telefone: '11999999999' }))
  }, cookie);
  assert.equal(invalidCompanions.response.status, 400);

  const savedCompanions = await putJson('/api/account/companions', {
    companions: [
      { nome: 'Acompanhante Um', telefone: '(64) 9 8765-4321', relacao: 'Esposa' },
      { nome: 'Acompanhante Dois', telefone: '11987654321', relacao: 'Filho(a)' }
    ]
  }, cookie);
  assert.equal(savedCompanions.response.status, 200);
  assert.equal(savedCompanions.body.companions.length, 2);
  assert.equal(savedCompanions.body.companions.find(item => item.nome === 'Acompanhante Um').telefone, '(64) 9 8765-4321');
  assert.equal(savedCompanions.body.companions.find(item => item.nome === 'Acompanhante Um').relacao, 'Esposa');

  const reloadedCompanions = await fetch(`${baseUrl}/api/account/companions`, { headers: { cookie } });
  assert.equal(reloadedCompanions.status, 200);
  const companions = await reloadedCompanions.json();
  assert.ok(companions.some(item => item.nome === 'Acompanhante Dois' && item.relacao === 'Filho(a)'));

  const selectableContacts = await fetch(`${baseUrl}/api/members`, { headers: { cookie } });
  assert.equal(selectableContacts.status, 200);
  const contacts = await selectableContacts.json();
  const personalContact = contacts.find(contact => contact.kind === 'contact' && contact.telefone === '(64) 9 8765-4321');
  assert.deepEqual({ name: personalContact.nome, phone: personalContact.telefone, relacao: personalContact.relacao }, {
    name: 'Acompanhante',
    phone: '(64) 9 8765-4321',
    relacao: 'Esposa'
  });
  assert.equal(personalContact.nome_colete, undefined);

  const invalidEmergencyContacts = await putJson('/api/account/emergency-contacts', {
    contacts: Array.from({ length: 4 }, (_, index) => ({ nome: `Emergência ${index}`, telefone: '11999999999' }))
  }, cookie);
  assert.equal(invalidEmergencyContacts.response.status, 400);

  const savedEmergencyContacts = await putJson('/api/account/emergency-contacts', {
    contacts: [
      { nome: 'Contato de Emergência', telefone: '(64) 9 1111-2222', relacao: 'Esposa' },
      { nome: 'Segundo Contato', telefone: '11922223333', relacao: 'Amigo(a)' }
    ]
  }, cookie);
  assert.equal(savedEmergencyContacts.response.status, 200);
  assert.equal(savedEmergencyContacts.body.contacts[0].telefone, '(64) 9 1111-2222');
  assert.equal(savedEmergencyContacts.body.contacts[0].relacao, 'Esposa');

  const reloadedEmergencyContacts = await fetch(`${baseUrl}/api/account/emergency-contacts`, { headers: { cookie } });
  assert.equal(reloadedEmergencyContacts.status, 200);
  const emergencyContacts = await reloadedEmergencyContacts.json();
  assert.equal(emergencyContacts[1].nome, 'Segundo Contato');
  assert.equal(emergencyContacts[1].relacao, 'Amigo(a)');

  const saveVehicle = await putJson('/api/account/vehicles', {
    vehicle: { id: crypto.randomUUID(), tipo: 'MOTO', placa: 'ABC-1234', marca: 'Honda', modelo: 'CB 500', detalhes: '' }
  }, cookie);
  assert.equal(saveVehicle.response.status, 200);
  assert.equal(saveVehicle.body.vehicle.placa, 'ABC1234');

  const updateVehicle = await putJson('/api/account/vehicles', {
    vehicle: { id: crypto.randomUUID(), tipo: 'MOTO', placa: 'ABC-1234', marca: 'Honda', modelo: 'CB 500X', detalhes: '' }
  }, cookie);
  assert.equal(updateVehicle.response.status, 200);
  assert.equal(updateVehicle.body.vehicles.length, 1);
  assert.equal(updateVehicle.body.vehicles[0].modelo, 'CB 500X');

  const savedVehicles = await fetch(`${baseUrl}/api/account/vehicles`, { headers: { cookie } });
  assert.equal(savedVehicles.status, 200);
  assert.equal((await savedVehicles.json())[0].placa, 'ABC1234');

  const vehicleDraftId = crypto.randomUUID();
  const savedDraft = await putJson('/api/account/vehicles', {
    vehicle: { id: vehicleDraftId, tipo: 'CARRO', placa: '', marca: 'Honda', modelo: 'Civic', detalhes: '' }
  }, cookie);
  assert.equal(savedDraft.response.status, 200);
  assert.equal(savedDraft.body.vehicle.placa, null);
  const completedDraft = await putJson('/api/account/vehicles', {
    vehicle: { id: vehicleDraftId, tipo: 'CARRO', placa: 'GHI-9012', marca: 'Honda', modelo: 'Civic', detalhes: '' }
  }, cookie);
  assert.equal(completedDraft.response.status, 200);
  assert.equal(completedDraft.body.vehicle.id, vehicleDraftId);
  assert.equal(completedDraft.body.vehicle.placa, 'GHI9012');

  const trip = await postJson('/api/viagens', {
    origem: 'Pires do Rio - GO',
    destino: 'Palmelo - GO',
    data_saida: '2026-09-28',
    hora_saida: '08:00',
    data_retorno: '2026-09-28',
    nome_colete: 'Teste',
    telefone: '11999999999',
    transporte_tipo: 'MOTO',
    transporte_placa: 'DEF-5678',
    transporte_marca: 'Yamaha',
    transporte_modelo: 'MT-07',
    vai_acompanhado: 'Não',
    emergency_contact_id: emergencyContacts[0].id
  }, { cookie });
  assert.equal(trip.response.status, 201, JSON.stringify(trip.body));
  assert.equal(trip.body.viagem.emergencia_contato, 'Contato de Emergência - esposa');
  assert.equal(trip.body.viagem.emergencia_telefone, '(64) 9 1111-2222');
  const tripVehiclesResponse = await fetch(`${baseUrl}/api/account/vehicles`, { headers: { cookie } });
  const tripVehicles = await tripVehiclesResponse.json();
  assert.ok(tripVehicles.some(vehicle => vehicle.placa === 'DEF5678' && vehicle.modelo === 'MT-07'));

  const anonymousList = await fetch(`${baseUrl}/api/viagens`);
  assert.equal(anonymousList.status, 401);
  const ownerTripsResponse = await fetch(`${baseUrl}/api/viagens`, { headers: { cookie } });
  assert.equal(ownerTripsResponse.status, 200);
  const ownerTrips = await ownerTripsResponse.json();
  assert.ok(ownerTrips.some(item => item.id === trip.body.id && item.share_token === trip.body.share_token));

  const deniedWithoutShare = await fetch(`${baseUrl}/api/viagens/${trip.body.id}`);
  assert.equal(deniedWithoutShare.status, 404);
  const deniedWithWrongShare = await fetch(`${baseUrl}/api/viagens/${trip.body.id}?share=not-the-share-token`);
  assert.equal(deniedWithWrongShare.status, 404);
  const deniedWithAdminToken = await fetch(`${baseUrl}/api/viagens/${trip.body.id}?token=${encodeURIComponent(trip.body.admin_token)}`);
  assert.equal(deniedWithAdminToken.status, 404);
  const deniedWithPin = await fetch(`${baseUrl}/api/viagens/${trip.body.id}?pin=${encodeURIComponent(trip.body.creator_pin)}`);
  assert.equal(deniedWithPin.status, 404);
  const allowedWithShare = await fetch(`${baseUrl}/api/viagens/${trip.body.id}?share=${encodeURIComponent(trip.body.share_token)}`);
  assert.equal(allowedWithShare.status, 200);
  assert.equal((await allowedWithShare.json()).origem, 'Pires do Rio - GO');

  const firstGps = await postJson(`/api/viagens/${trip.body.id}/checkin`, {
    lat: -17.326,
    lng: -48.422,
    timestamp: '2026-09-28T12:00:00.000Z'
  }, { cookie });
  assert.equal(firstGps.response.status, 200);
  const trackedTripResponse = await fetch(`${baseUrl}/api/viagens/${trip.body.id}`, { headers: { cookie } });
  const trackedTrip = await trackedTripResponse.json();
  const passage = trackedTrip.checkins.at(-1);
  assert.equal(passage.tipo, 'city_passage');
  assert.equal(passage.cidade, 'Palmelo - GO');
  assert.equal(passage.timestamp, '2026-09-28T12:00:00.000Z');

  const repeatGps = await postJson(`/api/viagens/${trip.body.id}/checkin`, {
    lat: -17.327,
    lng: -48.423,
    timestamp: '2026-09-28T12:05:00.000Z'
  }, { cookie });
  assert.equal(repeatGps.response.status, 200);
  const repeatedTripResponse = await fetch(`${baseUrl}/api/viagens/${trip.body.id}`, { headers: { cookie } });
  const repeatedTrip = await repeatedTripResponse.json();
  assert.equal(repeatedTrip.checkins.at(-1).tipo, 'gps');

  // Teste de Edição da Viagem antes de encerrar
  const editTrip = await putJson(`/api/viagens/${trip.body.id}`, {
    transporte_modelo: 'MT-09',
    observacoes_notas: 'Viagem editada pelo autor'
  }, cookie);
  assert.equal(editTrip.response.status, 200);
  assert.equal(editTrip.body.viagem.transporte_modelo, 'MT-09');
  assert.equal(editTrip.body.viagem.observacoes_notas, 'Viagem editada pelo autor');

  // Teste de Exclusão da Viagem pelo autor
  const deleteTripRes = await fetch(`${baseUrl}/api/viagens/${trip.body.id}`, {
    method: 'DELETE',
    headers: { cookie }
  });
  assert.equal(deleteTripRes.status, 200);
  const deletedFetch = await fetch(`${baseUrl}/api/viagens/${trip.body.id}?share=${encodeURIComponent(trip.body.share_token)}`);
  assert.equal(deletedFetch.status, 404);
});

test.after(() => new Promise(resolve => {
  global.fetch = originalFetch;
  server.close(resolve);
}));