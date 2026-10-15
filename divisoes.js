const fs = require('fs');
const path = require('path');

const ESTRUTURA_API_URL = process.env.ESTRUTURA_API_URL || 'https://issi-expansao.duckdns.org/api/public/estrutura?pais_id=BR';
const CACHE_FILE = path.join(__dirname, 'data', 'divisoes_cache.json');
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos

let divisionsList = [];
let cachedTree = null;
let lastFetchedTime = 0;
let isFetching = false;

const BRAZILIAN_UFS = 'ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to';
const UF_END_REGEX = new RegExp(`\\s+(${BRAZILIAN_UFS})\\d?$`, 'i');
const UF_DASH_REGEX = new RegExp(`\\s*-\\s*(${BRAZILIAN_UFS})\\d?.*$`, 'i');

function cleanString(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripDivisionPrefix(str) {
  return cleanString(str)
    .replace(/^(divisao|divsao|div|divisoes)\s+/i, '')
    .replace(UF_DASH_REGEX, '')
    .replace(UF_END_REGEX, '')
    .trim();
}

function toTitleCasePt(str) {
  if (!str) return '';
  const minor = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'em', 'no', 'na', 'nos', 'nas']);
  return str.toLowerCase().split(' ').map((w, idx) => {
    if (idx > 0 && minor.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

function formatComandoName(str) {
  if (!str) return '';
  return str.split(' ').map(w => {
    if (/^[ivxlcdm]+$/i.test(w)) {
      return w.toUpperCase();
    }
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
}

function processStructureTree(data) {
  const list = [];
  const seen = new Set();
  if (!Array.isArray(data)) return list;

  for (const cmd of data) {
    const rawCmdName = cmd.nome || cmd.label || '';
    const comando = formatComandoName(rawCmdName);
    const regionais = cmd.regionais || [];
    for (const reg of regionais) {
      const regional = reg.nome || reg.label || '';
      const uf = reg.uf || '';
      const divisoes = reg.divisoes || [];
      for (const div of divisoes) {
        const rawDiv = div.nome || div.label || '';
        if (!rawDiv) continue;

        const key = comando + '|' + regional + '|' + rawDiv;
        if (seen.has(key)) continue;
        seen.add(key);

        const cleanName = rawDiv.replace(/^divis[aã]o\s+/i, '').trim();
        const baseName = cleanName.replace(/\s*-\s*[A-Z0-9]+.*$/i, '').replace(/\(.*\)$/, '').trim();
        const canonical = 'Divisão ' + toTitleCasePt(baseName || cleanName);

        list.push({
          id: div.id,
          comando,
          regional,
          divisao_completa: rawDiv,
          divisao: canonical,
          base_name: baseName,
          uf,
          key_exact: cleanString(rawDiv),
          key_canonical: cleanString(canonical),
          key_stripped: stripDivisionPrefix(baseName || cleanName)
        });
      }
    }
  }

  list.sort((a, b) => a.divisao.localeCompare(b.divisao, 'pt-BR'));
  return list;
}

/**
 * Atualiza os dados a partir da API externa do ISSI
 */
async function fetchStructureAsync(force = false) {
  if (isFetching) return cachedTree;
  const now = Date.now();
  if (!force && cachedTree && (now - lastFetchedTime < CACHE_TTL_MS)) {
    return cachedTree;
  }

  isFetching = true;
  try {
    const res = await fetch(ESTRUTURA_API_URL, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const tree = json.data || json;
    if (Array.isArray(tree) && tree.length > 0) {
      cachedTree = tree;
      divisionsList = processStructureTree(tree);
      lastFetchedTime = Date.now();

      // Salva cópia de segurança em disco para fallback de emergência caso a API caia
      try {
        if (!fs.existsSync(path.dirname(CACHE_FILE))) {
          fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
        }
        fs.writeFileSync(CACHE_FILE, JSON.stringify(tree), 'utf8');
      } catch (_) {}

      return cachedTree;
    }
  } catch (err) {
    console.warn('[divisoes.js] Falha ao consultar API externa:', err.message);
  } finally {
    isFetching = false;
  }

  // Fallback para cache de emergência em disco se memória estiver vazia
  if (!cachedTree) {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        cachedTree = raw;
        divisionsList = processStructureTree(raw);
      }
    } catch (_) {}
  }

  return cachedTree;
}

function loadDivisions() {
  if (divisionsList.length > 0) return divisionsList;

  // 1. Tenta carregar do cache de emergência em disco se existir
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      cachedTree = raw;
      divisionsList = processStructureTree(raw);
      lastFetchedTime = Date.now();
      // Dispara atualização em background
      fetchStructureAsync(true).catch(() => {});
      return divisionsList;
    } catch (_) {}
  }

  // 2. Tenta curl síncrono rápido (útil durante inicialização rápida ou testes)
  try {
    const { execSync } = require('child_process');
    const res = execSync(`curl -s --max-time 6 "${ESTRUTURA_API_URL}"`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    const json = JSON.parse(res);
    const tree = json.data || json;
    if (Array.isArray(tree) && tree.length > 0) {
      cachedTree = tree;
      divisionsList = processStructureTree(tree);
      lastFetchedTime = Date.now();
      try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(tree), 'utf8');
      } catch (_) {}
      return divisionsList;
    }
  } catch (_) {}

  return divisionsList;
}

async function getStructureTree(force = false) {
  if (force || !cachedTree || (Date.now() - lastFetchedTime >= CACHE_TTL_MS)) {
    await fetchStructureAsync(force);
  }
  return cachedTree || [];
}

function matchDivision(input) {
  if (!input) return null;
  const list = loadDivisions();
  const rawClean = cleanString(input);
  const stripped = stripDivisionPrefix(input);

  if (!stripped && !rawClean) return null;

  // 1. Exact match on rawDiv / divisao_completa
  let found = list.find(d => d.key_exact === rawClean);
  if (found) return found;

  // 2. Exact match on canonical 'Divisão ' + base
  found = list.find(d => d.key_canonical === rawClean);
  if (found) return found;

  // 3. Exact match on stripped base
  if (stripped) {
    found = list.find(d => d.key_stripped === stripped);
    if (found) return found;
  }

  // 4. StartsWith or includes match on stripped base
  if (stripped && stripped.length >= 3) {
    found = list.find(d => d.key_stripped === stripped || d.key_stripped.startsWith(stripped) || stripped.startsWith(d.key_stripped));
    if (found) return found;

    // Substring match
    found = list.find(d => d.key_stripped.includes(stripped) || stripped.includes(d.key_stripped));
    if (found) return found;
  }

  // If no match found in dictionary, return input normalized as a custom division
  const baseName = input.replace(/^divis[aã]o\s+/i, '').trim();
  return {
    comando: 'Comando Não Localizado',
    regional: 'Regional Não Localizada',
    divisao: 'Divisão ' + (baseName || input),
    divisao_completa: input,
    base_name: baseName || input,
    uf: ''
  };
}

/**
 * Busca inteligente com classificação por relevância (score)
 * @param {string} query Termo pesquisado
 * @param {number} limit Quantidade máxima (0 = todas sem limite)
 */
function searchDivisions(query, limit = 0) {
  const list = loadDivisions();
  if (!query || !query.trim()) {
    return limit > 0 ? list.slice(0, limit) : list;
  }

  const cleaned = cleanString(query);
  const stripped = stripDivisionPrefix(query);
  const words = cleaned.split(' ').filter(w => w.length > 0);

  const scored = [];
  for (const d of list) {
    let score = 99;

    // Score 1: Match exato na base ou no canonical
    if (d.key_stripped === stripped || d.key_canonical === cleaned || d.key_exact === cleaned) {
      score = 1;
    }
    // Score 2: Começa exatamente com a busca (Ex: "Pires do Rio" começa com "pires do")
    else if (
      (stripped && d.key_stripped.startsWith(stripped)) ||
      d.key_canonical.startsWith(cleaned) ||
      cleanString(d.base_name).startsWith(stripped || cleaned)
    ) {
      score = 2;
    }
    // Score 3: Contém o termo completo na base ou canonical
    else if ((stripped && d.key_stripped.includes(stripped)) || d.key_canonical.includes(cleaned)) {
      score = 3;
    }
    // Score 4: Contém todas as palavras digitadas
    else if (words.length > 1 && words.every(w => d.key_canonical.includes(w) || d.key_exact.includes(w))) {
      score = 4;
    }
    // Score 5: Match na UF, Regional ou Comando
    else if (
      d.key_exact.includes(cleaned) ||
      cleanString(d.regional).includes(cleaned) ||
      cleanString(d.comando).includes(cleaned)
    ) {
      score = 5;
    }

    if (score < 99) {
      scored.push({ item: d, score });
    }
  }

  // Ordena por menor score (mais relevante) e depois ordem alfabética da divisão
  scored.sort((a, b) => a.score - b.score || a.item.divisao.localeCompare(b.item.divisao, 'pt-BR'));

  const results = scored.map(s => s.item);
  return limit > 0 ? results.slice(0, limit) : results;
}

// Dispara busca inicial assíncrona para aquecer o cache
fetchStructureAsync().catch(() => {});

module.exports = {
  loadDivisions,
  matchDivision,
  searchDivisions,
  cleanString,
  stripDivisionPrefix,
  getStructureTree,
  fetchStructureAsync,
  formatComandoName
};
