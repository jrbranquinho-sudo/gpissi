const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');

const localDir = path.join(__dirname, 'data');
if (!process.env.TURSO_DATABASE_URL && !fs.existsSync(localDir)) {
  fs.mkdirSync(localDir, { recursive: true });
}

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || `file:${path.join(localDir, 'gpissi.db')}`,
  authToken: process.env.TURSO_AUTH_TOKEN
});

let initialized;

function initializeStorage() {
  if (!initialized) {
    initialized = (async () => {
      await client.batch([
        `CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          profile TEXT NOT NULL,
          email_otp_hash TEXT,
          email_otp_expires_at TEXT,
          email_verified INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS trips (
          id TEXT PRIMARY KEY,
          owner_user_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          payload TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS auth_challenges (
          id TEXT PRIMARY KEY,
          purpose TEXT NOT NULL,
          user_id TEXT,
          code_hash TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS companions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          phone TEXT NOT NULL,
          relationship TEXT DEFAULT '',
          created_at TEXT NOT NULL,
          UNIQUE (user_id, id)
        )`,
        `CREATE INDEX IF NOT EXISTS companions_owner ON companions(user_id, created_at)`,
        `CREATE TABLE IF NOT EXISTS emergency_contacts (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          phone TEXT NOT NULL,
          relationship TEXT DEFAULT '',
          created_at TEXT NOT NULL,
          UNIQUE (user_id, id)
        )`,
        `CREATE INDEX IF NOT EXISTS emergency_contacts_owner ON emergency_contacts(user_id, created_at)`,
        `CREATE TABLE IF NOT EXISTS vehicles (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          vehicle_type TEXT NOT NULL,
          plate TEXT,
          brand TEXT NOT NULL DEFAULT '',
          model TEXT NOT NULL DEFAULT '',
          details TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (user_id, plate)
        )`,
        `CREATE INDEX IF NOT EXISTS vehicles_owner ON vehicles(user_id, updated_at DESC)`,
        'CREATE INDEX IF NOT EXISTS trips_owner_created ON trips(owner_user_id, created_at DESC)',
        `CREATE TABLE IF NOT EXISTS tracking_sessions (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL DEFAULT 'insanos-mc',
          viagem_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          vehicle_id TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'IDLE',
          started_at TEXT,
          paused_at TEXT,
          resumed_at TEXT,
          ended_at TEXT,
          last_point_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracking_sessions_viagem ON tracking_sessions(viagem_id, status)`,
        `CREATE INDEX IF NOT EXISTS idx_tracking_sessions_user ON tracking_sessions(user_id, created_at DESC)`,
        `CREATE TABLE IF NOT EXISTS tracking_points (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL DEFAULT 'insanos-mc',
          session_id TEXT NOT NULL,
          viagem_id TEXT NOT NULL,
          point_uid TEXT NOT NULL UNIQUE,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          accuracy_m REAL,
          speed_mps REAL,
          speed_kmh REAL,
          heading REAL,
          altitude REAL,
          recorded_at TEXT NOT NULL,
          received_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracking_points_viagem ON tracking_points(viagem_id, recorded_at ASC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracking_points_session ON tracking_points(session_id, recorded_at ASC)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_tracking_points_uid ON tracking_points(point_uid)`
      ], 'write');

      const columns = await client.execute('PRAGMA table_info(users)');
      const knownColumns = new Set(columns.rows.map(row => row.name));
      if (!knownColumns.has('email_otp_hash')) await client.execute('ALTER TABLE users ADD COLUMN email_otp_hash TEXT');
      if (!knownColumns.has('email_otp_expires_at')) await client.execute('ALTER TABLE users ADD COLUMN email_otp_expires_at TEXT');
      if (!knownColumns.has('email_verified')) await client.execute('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');

      const companionCols = await client.execute('PRAGMA table_info(companions)');
      const companionColNames = new Set(companionCols.rows.map(row => row.name));
      if (!companionColNames.has('relationship')) {
        await client.execute("ALTER TABLE companions ADD COLUMN relationship TEXT DEFAULT ''");
      }

      const emergencyCols = await client.execute('PRAGMA table_info(emergency_contacts)');
      const emergencyColNames = new Set(emergencyCols.rows.map(row => row.name));
      if (!emergencyColNames.has('relationship')) {
        await client.execute("ALTER TABLE emergency_contacts ADD COLUMN relationship TEXT DEFAULT ''");
      }

      await migrateProfileContacts();

      const count = await client.execute('SELECT COUNT(*) AS total FROM trips');
      if (Number(count.rows[0].total) === 0) {
        const legacyFile = path.join(__dirname, 'data', 'viagens.json');
        if (fs.existsSync(legacyFile)) {
          const legacyTrips = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
          for (const trip of legacyTrips) {
            await client.execute({
              sql: 'INSERT OR IGNORE INTO trips (id, owner_user_id, created_at, payload) VALUES (?, ?, ?, ?)',
              args: [trip.id, trip.owner_user_id || '', trip.created_at || new Date().toISOString(), JSON.stringify(trip)]
            });
          }
        }
      }
    })();
  }
  return initialized;
}

async function findUserByEmail(email) {
  const result = await client.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email] });
  return result.rows[0] || null;
}

async function findUserById(id) {
  const result = await client.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [id] });
  return result.rows[0] || null;
}

async function createUser(user) {
  await client.execute({
    sql: `INSERT INTO users (id, email, password_hash, profile, email_otp_hash, email_otp_expires_at, email_verified, created_at)
      VALUES (?, ?, ?, ?, NULL, NULL, 1, ?)`,
    args: [user.id, user.email, user.password_hash, JSON.stringify(user.profile), user.created_at]
  });
}

async function migrateProfileContacts() {
  const result = await client.execute('SELECT id, profile FROM users');
  for (const row of result.rows) {
    let profile;
    try {
      profile = JSON.parse(row.profile);
    } catch (_) {
      continue;
    }
    const statements = [];
    for (const contact of profile.acompanhantes || []) {
      if (!contact || !contact.id || !contact.nome || !contact.telefone) continue;
      statements.push({
        sql: 'INSERT OR IGNORE INTO companions (id, user_id, name, phone, created_at) VALUES (?, ?, ?, ?, ?)',
        args: [contact.id, row.id, contact.nome, contact.telefone, new Date().toISOString()]
      });
    }
    for (const contact of profile.contatos_emergencia || []) {
      if (!contact || !contact.id || !contact.nome || !contact.telefone) continue;
      statements.push({
        sql: 'INSERT OR IGNORE INTO emergency_contacts (id, user_id, name, phone, created_at) VALUES (?, ?, ?, ?, ?)',
        args: [contact.id, row.id, contact.nome, contact.telefone, new Date().toISOString()]
      });
    }
    if (statements.length) await client.batch(statements, 'write');
    if (profile.acompanhantes || profile.contatos_emergencia) {
      delete profile.acompanhantes;
      delete profile.contatos_emergencia;
      await client.execute({ sql: 'UPDATE users SET profile = ? WHERE id = ?', args: [JSON.stringify(profile), row.id] });
    }
  }
}

async function listOwnedContacts(table, userId) {
  if (!['companions', 'emergency_contacts'].includes(table)) throw new Error('Unsupported contact table');
  if (table === 'companions') {
    const result = await client.execute({
      sql: `SELECT id, name AS nome, phone AS telefone, COALESCE(relationship, 'Nenhum') AS relacao FROM companions WHERE user_id = ? ORDER BY created_at, name`,
      args: [userId]
    });
    return result.rows;
  }
  const result = await client.execute({
    sql: `SELECT id, name AS nome, phone AS telefone, COALESCE(relationship, 'Nenhum') AS relacao FROM emergency_contacts WHERE user_id = ? ORDER BY created_at, name`,
    args: [userId]
  });
  return result.rows;
}

async function replaceOwnedContacts(table, userId, contacts) {
  if (!['companions', 'emergency_contacts'].includes(table)) throw new Error('Unsupported contact table');
  const now = new Date().toISOString();
  if (table === 'companions') {
    const statements = [
      { sql: `DELETE FROM companions WHERE user_id = ?`, args: [userId] },
      ...contacts.map(contact => ({
        sql: `INSERT INTO companions (id, user_id, name, phone, relationship, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [contact.id, userId, contact.nome, contact.telefone, contact.relacao || 'Nenhum', now]
      }))
    ];
    await client.batch(statements, 'write');
    return contacts;
  }
  const statements = [
    { sql: `DELETE FROM emergency_contacts WHERE user_id = ?`, args: [userId] },
    ...contacts.map(contact => ({
      sql: `INSERT INTO emergency_contacts (id, user_id, name, phone, relationship, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [contact.id, userId, contact.nome, contact.telefone, contact.relacao || 'Nenhum', now]
    }))
  ];
  await client.batch(statements, 'write');
  return contacts;
}

async function listUserVehicles(userId) {
  const result = await client.execute({
    sql: `SELECT id, vehicle_type AS tipo, plate AS placa, brand AS marca, model AS modelo,
      details AS detalhes, created_at, updated_at FROM vehicles WHERE user_id = ? ORDER BY updated_at DESC`,
    args: [userId]
  });
  return result.rows;
}

async function saveUserVehicle(userId, vehicle) {
  const now = new Date().toISOString();
  const plate = vehicle.placa || null;
  const updateVehicle = async id => client.execute({
    sql: `UPDATE vehicles SET vehicle_type = ?, plate = ?, brand = ?, model = ?, details = ?, updated_at = ?
      WHERE user_id = ? AND id = ?`,
    args: [vehicle.tipo, plate, vehicle.marca, vehicle.modelo, vehicle.detalhes, now, userId, id]
  });

  let targetId = vehicle.id;
  if (plate) {
    const samePlate = await client.execute({
      sql: 'SELECT id FROM vehicles WHERE user_id = ? AND plate = ?',
      args: [userId, plate]
    });
    if (samePlate.rows[0] && samePlate.rows[0].id !== vehicle.id) {
      const draft = await client.execute({
        sql: 'SELECT id FROM vehicles WHERE user_id = ? AND id = ?',
        args: [userId, vehicle.id]
      });
      if (draft.rows[0]) {
        await client.execute({ sql: 'DELETE FROM vehicles WHERE user_id = ? AND id = ?', args: [userId, vehicle.id] });
      }
      targetId = samePlate.rows[0].id;
    }
  }

  const existing = await client.execute({
    sql: 'SELECT id FROM vehicles WHERE user_id = ? AND id = ?',
    args: [userId, targetId]
  });
  if (existing.rows[0]) {
    await updateVehicle(targetId);
  } else {
    await client.execute({
      sql: `INSERT INTO vehicles (id, user_id, vehicle_type, plate, brand, model, details, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [targetId, userId, vehicle.tipo, plate, vehicle.marca, vehicle.modelo, vehicle.detalhes, now, now]
    });
  }

  const result = await client.execute({
    sql: `SELECT id, vehicle_type AS tipo, plate AS placa, brand AS marca, model AS modelo,
      details AS detalhes, created_at, updated_at FROM vehicles WHERE user_id = ? AND id = ?`,
    args: [userId, targetId]
  });
  return result.rows[0];
}

async function deleteUserVehicle(userId, vehicleId) {
  await client.execute({ sql: 'DELETE FROM vehicles WHERE user_id = ? AND id = ?', args: [userId, vehicleId] });
}

async function saveChallenge(challenge) {
  await client.execute({
    sql: 'INSERT INTO auth_challenges (id, purpose, user_id, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: [challenge.id, challenge.purpose, challenge.user_id, challenge.code_hash, challenge.expires_at, challenge.created_at]
  });
}

async function findChallenge(id) {
  const result = await client.execute({ sql: 'SELECT * FROM auth_challenges WHERE id = ?', args: [id] });
  return result.rows[0] || null;
}

async function consumeChallenge(id) {
  await client.execute({
    sql: 'DELETE FROM auth_challenges WHERE id = ?',
    args: [id]
  });
}

async function listMembers() {
  const result = await client.execute('SELECT id, profile FROM users WHERE email_verified = 1 ORDER BY email');
  return result.rows.map(row => {
    let profile = {};
    try {
      profile = JSON.parse(row.profile);
    } catch (_) {}
    return {
      id: row.id,
      kind: 'member',
      nome_colete: profile.nome_colete,
      grau: profile.funcao_grau || [profile.grau, profile.funcao].filter(Boolean).join(' - '),
      funcao: profile.funcao || '',
      divisao: profile.divisao || 'Sem Divisão',
      regional: profile.regional || '',
      comando: profile.comando || ''
    };
  });
}

async function updateUserProfile(userId, profileUpdates) {
  const user = await findUserById(userId);
  if (!user) return null;
  let profile = {};
  try {
    profile = JSON.parse(user.profile);
  } catch (_) {}
  const updatedProfile = { ...profile, ...profileUpdates };
  await client.execute({
    sql: 'UPDATE users SET profile = ? WHERE id = ?',
    args: [JSON.stringify(updatedProfile), userId]
  });
  return updatedProfile;
}

async function listTrips() {
  const result = await client.execute('SELECT payload FROM trips ORDER BY created_at DESC');
  return result.rows.map(row => JSON.parse(row.payload));
}

async function listUserTrips(userId) {
  const result = await client.execute({
    sql: 'SELECT payload FROM trips WHERE owner_user_id = ? ORDER BY created_at DESC',
    args: [userId]
  });
  return result.rows.map(row => JSON.parse(row.payload));
}

async function findTrip(id) {
  const result = await client.execute({ sql: 'SELECT payload FROM trips WHERE id = ?', args: [id] });
  return result.rows[0] ? JSON.parse(result.rows[0].payload) : null;
}

async function saveTrip(trip) {
  await client.execute({
    sql: `INSERT INTO trips (id, owner_user_id, created_at, payload) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET owner_user_id = excluded.owner_user_id, created_at = excluded.created_at, payload = excluded.payload`,
    args: [trip.id, trip.owner_user_id || '', trip.created_at, JSON.stringify(trip)]
  });
}

async function deleteExpiredTrips(activeCutoff, closedCutoff) {
  await client.execute({
    sql: `DELETE FROM trips WHERE
      (json_extract(payload, '$.status') = 'CONCLUÍDA' AND json_extract(payload, '$.closed_at') < ?)
      OR (json_extract(payload, '$.status') != 'CONCLUÍDA' AND created_at < ?)`,
    args: [closedCutoff, activeCutoff]
  });
}

async function deleteTrip(id) {
  await client.execute({ sql: 'DELETE FROM trips WHERE id = ?', args: [id] });
}

// ============================================================================
// TRACKING SESSIONS & POINTS (Turso/libSQL)
// ============================================================================

async function createTrackingSession(session) {
  const now = new Date().toISOString();
  const sessionId = session.id || crypto.randomUUID();
  await client.execute({
    sql: `INSERT INTO tracking_sessions (id, tenant_id, viagem_id, user_id, vehicle_id, status, started_at, paused_at, resumed_at, ended_at, last_point_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      sessionId,
      session.tenant_id || 'insanos-mc',
      session.viagem_id,
      session.user_id,
      session.vehicle_id || '',
      session.status || 'TRACKING',
      session.started_at || now,
      session.paused_at || null,
      session.resumed_at || null,
      session.ended_at || null,
      session.last_point_at || null,
      session.created_at || now,
      session.updated_at || now
    ]
  });
  return findTrackingSessionById(sessionId);
}

async function findTrackingSessionById(id) {
  const result = await client.execute({
    sql: `SELECT * FROM tracking_sessions WHERE id = ?`,
    args: [id]
  });
  return result.rows[0] || null;
}

async function findActiveTrackingSessionByTrip(viagemId) {
  const result = await client.execute({
    sql: `SELECT * FROM tracking_sessions WHERE viagem_id = ? AND status IN ('STARTING', 'TRACKING', 'PAUSED', 'SYNC_PENDING') ORDER BY created_at DESC LIMIT 1`,
    args: [viagemId]
  });
  return result.rows[0] || null;
}

async function updateTrackingSession(id, updates) {
  const now = new Date().toISOString();
  const fields = [];
  const args = [];

  for (const [key, value] of Object.entries(updates)) {
    if (['status', 'paused_at', 'resumed_at', 'ended_at', 'last_point_at', 'vehicle_id'].includes(key)) {
      fields.push(`${key} = ?`);
      args.push(value);
    }
  }

  fields.push(`updated_at = ?`);
  args.push(now);
  args.push(id);

  await client.execute({
    sql: `UPDATE tracking_sessions SET ${fields.join(', ')} WHERE id = ?`,
    args
  });
  return findTrackingSessionById(id);
}

async function insertTrackingPointsBatch(points = []) {
  if (!Array.isArray(points) || points.length === 0) return { inserted: 0, duplicates: 0, total: 0 };
  const now = new Date().toISOString();
  let inserted = 0;
  let duplicates = 0;

  const statements = [];
  for (const pt of points) {
    if (!pt || !pt.point_uid || typeof pt.latitude !== 'number' || typeof pt.longitude !== 'number') continue;
    statements.push({
      sql: `INSERT OR IGNORE INTO tracking_points
        (id, tenant_id, session_id, viagem_id, point_uid, latitude, longitude, accuracy_m, speed_mps, speed_kmh, heading, altitude, recorded_at, received_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        pt.id || crypto.randomUUID(),
        pt.tenant_id || 'insanos-mc',
        pt.session_id || '',
        pt.viagem_id,
        pt.point_uid,
        pt.latitude,
        pt.longitude,
        pt.accuracy_m != null ? pt.accuracy_m : null,
        pt.speed_mps != null ? pt.speed_mps : null,
        pt.speed_kmh != null ? pt.speed_kmh : null,
        pt.heading != null ? pt.heading : null,
        pt.altitude != null ? pt.altitude : null,
        pt.recorded_at || now,
        pt.received_at || now,
        now
      ]
    });
  }

  if (statements.length > 0) {
    const results = await client.batch(statements, 'write');
    for (const res of results) {
      if (res.rowsAffected && res.rowsAffected > 0) {
        inserted++;
      } else {
        duplicates++;
      }
    }
  }

  return { inserted, duplicates, total: points.length };
}

async function listTrackingPointsByTrip(viagemId, limit = 1000, since = null) {
  let sql = `SELECT * FROM tracking_points WHERE viagem_id = ?`;
  const args = [viagemId];
  if (since) {
    sql += ` AND recorded_at > ?`;
    args.push(since);
  }
  sql += ` ORDER BY recorded_at ASC LIMIT ?`;
  args.push(Number(limit) || 1000);

  const result = await client.execute({ sql, args });
  return result.rows.map(row => ({
    ...row,
    speed: row.speed_kmh != null ? row.speed_kmh : (row.speed_mps != null ? row.speed_mps * 3.6 : null),
    accuracy: row.accuracy_m
  }));
}

async function getTrackingSessionStatus(viagemId) {
  let session = await findActiveTrackingSessionByTrip(viagemId);
  if (!session) {
    const lastSession = await client.execute({
      sql: `SELECT * FROM tracking_sessions WHERE viagem_id = ? ORDER BY created_at DESC LIMIT 1`,
      args: [viagemId]
    });
    session = lastSession.rows[0] ? { ...lastSession.rows[0], is_active: false } : null;
  }
  if (!session) return null;

  const countResult = await client.execute({
    sql: `SELECT COUNT(*) AS total FROM tracking_points WHERE viagem_id = ?`,
    args: [viagemId]
  });
  const lastPointResult = await client.execute({
    sql: `SELECT * FROM tracking_points WHERE viagem_id = ? ORDER BY recorded_at DESC LIMIT 1`,
    args: [viagemId]
  });

  const isActive = ['STARTING', 'TRACKING', 'SYNC_PENDING'].includes(session.status);
  const totalPoints = Number(countResult.rows[0]?.total || 0);

  return {
    ...session,
    session_id: session.id,
    is_active: isActive,
    status: session.status,
    points_count: totalPoints,
    total_points: totalPoints,
    last_point: lastPointResult.rows[0] || null
  };
}

async function deleteTrackingDataByTrip(viagemId) {
  await client.batch([
    { sql: `DELETE FROM tracking_points WHERE viagem_id = ?`, args: [viagemId] },
    { sql: `DELETE FROM tracking_sessions WHERE viagem_id = ?`, args: [viagemId] }
  ], 'write');
}

module.exports = {
  initializeStorage,
  findUserByEmail,
  findUserById,
  createUser,
  saveChallenge,
  findChallenge,
  consumeChallenge,
  listMembers,
  updateUserProfile,
  listOwnedContacts,
  replaceOwnedContacts,
  listUserVehicles,
  saveUserVehicle,
  deleteUserVehicle,
  listTrips,
  listUserTrips,
  findTrip,
  saveTrip,
  deleteTrip,
  deleteExpiredTrips,
  createTrackingSession,
  findTrackingSessionById,
  findActiveTrackingSessionByTrip,
  updateTrackingSession,
  insertTrackingPointsBatch,
  listTrackingPointsByTrip,
  getTrackingSessionStatus,
  deleteTrackingDataByTrip
};