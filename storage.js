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
        'CREATE INDEX IF NOT EXISTS trips_owner_created ON trips(owner_user_id, created_at DESC)'
      ], 'write');

      const columns = await client.execute('PRAGMA table_info(users)');
      const knownColumns = new Set(columns.rows.map(row => row.name));
      if (!knownColumns.has('email_otp_hash')) await client.execute('ALTER TABLE users ADD COLUMN email_otp_hash TEXT');
      if (!knownColumns.has('email_otp_expires_at')) await client.execute('ALTER TABLE users ADD COLUMN email_otp_expires_at TEXT');
      if (!knownColumns.has('email_verified')) await client.execute('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');

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

async function updateUserProfile(userId, profile) {
  await client.execute({
    sql: 'UPDATE users SET profile = ? WHERE id = ?',
    args: [JSON.stringify(profile), userId]
  });
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

async function updateUserProfile(userId, profile) {
  await client.execute({
    sql: 'UPDATE users SET profile = ? WHERE id = ?',
    args: [JSON.stringify(profile), userId]
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

module.exports = {
  initializeStorage,
  findUserByEmail,
  findUserById,
  createUser,
  updateUserProfile,
  saveChallenge,
  findChallenge,
  consumeChallenge,
  listMembers,
  updateUserProfile,
  listTrips,
  listUserTrips,
  findTrip,
  saveTrip,
  deleteExpiredTrips
};