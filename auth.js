const crypto = require('crypto');

const CHALLENGE_CHARACTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function generateChallengeCode(excludedCode = '') {
  let code;
  do {
    code = Array.from({ length: 6 }, () => CHALLENGE_CHARACTERS[crypto.randomInt(CHALLENGE_CHARACTERS.length)]).join('');
  } while (code === String(excludedCode));
  return code;
}

function hashChallengeCode(challengeId, code, secret) {
  return crypto.createHmac('sha256', secret).update(`${challengeId}:${code}`).digest('hex');
}

function verifyChallengeCode(challengeId, code, expectedHash, secret) {
  if (!/^[A-Z]{6}$/.test(String(code || '').toUpperCase()) || !expectedHash) return false;
  const expected = Buffer.from(expectedHash, 'hex');
  const supplied = Buffer.from(hashChallengeCode(challengeId, String(code).toUpperCase(), secret), 'hex');
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, 64, (error, derived) => {
      if (error) return reject(error);
      resolve(`${salt.toString('hex')}:${derived.toString('hex')}`);
    });
  });
}

function verifyPassword(password, stored) {
  return new Promise((resolve, reject) => {
    const [saltHex, hashHex] = String(stored).split(':');
    if (!saltHex || !hashHex) return resolve(false);
    crypto.scrypt(password, Buffer.from(saltHex, 'hex'), 64, (error, derived) => {
      if (error) return reject(error);
      const expected = Buffer.from(hashHex, 'hex');
      resolve(expected.length === derived.length && crypto.timingSafeEqual(expected, derived));
    });
  });
}

module.exports = {
  generateChallengeCode,
  hashChallengeCode,
  verifyChallengeCode,
  hashPassword,
  verifyPassword
};