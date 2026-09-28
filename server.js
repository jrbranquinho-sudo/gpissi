const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const storage = require('./storage');
const auth = require('./auth');
const { estimateDurationSeconds } = require('./route-estimate');
const gpsUtils = require('./public/js/gps-utils');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || '';

// Trust proxy for rate limiters behind Vercel / Cloudflare / Nginx
app.set('trust proxy', 1);

// Disable X-Powered-By
app.disable('x-powered-by');

const CIDADES_FILE = path.join(__dirname, 'data', 'cidades_ibge.json');
const VEICULOS_FILE = path.join(__dirname, 'data', 'veiculos_dados.json');

// 1. HELMET SECURITY HEADERS WITH STRICT CSP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      workerSrc: ["'self'", "blob:"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://unpkg.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
      connectSrc: [
        "'self'",
        "https://tiles.openfreemap.org",
        "https://nominatim.openstreetmap.org",
        "https://router.project-osrm.org",
        "https://servicodados.ibge.gov.br"
      ],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
      upgradeInsecureRequests: []
    }
  },
  crossOriginEmbedderPolicy: false
}));

// 2. CORS RESTRICTIONS
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-creator-token', 'x-creator-pin']
}));

// 3. BODY SIZE LIMIT (Prevents JSON bombs & memory exhaustion DOS)
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

app.use('/api', async (req, res, next) => {
  try {
    await storage.initializeStorage();
    next();
  } catch (error) {
    console.error('Falha ao conectar ao banco de dados:', error.message);
    res.status(503).json({ error: 'Banco de dados indisponível. Confira a configuração do Turso.' });
  }
});

// 4. RATE LIMITERS FOR DEFENSE AGAINST DDOS & BRUTE-FORCE
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições originadas deste IP. Por favor, aguarde alguns minutos.' }
});
app.use('/api', globalLimiter);

const createTripLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Limite de criação de protocolos atingido para este IP. Aguarde 15 minutos.' }
});

const pinAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de PIN incorretas. Por segurança contra força bruta, este IP foi temporariamente bloqueado por 15 minutos.' }
});

const checkinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Limite de envio de check-ins atingido temporariamente. Aguarde.' }
});

const accountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de acesso. Aguarde alguns minutos.' }
});

// XSS SANITIZATION HELPER
function sanitizeString(str, maxLen = 200) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/javascript:/gi, '')
    .trim()
    .substring(0, maxLen);
}

function isValidTripId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{4,35}$/.test(id);
}

function securelyMatches(value, expected) {
  if (typeof value !== 'string' || typeof expected !== 'string') return false;
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return valueBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(valueBuffer, expectedBuffer);
}

app.use(express.static(path.join(__dirname, 'public')));

// Specific route for logo2.jog in case browser or user requests it explicitly
app.get('/images/logo2.jog', (req, res) => {
  const file = path.join(__dirname, 'public', 'images', 'logo2.jpg');
  if (fs.existsSync(file)) {
    res.setHeader('Content-Type', 'image/jpeg');
    return res.sendFile(file);
  }
  res.status(404).send('Logo não encontrado');
});

// Load IBGE cities cache
let CIDADES_IBGE = [];
try {
  if (fs.existsSync(CIDADES_FILE)) {
    CIDADES_IBGE = JSON.parse(fs.readFileSync(CIDADES_FILE, 'utf8'));
    console.log(`✓ Cidades do IBGE carregadas: ${CIDADES_IBGE.length}`);
  }
} catch (e) {
  console.warn('Erro ao carregar cidades do IBGE:', e.message);
}

// Load Vehicles cache
let VEICULOS_DADOS = { MOTO: { marcas: [], modelosPorMarca: {} }, CARRO: { marcas: [], modelosPorMarca: {} } };
try {
  if (fs.existsSync(VEICULOS_FILE)) {
    VEICULOS_DADOS = JSON.parse(fs.readFileSync(VEICULOS_FILE, 'utf8'));
    console.log(`✓ Dados de veículos carregados.`);
  }
} catch (e) {
  console.warn('Erro ao carregar veículos:', e.message);
}

// PIN VALIDATION HELPER: Rejeita sequenciais crescentes/decrescentes e repetidos
function isSequentialOrTrivialPin(pinStr) {
  if (!pinStr || typeof pinStr !== 'string') return true;
  const clean = pinStr.trim();
  if (clean.length < 4 || clean.length > 6 || !/^\d+$/.test(clean)) return true;

  // Todos iguais (ex: 1111, 2222, 0000)
  if (/^(\d)\1+$/.test(clean)) return true;

  // Sequencial crescente (ex: 1234, 2345, 6789, 0123)
  // Sequencial decrescente (ex: 4321, 5432, 9876, 3210)
  let isAsc = true;
  let isDesc = true;
  for (let i = 0; i < clean.length - 1; i++) {
    const c1 = parseInt(clean[i], 10);
    const c2 = parseInt(clean[i + 1], 10);
    if (c2 !== (c1 + 1)) isAsc = false;
    if (c2 !== (c1 - 1)) isDesc = false;
  }
  if (isAsc || isDesc) return true;

  return false;
}

// Gerador de PIN seguro não sequencial
function generateSecurePin() {
  let pin = '';
  do {
    pin = String(crypto.randomInt(1000, 10000));
  } while (isSequentialOrTrivialPin(pin));
  return pin;
}

// REGRAS DE RETENÇÃO E PURGE AUTOMÁTICO:
// - Ativas: até 72 horas
// - Encerradas: MANTIDAS POR EXATAMENTE 2 HORAS APÓS O ENCERRAMENTO
const MAX_ACTIVE_LIFETIME_MS = 72 * 60 * 60 * 1000; // 72 horas
const MAX_CLOSED_LIFETIME_MS = 2 * 60 * 60 * 1000;  // 2 horas

// Periodic retention cleanup for persistent trips
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  storage.deleteExpiredTrips(
    new Date(now - MAX_ACTIVE_LIFETIME_MS).toISOString(),
    new Date(now - MAX_CLOSED_LIFETIME_MS).toISOString()
  ).catch(error => console.warn('Limpeza de viagens falhou:', error.message));
}, 10 * 60 * 1000);
cleanupTimer.unref();

// Coordinates database for geocoding
const BRAZIL_LOCATIONS = {
  'sao paulo': [-23.5505, -46.6333],
  'rio de janeiro': [-22.9068, -43.1729],
  'belo horizonte': [-19.9167, -43.9345],
  'curitiba': [-25.4290, -49.2671],
  'porto alegre': [-30.0346, -51.2177],
  'florianopolis': [-27.5954, -48.5480],
  'brasilia': [-15.7975, -47.8919],
  'salvador': [-12.9777, -38.5016],
  'recife': [-8.0476, -34.8770],
  'fortaleza': [-3.7319, -38.5267],
  'goiania': [-16.6869, -49.2648],
  'campinas': [-22.9099, -47.0626],
  'santos': [-23.9608, -46.3336],
  'ribeirao preto': [-21.1767, -47.8208],
  'sorocaba': [-23.5015, -47.4526],
  'sao jose dos campos': [-23.2237, -45.9009],
  'marilia': [-22.2139, -49.9458],
  'bauru': [-22.3145, -49.0587],
  'londrina': [-23.3045, -51.1696],
  'maringa': [-23.4210, -51.9331],
  'foz do iguacu': [-25.5163, -54.5854],
  'joinville': [-26.3045, -48.8487],
  'blumenau': [-26.9194, -49.0661],
  'caxias do sul': [-29.1678, -51.1794],
  'vitoria': [-20.3155, -40.3128],
  'juiz de fora': [-21.7642, -43.3503],
  'uberlandia': [-18.9186, -48.2772],
  'cuiaba': [-15.6014, -56.0979],
  'campo grande': [-20.4697, -54.6201],
  'palmas': [-10.1844, -48.3336],
  'natal': [-5.7945, -35.2110],
  'joao pessoa': [-7.1195, -34.8450],
  'maceio': [-9.6498, -35.7089],
  'aracaju': [-10.9472, -37.0731],
  'sao luis': [-2.5307, -44.3068],
  'teresina': [-5.0892, -42.8016],
  'belem': [-1.4558, -48.4902],
  'manaus': [-3.1190, -60.0217]
};

async function geocodeLocation(query) {
  if (!query || typeof query !== 'string') return null;
  const clean = query.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();

  for (const [key, coords] of Object.entries(BRAZIL_LOCATIONS)) {
    if (clean.includes(key)) {
      return { lat: coords[0], lon: coords[1], display_name: query };
    }
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', Brasil')}&limit=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'GPISSI-InsanosMC/2.0 (seguranca@insanosmc.com)'
      }
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) {
        return {
          lat: parseFloat(data[0].lat),
          lon: parseFloat(data[0].lon),
          display_name: data[0].display_name
        };
      }
    }
  } catch (e) {
    console.warn('Geocoding fallback:', query, e.message);
  }

  return null;
}

function hasLegacyFallbackCoordinates(query, location) {
  const cleanQuery = String(query || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (cleanQuery.includes('sao paulo')) return false;
  if (!location) return Boolean(cleanQuery);
  return location.lat === -23.5505 && location.lon === -46.6333;
}

async function repairLegacyTripGeocodes(trip) {
  const repairOrigin = hasLegacyFallbackCoordinates(trip.origem, trip.origem_geo);
  const repairDestination = hasLegacyFallbackCoordinates(trip.destino, trip.destino_geo);
  if (!repairOrigin && !repairDestination) return trip;

  const [origin, destination] = await Promise.all([
    repairOrigin ? geocodeLocation(trip.origem) : trip.origem_geo,
    repairDestination ? geocodeLocation(trip.destino) : trip.destino_geo
  ]);
  trip.origem_geo = origin;
  trip.destino_geo = destination;
  await storage.saveTrip(trip);
  return trip;
}

async function reverseGeocodeLocation(lat, lon) {
  try {
    const params = new URLSearchParams({
      format: 'jsonv2',
      lat: String(lat),
      lon: String(lon),
      zoom: '10',
      addressdetails: '1'
    });
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      headers: { 'User-Agent': 'GPISSI-InsanosMC/2.0 (seguranca@insanosmc.com)' },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return '';
    const result = await response.json();
    return gpsUtils.extractMunicipality(result.address);
  } catch (error) {
    console.warn('Reverse geocoding indisponível:', error.message);
    return '';
  }
}

function createSessionToken(userId) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readSessionToken(req) {
  const cookies = (req.headers.cookie || '').split(';').map(item => item.trim());
  const entry = cookies.find(item => item.startsWith('gpissi_session='));
  return entry ? decodeURIComponent(entry.slice('gpissi_session='.length)) : '';
}

function verifySessionToken(token) {
  if (!SESSION_SECRET || !token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest();
  let supplied;
  try {
    supplied = Buffer.from(signature, 'base64url');
  } catch (_) {
    return null;
  }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(expected, supplied)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return claims.exp > Date.now() ? claims.sub : null;
  } catch (_) {
    return null;
  }
}

function setSessionCookie(res, userId) {
  const secure = process.env.VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', `gpissi_session=${encodeURIComponent(createSessionToken(userId))}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`);
}

async function requireAccount(req, res, next) {
  try {
    const userId = verifySessionToken(readSessionToken(req));
    if (!userId) return res.status(401).json({ error: 'Entre na sua conta para continuar.' });
    const user = await storage.findUserById(userId);
    if (!user) {
      return res.status(401).json({ error: 'Conta não encontrada.' });
    }
    req.user = { id: user.id, email: user.email, profile: JSON.parse(user.profile) };
    next();
  } catch (error) {
    console.error('Erro ao validar conta:', error.message);
    res.status(500).json({ error: 'Não foi possível validar sua conta.' });
  }
}

async function loadOptionalAccount(req, res, next) {
  try {
    const userId = verifySessionToken(readSessionToken(req));
    if (userId) {
      const user = await storage.findUserById(userId);
      if (user) {
        req.user = { id: user.id, email: user.email, profile: JSON.parse(user.profile) };
      }
    }
    next();
  } catch (error) {
    console.error('Erro ao carregar sessão opcional:', error.message);
    next(error);
  }
}

function requireSessionSecret(res) {
  if (SESSION_SECRET) return true;
  res.status(503).json({ error: 'Configure SESSION_SECRET antes de habilitar contas.' });
  return false;
}

async function issueVisualChallenge(purpose, userId = null, excludedCode = '') {
  const id = crypto.randomUUID();
  const code = auth.generateChallengeCode(excludedCode);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await storage.saveChallenge({
    id,
    purpose,
    user_id: userId,
    code_hash: auth.hashChallengeCode(id, code, SESSION_SECRET),
    expires_at: expiresAt,
    created_at: new Date().toISOString()
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="380" height="66" viewBox="0 0 380 66"><rect width="380" height="66" rx="8" fill="#070809" stroke="#ff7700" stroke-width="2" stroke-dasharray="7 5"/><path d="M24 47L345 16M45 14L330 55" stroke="#343840" stroke-width="2"/><text x="190" y="44" text-anchor="middle" fill="#ff8800" font-family="monospace" font-size="29" font-weight="700" letter-spacing="9">${code}</text></svg>`;
  return { id, image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` };
}

async function verifyVisualChallenge(challengeId, purpose, userId, candidate) {
  const challenge = await storage.findChallenge(challengeId);
  await storage.consumeChallenge(challengeId);
  if (!challenge || challenge.purpose !== purpose || (challenge.user_id && challenge.user_id !== userId)) return false;
  if (new Date(challenge.expires_at).getTime() <= Date.now()) return false;
  return auth.verifyChallengeCode(challenge.id, candidate, challenge.code_hash, SESSION_SECRET);
}

app.post('/api/auth/challenge', accountLimiter, async (req, res) => {
  if (!requireSessionSecret(res)) return;
  try {
    const purpose = req.body.purpose === 'login' ? 'login' : 'register';
    let userId = null;
    if (purpose === 'login') {
      const email = sanitizeString(req.body.email, 254).toLowerCase();
      const user = await storage.findUserByEmail(email);
      if (!user || !(await auth.verifyPassword(String(req.body.password || ''), user.password_hash))) {
        return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
      }
      userId = user.id;
    }
    const challenge = await issueVisualChallenge(purpose, userId);
    res.json({ success: true, ...challenge });
  } catch (error) {
    console.error('Erro ao gerar desafio:', error.message);
    res.status(500).json({ error: 'Não foi possível gerar a sequência de segurança.' });
  }
});

app.post('/api/auth/register', accountLimiter, async (req, res) => {
  if (!requireSessionSecret(res)) return;
  try {
    const email = sanitizeString(req.body.email, 254).toLowerCase();
    const password = String(req.body.password || '');
    const profile = {
      nome: sanitizeString(req.body.nome, 100),
      nome_colete: sanitizeString(req.body.nome_colete, 80),
      telefone: String(req.body.telefone || '').replace(/\D/g, '').slice(0, 11),
      funcao_grau: sanitizeString(req.body.funcao_grau, 100),
      acompanhantes: []
    };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || !profile.nome || !profile.nome_colete || profile.telefone.length !== 11 || !profile.funcao_grau) {
      return res.status(400).json({ error: 'Informe um e-mail válido, senha com ao menos 12 caracteres e todos os dados obrigatórios.' });
    }
    profile.telefone = `(${profile.telefone.slice(0, 2)}) ${profile.telefone[2]} ${profile.telefone.slice(3, 7)}-${profile.telefone.slice(7)}`;
    const existing = await storage.findUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'Este e-mail já possui cadastro. Entre na sua conta.' });

    const validChallenge = await verifyVisualChallenge(req.body.challenge_id, 'register', null, req.body.challenge_code);
    if (!validChallenge) {
      return res.status(401).json({
        error: 'Sequência incorreta ou expirada. Uma nova sequência foi gerada.',
        challenge: await issueVisualChallenge('register', null, req.body.challenge_code)
      });
    }

    const user = {
      id: crypto.randomUUID(),
      email,
      password_hash: await auth.hashPassword(password),
      profile,
      created_at: new Date().toISOString()
    };
    await storage.createUser(user);
    setSessionCookie(res, user.id);
    res.status(201).json({ success: true, profile });
  } catch (error) {
    console.error('Erro ao cadastrar conta:', error.message);
    res.status(500).json({ error: 'Não foi possível criar a conta.' });
  }
});

app.post('/api/auth/login', accountLimiter, async (req, res) => {
  if (!requireSessionSecret(res)) return;
  try {
    const email = sanitizeString(req.body.email, 254).toLowerCase();
    const user = await storage.findUserByEmail(email);
    if (!user || !(await auth.verifyPassword(String(req.body.password || ''), user.password_hash))) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
    }
    if (!req.body.challenge_id) {
      return res.json({ requires_challenge: true, challenge: await issueVisualChallenge('login', user.id) });
    }
    const validChallenge = await verifyVisualChallenge(req.body.challenge_id, 'login', user.id, req.body.challenge_code);
    if (!validChallenge) {
      return res.status(401).json({
        error: 'Sequência incorreta ou expirada. Uma nova sequência foi gerada.',
        requires_challenge: true,
        challenge: await issueVisualChallenge('login', user.id, req.body.challenge_code)
      });
    }
    setSessionCookie(res, user.id);
    res.json({ success: true, profile: JSON.parse(user.profile) });
  } catch (error) {
    console.error('Erro ao entrar:', error.message);
    res.status(500).json({ error: 'Não foi possível entrar na conta.' });
  }
});

app.get('/api/auth/me', requireAccount, (req, res) => {
  res.json({ user: { id: req.user.id, email: req.user.email, profile: req.user.profile } });
});

app.post('/api/auth/logout', (req, res) => {
  const secure = process.env.VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', `gpissi_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
  res.json({ success: true });
});

app.get('/api/members', requireAccount, async (req, res) => {
  const members = await storage.listMembers();
  const ownContacts = (req.user.profile.acompanhantes || []).map(contact => ({
    id: contact.id,
    kind: 'contact',
    nome: contact.nome.trim().split(/\s+/)[0],
    telefone: contact.telefone
  }));
  res.json([...members.filter(member => member.id !== req.user.id), ...ownContacts]);
});

app.get('/api/account/companions', requireAccount, (req, res) => {
  res.json(req.user.profile.acompanhantes || []);
});

app.get('/api/account/emergency-contacts', requireAccount, (req, res) => {
  res.json(req.user.profile.contatos_emergencia || []);
});

app.put('/api/account/companions', requireAccount, async (req, res) => {
  const submitted = req.body.companions;
  if (!Array.isArray(submitted) || submitted.length > 4) {
    return res.status(400).json({ error: 'Cadastre no máximo quatro acompanhantes.' });
  }

  const companions = [];
  for (const item of submitted) {
    if (!item || typeof item !== 'object') {
      return res.status(400).json({ error: 'Dados de acompanhante inválidos.' });
    }
    const nome = sanitizeString(item.nome, 100);
    const digits = String(item.telefone || '').replace(/\D/g, '').slice(0, 11);
    if (!nome && !digits) continue;
    if (!nome || digits.length !== 11) {
      return res.status(400).json({ error: 'Preencha o nome e um celular com DDD em cada acompanhante.' });
    }
    companions.push({
      id: typeof item.id === 'string' && /^[a-f0-9-]{36}$/i.test(item.id) ? item.id : crypto.randomUUID(),
      nome,
      telefone: `(${digits.slice(0, 2)}) ${digits[2]} ${digits.slice(3, 7)}-${digits.slice(7)}`
    });
  }

  const profile = { ...req.user.profile, acompanhantes: companions };
  await storage.updateUserProfile(req.user.id, profile);
  res.json({ success: true, companions });
});

app.put('/api/account/emergency-contacts', requireAccount, async (req, res) => {
  const submitted = req.body.contacts;
  if (!Array.isArray(submitted) || submitted.length > 3) {
    return res.status(400).json({ error: 'Cadastre no máximo três contatos de emergência.' });
  }

  const contacts = [];
  for (const item of submitted) {
    if (!item || typeof item !== 'object') {
      return res.status(400).json({ error: 'Dados de contato de emergência inválidos.' });
    }
    const nome = sanitizeString(item.nome, 100);
    const digits = String(item.telefone || '').replace(/\D/g, '').slice(0, 11);
    if (!nome && !digits) continue;
    if (!nome || digits.length !== 11) {
      return res.status(400).json({ error: 'Preencha nome e celular com DDD para cada contato de emergência.' });
    }
    contacts.push({
      id: typeof item.id === 'string' && /^[a-f0-9-]{36}$/i.test(item.id) ? item.id : crypto.randomUUID(),
      nome,
      telefone: `(${digits.slice(0, 2)}) ${digits[2]} ${digits.slice(3, 7)}-${digits.slice(7)}`
    });
  }

  const profile = { ...req.user.profile, contatos_emergencia: contacts };
  await storage.updateUserProfile(req.user.id, profile);
  res.json({ success: true, contacts });
});

app.get('/api/minhas-viagens', requireAccount, async (req, res) => {
  const trips = await storage.listUserTrips(req.user.id);
  for (const trip of trips) {
    if (!trip.share_token) {
      trip.share_token = crypto.randomBytes(32).toString('base64url');
      await storage.saveTrip(trip);
    }
  }
  res.json(trips);
});

// API: Search Brazilian Cities (IBGE)
app.get('/api/cidades', (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  if (!q || q.length < 2) {
    const top = CIDADES_IBGE.slice(0, 40);
    return res.json(top);
  }

  const matches = [];
  for (const item of CIDADES_IBGE) {
    const itemClean = item.label.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (itemClean.includes(q)) {
      matches.push(item);
      if (matches.length >= 35) break;
    }
  }
  res.json(matches);
});

// API: Vehicles (dados_extras)
app.get('/api/veiculos', (req, res) => {
  const tipo = (req.query.tipo || 'MOTO').toUpperCase();
  const dados = VEICULOS_DADOS[tipo] || VEICULOS_DADOS['MOTO'];
  res.json(dados);
});

// API: Generate secure non-sequential PIN
app.get('/api/gerar-pin', (req, res) => {
  res.json({ pin: generateSecurePin() });
});

// API: Calculate route and arrival time
app.post('/api/calcular-rota', async (req, res) => {
  try {
    const { origem, destino, data_saida, hora_saida, transporte_tipo } = req.body;
    if (!origem || !destino) {
      return res.status(400).json({ error: 'Origem e Destino são obrigatórios.' });
    }

    const [geoOrigem, geoDestino] = await Promise.all([
      geocodeLocation(origem),
      geocodeLocation(destino)
    ]);
    if (!geoOrigem || !geoDestino) {
      return res.status(422).json({ error: 'Não foi possível localizar uma das cidades no mapa. Confira cidade e estado e tente novamente.' });
    }

    let distanceKm = 0;
    let durationSeconds = 0;

    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${geoOrigem.lon},${geoOrigem.lat};${geoDestino.lon},${geoDestino.lat}?overview=false`;
      const osrmRes = await fetch(osrmUrl);
      if (osrmRes.ok) {
        const osrmData = await osrmRes.json();
        if (osrmData.routes && osrmData.routes.length > 0) {
          distanceKm = Math.round(osrmData.routes[0].distance / 1000);
        }
      }
    } catch (e) {
      console.warn('OSRM error:', e.message);
    }

    if (!distanceKm) {
      const R = 6371;
      const dLat = (geoDestino.lat - geoOrigem.lat) * Math.PI / 180;
      const dLon = (geoDestino.lon - geoOrigem.lon) * Math.PI / 180;
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(geoOrigem.lat * Math.PI / 180) * Math.cos(geoDestino.lat * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      distanceKm = Math.round(R * c * 1.25);
    }

    const estimate = estimateDurationSeconds(distanceKm, transporte_tipo);
    durationSeconds = estimate.durationSeconds;

    let previsaoHora = '';
    const saidaDate = data_saida || new Date().toISOString().split('T')[0];
    const saidaHora = hora_saida || '08:00';

    try {
      const [h, m] = saidaHora.split(':').map(Number);
      const dt = new Date(`${saidaDate}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`);
      if (!isNaN(dt.getTime())) {
        const arrivalMs = dt.getTime() + (durationSeconds * 1000);
        const arrivalDate = new Date(arrivalMs);
        const arrH = String(arrivalDate.getHours()).padStart(2, '0');
        const arrM = String(arrivalDate.getMinutes()).padStart(2, '0');
        previsaoHora = `${arrH}:${arrM}`;
      }
    } catch (e) {
      console.warn('Date calculation error:', e);
    }

    const durationH = Math.floor(durationSeconds / 3600);
    const durationM = Math.round((durationSeconds % 3600) / 60);

    res.json({
      success: true,
      origem_geo: geoOrigem,
      destino_geo: geoDestino,
      distance_km: distanceKm,
      duration_hours: durationH,
      duration_minutes: durationM,
      duration_text: `${durationH}h ${durationM}min`,
      average_speed_kmh: estimate.averageSpeedKmh,
      stop_minutes: estimate.stopMinutes,
      previsao_chegada_hora: previsaoHora
    });
  } catch (err) {
    console.error('Erro em calcular-rota:', err);
    res.status(500).json({ error: 'Erro ao calcular rota e previsão.' });
  }
});

// API: List trips - ORDENADO DO MAIS RECENTE PARA O MAIS ANTIGO
app.get('/api/viagens', requireAccount, async (req, res) => {
  const viagens = await storage.listUserTrips(req.user.id);
  const list = viagens.map(v => ({
    id: v.id,
    origem: v.origem,
    origem_geo: v.origem_geo,
    destino: v.destino,
    destino_geo: v.destino_geo,
    data_saida: v.data_saida,
    hora_saida: v.hora_saida,
    previsao_chegada: v.previsao_chegada,
    data_retorno: v.data_retorno,
    nome_colete: v.nome_colete,
    grau: v.grau,
    status: v.status,
    transporte_tipo: v.transporte_tipo,
    transporte_marca: v.transporte_marca,
    transporte_modelo: v.transporte_modelo,
    transporte_placa: v.transporte_placa,
    transporte_detalhe: v.transporte_detalhe,
    telefone: v.telefone,
    emergencia_contato: v.emergencia_contato,
    emergencia_telefone: v.emergencia_telefone,
    checkins: v.checkins || [],
    created_at: v.created_at,
    closed_at: v.closed_at,
    encerramento_motivo: v.encerramento_motivo || '',
    share_token: v.share_token
  })).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  res.json(list);
});

// API: Get single trip
app.get('/api/viagens/:id', loadOptionalAccount, async (req, res) => {
  const { id } = req.params;
  if (!isValidTripId(id)) {
    return res.status(400).json({ error: 'ID de protocolo inválido.' });
  }

  const shareToken = req.query.share;

  let viagem = await storage.findTrip(id);

  if (!viagem) {
    return res.status(404).json({ error: 'Protocolo de viagem não encontrado ou expirado.' });
  }

  viagem = await repairLegacyTripGeocodes(viagem);

  const isCreator = Boolean(req.user && viagem.owner_user_id === req.user.id);

  const shareValid = securelyMatches(shareToken, viagem.share_token);
  if (!isCreator && !shareValid) {
    return res.status(404).json({ error: 'Link de rastreamento inválido ou expirado.' });
  }

  const publicData = { ...viagem };
  if (!isCreator) {
    delete publicData.admin_token;
    delete publicData.creator_pin;
    delete publicData.owner_user_id;
  }
  publicData.is_creator = isCreator;

  res.json(publicData);
});

// API: Gerador de PIN seguro não sequencial
app.get('/api/gerar-pin', (req, res) => {
  res.json({ pin: generateSecurePin() });
});

// API: Register new trip (With createTripLimiter & XSS sanitization)
app.post('/api/viagens', createTripLimiter, requireAccount, async (req, res) => {
  try {
    const {
      origem,
      data_saida,
      hora_saida,
      destino,
      previsao_chegada,
      data_retorno,
      nome_colete,
      grau,
      telefone,
      transporte_tipo,
      transporte_marca,
      transporte_modelo,
      transporte_placa,
      transporte_detalhe,
      vai_acompanhado,
      quem_vai_junto,
      emergencia_contato,
      emergencia_telefone,
      observacoes_notas,
      observacoes_resumo,
      creator_pin
    } = req.body;

    if (!origem || !destino || !nome_colete || !telefone) {
      return res.status(400).json({ error: 'Campos obrigatórios faltando (Origem, Destino, Nome do Colete, Telefone).' });
    }

    // SANITIZAÇÃO DE ENTRADA CONTRA XSS / INJEÇÃO
    const cleanOrigem = sanitizeString(origem, 120);
    const cleanDestino = sanitizeString(destino, 120);
    const cleanNomeColete = req.user.profile.nome_colete;
    const cleanTelefone = req.user.profile.telefone;
    const cleanGrau = req.user.profile.funcao_grau || [req.user.profile.grau, req.user.profile.funcao].filter(Boolean).join(' - ') || 'Integrante';
    const cleanTransporteTipo = ['MOTO', 'CARRO', 'ÔNIBUS', 'OUTRO'].includes(transporte_tipo) ? transporte_tipo : 'MOTO';
    const cleanTransporteMarca = sanitizeString(transporte_marca, 60);
    const cleanTransporteModelo = sanitizeString(transporte_modelo, 60);
    const cleanTransportePlaca = sanitizeString(transporte_placa, 12).toUpperCase();
    const cleanVaiAcompanhado = vai_acompanhado === 'Sim' ? 'Sim' : 'Não';
    const companionIds = Array.isArray(req.body.companion_ids) ? [...new Set(req.body.companion_ids)].slice(0, 5) : [];
    if (companionIds.length > 4 || (vai_acompanhado === 'Sim' && companionIds.length === 0)) {
      return res.status(400).json({ error: 'Selecione de um a quatro acompanhantes cadastrados.' });
    }
    if (vai_acompanhado !== 'Sim' && companionIds.length > 0) {
      return res.status(400).json({ error: 'Remova os acompanhantes ou habilite a opção de viagem acompanhada.' });
    }
    const members = companionIds.length ? await storage.listMembers() : [];
    const ownContacts = req.user.profile.acompanhantes || [];
    const availableCompanions = [
      ...members.filter(member => member.id !== req.user.id),
      ...ownContacts.map(contact => ({
        id: contact.id,
        nome_colete: contact.nome,
        grau: 'Contato',
        funcao: 'Acompanhante',
        telefone: contact.telefone
      }))
    ];
    const companions = companionIds.map(memberId => availableCompanions.find(member => member.id === memberId)).filter(Boolean);
    if (companions.length !== companionIds.length || companions.some(member => member.id === req.user.id)) {
      return res.status(400).json({ error: 'Um ou mais acompanhantes não estão cadastrados.' });
    }
    const cleanQuemVaiJunto = companions.map(member => member.nome_colete).join(', ');
    const cleanEmergenciaContato = sanitizeString(emergencia_contato, 80);
    const cleanEmergenciaTelefone = sanitizeString(emergencia_telefone, 25);
    const cleanNotas = sanitizeString(observacoes_notas, 1000);
    const cleanResumo = sanitizeString(observacoes_resumo, 1000);

    // VALIDAR PIN: Não permitir sequenciais (1234, 2345, 4321...) nem triviais
    const pin = creator_pin ? String(creator_pin).trim() : generateSecurePin();
    if (isSequentialOrTrivialPin(pin)) {
      return res.status(400).json({
        error: 'PIN de segurança inválido! Não utilize sequências crescentes ou decrescentes (como 1234, 2345, 4321) nem números repetidos (1111). Escolha um PIN aleatório e seguro.'
      });
    }

    const [origemGeo, destinoGeo] = await Promise.all([
      geocodeLocation(cleanOrigem),
      geocodeLocation(cleanDestino)
    ]);
    if (!origemGeo || !destinoGeo) {
      return res.status(422).json({ error: 'Não foi possível localizar uma das cidades no mapa. Confira cidade e estado e tente novamente.' });
    }

    const emergencyContactId = sanitizeString(req.body.emergency_contact_id, 50);
    const emergencyContact = (req.user.profile.contatos_emergencia || []).find(contact => contact.id === emergencyContactId);
    if (!emergencyContact) {
      return res.status(400).json({ error: 'Selecione um contato de emergência cadastrado na sua conta.' });
    }

    const id = 'INS-' + Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.floor(1000 + Math.random() * 9000);
    const admin_token = crypto.randomUUID();

    let vDetalhe = transporte_detalhe || '';
    if (cleanTransporteTipo === 'MOTO' || cleanTransporteTipo === 'CARRO') {
      const parts = [];
      if (cleanTransportePlaca) parts.push(`Placa: ${cleanTransportePlaca}`);
      if (cleanTransporteMarca || cleanTransporteModelo) {
        parts.push(`${cleanTransporteMarca} ${cleanTransporteModelo}`.trim());
      }
      if (parts.length > 0) vDetalhe = parts.join(' | ');
    }

    const novaViagem = {
      id,
      owner_user_id: req.user.id,
      admin_token,
      share_token: crypto.randomBytes(32).toString('base64url'),
      creator_pin: pin,
      status: 'EM ANDAMENTO',
      origem: cleanOrigem,
      origem_geo: origemGeo,
      data_saida: sanitizeString(data_saida, 15),
      hora_saida: sanitizeString(hora_saida, 10),
      destino: cleanDestino,
      destino_geo: destinoGeo,
      previsao_chegada: sanitizeString(previsao_chegada, 30),
      data_retorno: sanitizeString(data_retorno || data_saida, 15),
      nome_colete: cleanNomeColete,
      grau: cleanGrau,
      telefone: cleanTelefone,
      transporte_tipo: cleanTransporteTipo,
      transporte_marca: cleanTransporteMarca,
      transporte_modelo: cleanTransporteModelo,
      transporte_placa: cleanTransportePlaca,
      transporte_detalhe: vDetalhe,
      vai_acompanhado: cleanVaiAcompanhado,
      quem_vai_junto: cleanQuemVaiJunto,
      acompanhantes: companions.map(({ id: memberId, nome_colete, grau, funcao }) => ({ id: memberId, nome_colete, grau, funcao })),
      emergencia_contato: emergencyContact.nome,
      emergencia_telefone: emergencyContact.telefone,
      emergency_contact_id: emergencyContact.id,
      observacoes_notas: cleanNotas,
      observacoes_resumo: cleanResumo,
      checkins: [
        {
          timestamp: new Date().toISOString(),
          lat: origemGeo.lat,
          lng: origemGeo.lon,
          descricao: 'Protocolo Aberto - Ponto de Partida',
          cidade: cleanOrigem
        }
      ],
      last_city: cleanOrigem,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      closed_at: null,
      encerramento_motivo: ''
    };

    await storage.saveTrip(novaViagem);

    res.status(201).json({
      success: true,
      id: novaViagem.id,
      admin_token: novaViagem.admin_token,
      share_token: novaViagem.share_token,
      creator_pin: novaViagem.creator_pin,
      viagem: novaViagem
    });
  } catch (error) {
    console.error('Erro ao criar protocolo:', error.message);
    res.status(500).json({ error: 'Erro interno ao registrar protocolo de viagem.' });
  }
});

// API: Close trip (Creator only) - Protegido com pinAuthLimiter contra ataques de força bruta no PIN
app.post('/api/viagens/:id/encerrar', pinAuthLimiter, loadOptionalAccount, async (req, res) => {
  const { id } = req.params;
  if (!isValidTripId(id)) {
    return res.status(400).json({ error: 'ID de protocolo inválido.' });
  }

  const token = req.headers['x-creator-token'] || req.body.token || req.query.token;
  const pin = req.headers['x-creator-pin'] || req.body.pin || req.query.pin;
  const motivo = sanitizeString(req.body.motivo, 300) || 'Chegada confirmada com segurança ao destino!';

  const viagem = await storage.findTrip(id);
  if (!viagem) {
    return res.status(404).json({ error: 'Protocolo de viagem não encontrado ou expirado.' });
  }

  if (viagem.status === 'CONCLUÍDA') {
    return res.status(400).json({ error: 'Este protocolo de viagem já foi encerrado.' });
  }

  const tokenValid = token && viagem.admin_token && token === viagem.admin_token;
  const pinValid = pin && viagem.creator_pin && String(pin).trim() === String(viagem.creator_pin).trim();

  const ownerValid = req.user && viagem.owner_user_id === req.user.id;
  if (!tokenValid && !pinValid && !ownerValid) {
    return res.status(403).json({
      error: 'ACESSO NEGADO: Apenas quem registrou o protocolo pode encerrar a viagem! Informe o Token ou PIN de Segurança correto.'
    });
  }

  viagem.status = 'CONCLUÍDA';
  viagem.closed_at = new Date().toISOString();
  viagem.updated_at = new Date().toISOString();
  viagem.encerramento_motivo = motivo;

  if (viagem.destino_geo) {
    viagem.checkins.push({
      timestamp: new Date().toISOString(),
      lat: viagem.destino_geo.lat,
      lng: viagem.destino_geo.lon,
      descricao: 'Viagem Encerrada: ' + motivo,
      cidade: viagem.destino,
      tipo: 'arrival'
    });
  }

  await storage.saveTrip(viagem);

  res.json({
    success: true,
    message: 'Viagem encerrada com sucesso pelo autor do protocolo. A ficha permanecerá visível por 2 horas.',
    viagem
  });
});

// API: Checkin / GPS update (Protegido por checkinLimiter)
app.post('/api/viagens/:id/checkin', checkinLimiter, loadOptionalAccount, async (req, res) => {
  const { id } = req.params;
  if (!isValidTripId(id)) {
    return res.status(400).json({ error: 'ID de protocolo inválido.' });
  }

  const token = req.headers['x-creator-token'] || req.body.token;
  const pin = req.headers['x-creator-pin'] || req.body.pin;
  const { lat, lng, descricao, cidade, timestamp, batch } = req.body;

  const viagem = await storage.findTrip(id);
  if (!viagem) {
    return res.status(404).json({ error: 'Protocolo não encontrado ou expirado.' });
  }

  const tokenValid = token && viagem.admin_token && token === viagem.admin_token;
  const pinValid = pin && viagem.creator_pin && String(pin).trim() === String(viagem.creator_pin).trim();
  const ownerValid = req.user && viagem.owner_user_id === req.user.id;
  if (!tokenValid && !pinValid && !ownerValid) {
    return res.status(403).json({
      error: 'Apenas quem registrou a viagem pode transmitir novos check-ins de localização.'
    });
  }

  if (viagem.status === 'CONCLUÍDA') {
    return res.status(400).json({ error: 'Não é possível adicionar check-ins a uma viagem já encerrada.' });
  }

  if (!viagem.checkins) viagem.checkins = [];

  if (Array.isArray(batch) && batch.length > 0) {
    batch.slice(0, 30).forEach(item => {
      const bLat = parseFloat(item.lat);
      const bLng = parseFloat(item.lng);
      if (gpsUtils.isValidCoordinate(bLat, bLng)) {
        viagem.checkins.push({
          timestamp: item.timestamp || new Date().toISOString(),
          lat: bLat,
          lng: bLng,
          descricao: sanitizeString(item.descricao || 'Ponto no Trajeto (Sincronizado)', 100),
          cidade: sanitizeString(item.cidade || 'Localização offline sincronizada', 100),
          tipo: 'gps'
        });
      }
    });
  } else {
    const pLat = parseFloat(lat);
    const pLng = parseFloat(lng);
    if (!gpsUtils.isValidCoordinate(pLat, pLng)) {
      return res.status(400).json({ error: 'Latitude e Longitude válidas são obrigatórias para check-in.' });
    }

    const passageCity = await reverseGeocodeLocation(pLat, pLng);
    const lastCheckinCity = viagem.checkins[viagem.checkins.length - 1]?.cidade;
    const previousCity = viagem.last_city || lastCheckinCity;
    const checkin = gpsUtils.buildGpsCheckin({
      lat: pLat,
      lng: pLng,
      timestamp,
      description: sanitizeString(descricao || 'Ponto GPS no trajeto', 100),
      city: sanitizeString(cidade || 'Localização GPS', 100),
      reverseGeocodedCity: passageCity
    }, previousCity);
    viagem.checkins.push(checkin);
    if (passageCity) viagem.last_city = passageCity;
  }

  const last = viagem.checkins[viagem.checkins.length - 1];
  viagem.last_location = last;
  viagem.updated_at = new Date().toISOString();

  await storage.saveTrip(viagem);

  res.json({
    success: true,
    last_location: viagem.last_location,
    checkins_count: viagem.checkins.length
  });
});

// SPA ROUTES - DASHBOARD É A PÁGINA INICIAL (/)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/conta', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'account.html'));
});

app.get('/novo', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'novo.html'));
});

app.get('/protocolo', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'novo.html'));
});

app.get('/tracker', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tracker.html'));
});

app.get('/radar', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lista.html'));
});

// Safe global error handler (Prevents stack trace / path disclosure)
app.use((err, req, res, next) => {
  console.error('Erro no servidor:', err.message);
  res.status(err.status || 500).json({ error: 'Erro interno ao processar requisição.' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`💀 GPISSI - INSANOS MC ativo em http://localhost:${PORT}`);
  });
}

module.exports = app;
