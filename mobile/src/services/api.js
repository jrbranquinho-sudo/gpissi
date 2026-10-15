// GPISSI API Client Service
// Conecta o aplicativo ao backend oficial do GPISSI

// Por padrão, apontamos para a nuvem de produção (Vercel) e permitimos alternar para IP local
let currentBaseUrl = 'https://gpissi.vercel.app';

export const getBaseUrl = () => currentBaseUrl;

export const setBaseUrl = (url) => {
  if (!url) return;
  // Remove barra final se houver
  currentBaseUrl = url.trim().replace(/\/+$/, '');
};

/**
 * Testa a conexão com o servidor
 */
export async function testServerConnection(urlToTest) {
  const target = (urlToTest || currentBaseUrl).replace(/\/+$/, '');
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${target}/api/gerar-pin`, {
      method: 'GET',
      signal: controller.signal
    });
    clearTimeout(timeout);
    return res.ok;
  } catch (err) {
    return false;
  }
}

/**
 * Busca a lista de viagens ativas e recentes
 */
export async function fetchTrips() {
  try {
    const res = await fetch(`${currentBaseUrl}/api/viagens`);
    if (!res.ok) {
      // Se não autenticado ou falhar, fallback para dados mock/cache
      throw new Error(`Status ${res.status}`);
    }
    const data = await res.json();
    return Array.isArray(data) ? data : (data.viagens || []);
  } catch (err) {
    console.warn('[GPISSI API] Erro ao buscar viagens ativas:', err.message);
    throw err;
  }
}

/**
 * Busca detalhes de uma viagem específica
 */
export async function fetchTrip(tripId) {
  const res = await fetch(`${currentBaseUrl}/api/viagens/${tripId}`);
  if (!res.ok) {
    throw new Error(`Viagem não encontrada (${res.status})`);
  }
  return await res.json();
}

/**
 * Envia Check-in de Telemetria GPS
 * Aceita lat, lng, velocidade, altitude, cidade e descrição
 * Autentica com token de criador ou PIN de 4 dígitos
 */
export async function sendCheckin(tripId, { lat, lng, speed, altitude, accuracy, cidade, descricao }, credentials = {}) {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (credentials.token) {
    headers['x-creator-token'] = credentials.token;
  }
  if (credentials.pin) {
    headers['x-creator-pin'] = String(credentials.pin).trim();
  }

  const payload = {
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    speed: speed != null ? Math.round(speed * 3.6) : undefined, // converte m/s para km/h
    altitude: altitude != null ? Math.round(altitude) : undefined,
    accuracy: accuracy != null ? Math.round(accuracy) : undefined,
    cidade: cidade || 'Em trânsito na Rodovia',
    descricao: descricao || 'Telemetria GPS Automática',
    timestamp: new Date().toISOString(),
    pin: credentials.pin,
    token: credentials.token
  };

  const res = await fetch(`${currentBaseUrl}/api/viagens/${tripId}/checkin`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Falha no check-in (${res.status})`);
  }
  return data;
}

/**
 * Encerra a viagem com validação do PIN de 4 dígitos
 */
export async function finishTrip(tripId, pin) {
  const cleanPin = String(pin).trim();
  const res = await fetch(`${currentBaseUrl}/api/viagens/${tripId}/encerrar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-creator-pin': cleanPin
    },
    body: JSON.stringify({ pin: cleanPin })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Falha ao encerrar viagem (${res.status})`);
  }
  return data;
}

/**
 * Cria um novo protocolo de viagem
 */
export async function createTrip(tripData) {
  const res = await fetch(`${currentBaseUrl}/api/viagens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(tripData)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Erro ao registrar protocolo (${res.status})`);
  }
  return data;
}

/**
 * Gera um PIN seguro não-sequencial pelo backend
 */
export async function generateSecurePin() {
  try {
    const res = await fetch(`${currentBaseUrl}/api/gerar-pin`);
    if (res.ok) {
      const data = await res.json();
      if (data.pin) return String(data.pin);
    }
  } catch (err) {
    // Fallback local caso offline
  }

  // Gerador local caso a API esteja sem rede
  const invalid = ['1234', '2345', '3456', '4567', '5678', '6789', '4321', '5432', '6543', '7654', '8765', '9876', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '0000'];
  let pin = '';
  do {
    pin = String(Math.floor(1000 + Math.random() * 9000));
  } while (invalid.includes(pin));
  return pin;
}

/**
 * Calcula a distância rodoviária e tempo estimado entre cidades
 */
export async function calculateRoute(origem, destino, veiculoTipo = 'MOTO') {
  try {
    const res = await fetch(`${currentBaseUrl}/api/calcular-rota`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origem, destino, veiculo_tipo: veiculoTipo })
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('[GPISSI] Erro ao calcular rota:', err.message);
  }
  return null;
}
