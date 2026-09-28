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