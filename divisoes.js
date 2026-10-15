const fs = require('fs');
const path = require('path');

let divisionsList = [];

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
    .replace(/\s*-\s*[a-z]{2}\d?.*$/i, '')
    .replace(/\s+[a-z]{2}\d?$/i, '')
    .trim();
}

function loadDivisions() {
  if (divisionsList.length > 0) return divisionsList;

  const dataPath = path.join(__dirname, 'data', 'divisoes_data.json');
  if (fs.existsSync(dataPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      divisionsList = raw.map(d => ({
        ...d,
        key_exact: cleanString(d.divisao_completa),
        key_canonical: cleanString(d.divisao),
        key_stripped: stripDivisionPrefix(d.base_name || d.divisao)
      }));
      return divisionsList;
    } catch (e) {
      console.warn('Erro ao carregar data/divisoes_data.json:', e.message);
    }
  }

  // Fallback to xlsx if json not found
  const xlsxPath = path.join(__dirname, 'test', 'divisoes_regionais_comandos.xlsx');
  if (fs.existsSync(xlsxPath)) {
    try {
      const XLSX = require('xlsx');
      const wb = XLSX.readFile(xlsxPath);
      const list = [];
      const seen = new Set();
      wb.SheetNames.filter(s => s.startsWith('CMD ') || s === 'I.S.S.I').forEach(sheetName => {
        const s = wb.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(s, { header: 1 });
        let comando = (data[1] && data[1][0]) ? data[1][0].toString().trim() : sheetName;
        for (let i = 2; i < data.length; i++) {
          const row = data[i];
          if (!row || !row[0]) continue;
          const regional = row[0].toString().trim();
          const rawDiv = row[1] ? row[1].toString().trim() : '';
          if (rawDiv && rawDiv.toLowerCase().startsWith('divis')) {
            const key = comando + '|' + regional + '|' + rawDiv;
            if (!seen.has(key)) {
              seen.add(key);
              const cleanName = rawDiv.replace(/^divis[aã]o\s+/i, '').trim();
              const ufMatch = cleanName.match(/-\s*([A-Z]{2}\d?)/i);
              const uf = ufMatch ? ufMatch[1].toUpperCase() : '';
              const baseName = cleanName.replace(/\s*-\s*[A-Z]{2}\d?.*$/i, '').replace(/\(.*\)$/, '').trim();
              list.push({
                comando,
                regional,
                divisao_completa: rawDiv,
                divisao: 'Divisão ' + baseName,
                base_name: baseName,
                uf,
                key_exact: cleanString(rawDiv),
                key_canonical: cleanString('Divisão ' + baseName),
                key_stripped: stripDivisionPrefix(baseName)
              });
            }
          }
        }
      });
      divisionsList = list;
    } catch (err) {
      console.warn('Erro ao carregar planilha de divisões:', err.message);
    }
  }

  return divisionsList;
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

function searchDivisions(query, limit = 50) {
  const list = loadDivisions();
  if (!query) return list.slice(0, limit);
  const cleaned = cleanString(query);
  const stripped = stripDivisionPrefix(query);

  const results = [];
  for (const d of list) {
    if (d.key_canonical.includes(cleaned) || (stripped && d.key_stripped.includes(stripped)) || d.key_exact.includes(cleaned)) {
      results.push(d);
      if (results.length >= limit) break;
    }
  }
  return results;
}

module.exports = {
  loadDivisions,
  matchDivision,
  searchDivisions,
  cleanString,
  stripDivisionPrefix
};
