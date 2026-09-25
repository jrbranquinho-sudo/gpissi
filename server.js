const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for rate limiters behind Vercel / Cloudflare / Nginx
app.set('trust proxy', 1);

// Disable X-Powered-By
app.disable('x-powered-by');

// Vercel Serverless & Local Storage Compatibility
const isVercel = Boolean(process.env.VERCEL || process.env.NOW_REGION);
const DATA_DIR = isVercel ? path.join('/tmp', 'gpissi_data') : path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'viagens.json');
const CIDADES_FILE = path.join(__dirname, 'data', 'cidades_ibge.json');
const VEICULOS_FILE = path.join(__dirname, 'data', 'veiculos_dados.json');

// Ensure directories safely
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const initialDb = path.join(__dirname, 'data', 'viagens.json');
    if (fs.existsSync(initialDb)) {
      try {
        fs.copyFileSync(initialDb, DB_FILE);
      } catch (_) {
        fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2), 'utf8');
      }
    } else {
      fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2), 'utf8');
    }
  }
} catch (err) {
  console.warn('Armazenamento inicializado com aviso:', err.message);
}

// 1. HELMET SECURITY HEADERS WITH STRICT CSP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
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
    pin = Math.floor(1000 + Math.random() * 9000).toString();
  } while (isSequentialOrTrivialPin(pin));
  return pin;
}

// REGRAS DE RETENÇÃO E PURGE AUTOMÁTICO:
// - Ativas: até 72 horas
// - Encerradas: MANTIDAS POR EXATAMENTE 2 HORAS APÓS O ENCERRAMENTO
const MAX_ACTIVE_LIFETIME_MS = 72 * 60 * 60 * 1000; // 72 horas
const MAX_CLOSED_LIFETIME_MS = 2 * 60 * 60 * 1000;  // 2 horas

function cleanupExpiredViagens(viagens) {
  const now = Date.now();
  const valid = viagens.filter(v => {
    // Se a viagem já foi encerrada, mantém apenas por 2 horas após closed_at
    if (v.status === 'CONCLUÍDA' && v.closed_at) {
      const closedTime = new Date(v.closed_at).getTime();
      return (now - closedTime) <= MAX_CLOSED_LIFETIME_MS;
    }
    // Viagens ativas permanecem até 72 horas
    const createdTime = new Date(v.created_at || v.data_saida).getTime();
    if (isNaN(createdTime)) return true;
    return (now - createdTime) <= MAX_ACTIVE_LIFETIME_MS;
  });

  if (valid.length !== viagens.length) {
    const removedCount = viagens.length - valid.length;
    console.log(`🧹 GPISSI: Limpeza automática executada. ${removedCount} ficha(s) expirada(s) ou encerrada(s) há mais de 2h removida(s).`);
    saveViagens(valid);
  }
  return valid;
}

// Read DB with automatic purge
function readViagens() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const viagens = JSON.parse(raw);
    return cleanupExpiredViagens(viagens);
  } catch (err) {
    console.error('Erro ao ler banco de dados:', err);
    return [];
  }
}

// Write DB
function saveViagens(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Erro ao salvar no banco de dados:', err);
    return false;
  }
}

// Periodic cleanup every 10 minutes
setInterval(() => {
  readViagens();
}, 10 * 60 * 1000);

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

  return { lat: -23.5505, lon: -46.6333, display_name: query };
}

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
    const { origem, destino, data_saida, hora_saida } = req.body;
    if (!origem || !destino) {
      return res.status(400).json({ error: 'Origem e Destino são obrigatórios.' });
    }

    const [geoOrigem, geoDestino] = await Promise.all([
      geocodeLocation(origem),
      geocodeLocation(destino)
    ]);

    let distanceKm = 0;
    let durationSeconds = 0;

    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${geoOrigem.lon},${geoOrigem.lat};${geoDestino.lon},${geoDestino.lat}?overview=false`;
      const osrmRes = await fetch(osrmUrl);
      if (osrmRes.ok) {
        const osrmData = await osrmRes.json();
        if (osrmData.routes && osrmData.routes.length > 0) {
          distanceKm = Math.round(osrmData.routes[0].distance / 1000);
          durationSeconds = osrmData.routes[0].duration;
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
      durationSeconds = (distanceKm / 75) * 3600 + (Math.floor(distanceKm / 150) * 900);
    }

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
      previsao_chegada_hora: previsaoHora
    });
  } catch (err) {
    console.error('Erro em calcular-rota:', err);
    res.status(500).json({ error: 'Erro ao calcular rota e previsão.' });
  }
});

// API: List trips - ORDENADO DO MAIS RECENTE PARA O MAIS ANTIGO
app.get('/api/viagens', (req, res) => {
  const viagens = readViagens();
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
    encerramento_motivo: v.encerramento_motivo || ''
  })).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  res.json(list);
});

// API: Get single trip
app.get('/api/viagens/:id', (req, res) => {
  const { id } = req.params;
  if (!isValidTripId(id)) {
    return res.status(400).json({ error: 'ID de protocolo inválido.' });
  }

  const token = req.headers['x-creator-token'] || req.query.token;
  const pin = req.headers['x-creator-pin'] || req.query.pin;

  const viagens = readViagens();
  const viagem = viagens.find(v => v.id === id);

  if (!viagem) {
    return res.status(404).json({ error: 'Protocolo de viagem não encontrado ou expirado.' });
  }

  const isCreator = Boolean(
    (token && viagem.admin_token && token === viagem.admin_token) ||
    (pin && viagem.creator_pin && String(pin).trim() === String(viagem.creator_pin).trim())
  );

  const publicData = { ...viagem };
  if (!isCreator) {
    delete publicData.admin_token;
    delete publicData.creator_pin;
  }
  publicData.is_creator = isCreator;

  res.json(publicData);
});

// API: Gerador de PIN seguro não sequencial
app.get('/api/gerar-pin', (req, res) => {
  res.json({ pin: generateSecurePin() });
});

// API: Register new trip (With createTripLimiter & XSS sanitization)
app.post('/api/viagens', createTripLimiter, async (req, res) => {
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
    const cleanNomeColete = sanitizeString(nome_colete, 80);
    const cleanTelefone = sanitizeString(telefone, 25);
    const cleanGrau = sanitizeString(grau || 'CAMISETA - X', 50);
    const cleanTransporteTipo = ['MOTO', 'CARRO', 'ÔNIBUS', 'OUTRO'].includes(transporte_tipo) ? transporte_tipo : 'MOTO';
    const cleanTransporteMarca = sanitizeString(transporte_marca, 60);
    const cleanTransporteModelo = sanitizeString(transporte_modelo, 60);
    const cleanTransportePlaca = sanitizeString(transporte_placa, 12).toUpperCase();
    const cleanVaiAcompanhado = vai_acompanhado === 'Sim' ? 'Sim' : 'Não';
    const cleanQuemVaiJunto = sanitizeString(quem_vai_junto, 200);
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

    const id = 'INS-' + Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.floor(1000 + Math.random() * 9000);
    const admin_token = uuidv4();

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
      admin_token,
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
      emergencia_contato: cleanEmergenciaContato,
      emergencia_telefone: cleanEmergenciaTelefone,
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
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      closed_at: null,
      encerramento_motivo: ''
    };

    const viagens = readViagens();
    viagens.push(novaViagem);
    saveViagens(viagens);

    res.status(201).json({
      success: true,
      id: novaViagem.id,
      admin_token: novaViagem.admin_token,
      creator_pin: novaViagem.creator_pin,
      viagem: novaViagem
    });
  } catch (error) {
    console.error('Erro ao criar protocolo:', error.message);
    res.status(500).json({ error: 'Erro interno ao registrar protocolo de viagem.' });
  }
});

// API: Close trip (Creator only) - Protegido com pinAuthLimiter contra ataques de força bruta no PIN
app.post('/api/viagens/:id/encerrar', pinAuthLimiter, (req, res) => {
  const { id } = req.params;
  if (!isValidTripId(id)) {
    return res.status(400).json({ error: 'ID de protocolo inválido.' });
  }

  const token = req.headers['x-creator-token'] || req.body.token || req.query.token;
  const pin = req.headers['x-creator-pin'] || req.body.pin || req.query.pin;
  const motivo = sanitizeString(req.body.motivo, 300) || 'Chegada confirmada com segurança ao destino!';

  const viagens = readViagens();
  const index = viagens.findIndex(v => v.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Protocolo de viagem não encontrado ou expirado.' });
  }

  const viagem = viagens[index];

  if (viagem.status === 'CONCLUÍDA') {
    return res.status(400).json({ error: 'Este protocolo de viagem já foi encerrado.' });
  }

  const tokenValid = token && viagem.admin_token && token === viagem.admin_token;
  const pinValid = pin && viagem.creator_pin && String(pin).trim() === String(viagem.creator_pin).trim();

  if (!tokenValid && !pinValid) {
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
      cidade: viagem.destino
    });
  }

  viagens[index] = viagem;
  saveViagens(viagens);

  res.json({
    success: true,
    message: 'Viagem encerrada com sucesso pelo autor do protocolo. A ficha permanecerá visível por 2 horas.',
    viagem
  });
});

// API: Checkin / GPS update (Protegido por checkinLimiter)
app.post('/api/viagens/:id/checkin', checkinLimiter, (req, res) => {
  const { id } = req.params;
  if (!isValidTripId(id)) {
    return res.status(400).json({ error: 'ID de protocolo inválido.' });
  }

  const token = req.headers['x-creator-token'] || req.body.token;
  const pin = req.headers['x-creator-pin'] || req.body.pin;
  const { lat, lng, descricao, cidade, timestamp, batch } = req.body;

  const viagens = readViagens();
  const index = viagens.findIndex(v => v.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Protocolo não encontrado ou expirado.' });
  }

  const viagem = viagens[index];

  const tokenValid = token && viagem.admin_token && token === viagem.admin_token;
  const pinValid = pin && viagem.creator_pin && String(pin).trim() === String(viagem.creator_pin).trim();

  if (!tokenValid && !pinValid) {
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
      if (!isNaN(bLat) && !isNaN(bLng)) {
        viagem.checkins.push({
          timestamp: item.timestamp || new Date().toISOString(),
          lat: bLat,
          lng: bLng,
          descricao: sanitizeString(item.descricao || 'Ponto no Trajeto (Sincronizado)', 100),
          cidade: sanitizeString(item.cidade || 'Rodovia', 100)
        });
      }
    });
  } else {
    const pLat = parseFloat(lat);
    const pLng = parseFloat(lng);
    if (isNaN(pLat) || isNaN(pLng)) {
      return res.status(400).json({ error: 'Latitude e Longitude válidas são obrigatórias para check-in.' });
    }

    const checkin = {
      timestamp: timestamp || new Date().toISOString(),
      lat: pLat,
      lng: pLng,
      descricao: sanitizeString(descricao || 'Check-in no Trajeto (5 min)', 100),
      cidade: sanitizeString(cidade || 'Ponto na Rodovia', 100)
    };
    viagem.checkins.push(checkin);
  }

  const last = viagem.checkins[viagem.checkins.length - 1];
  viagem.last_location = last;
  viagem.updated_at = new Date().toISOString();

  viagens[index] = viagem;
  saveViagens(viagens);

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
