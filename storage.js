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
          created_at TEXT NOT NULL,
          UNIQUE (user_id, id)
        )`,
        `CREATE INDEX IF NOT EXISTS companions_owner ON companions(user_id, created_at)`,
        `CREATE TABLE IF NOT EXISTS emergency_contacts (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          phone TEXT NOT NULL,
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
        'CREATE INDEX IF NOT EXISTS trips_owner_created ON trips(owner_user_id, created_at DESC)'
      ], 'write');

      const columns = await client.execute('PRAGMA table_info(users)');
      const knownColumns = new Set(columns.rows.map(row => row.name));
      if (!knownColumns.has('email_otp_hash')) await client.execute('ALTER TABLE users ADD COLUMN email_otp_hash TEXT');
      if (!knownColumns.has('email_otp_expires_at')) await client.execute('ALTER TABLE users ADD COLUMN email_otp_expires_at TEXT');
      if (!knownColumns.has('email_verified')) await client.execute('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');

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
  const result = await client.execute({
    sql: `SELECT id, name AS nome, phone AS telefone FROM ${table} WHERE user_id = ? ORDER BY created_at, name`,
    args: [userId]
  });
  return result.rows;
}

async function replaceOwnedContacts(table, userId, contacts) {
  if (!['companions', 'emergency_contacts'].includes(table)) throw new Error('Unsupported contact table');
  const now = new Date().toISOString();
  const statements = [
    { sql: `DELETE FROM ${table} WHERE user_id = ?`, args: [userId] },
    ...contacts.map(contact => ({
      sql: `INSERT INTO ${table} (id, user_id, name, phone, created_at) VALUES (?, ?, ?, ?, ?)`,
      args: [contact.id, userId, contact.nome, contact.telefone, now]
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
    const profile = JSON.parse(row.profile);
    return {
      id: row.id,
      kind: 'member',
      nome_colete: profile.nome_colete,
      grau: profile.funcao_grau || [profile.grau, profile.funcao].filter(Boolean).join(' - '),
      funcao: profile.funcao || ''
    };
  });
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

module.exports = {
  initializeStorage,
  findUserByEmail,
  findUserById,
  createUser,
  saveChallenge,
  findChallenge,
  consumeChallenge,
  listMembers,
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
  deleteExpiredTrips
};