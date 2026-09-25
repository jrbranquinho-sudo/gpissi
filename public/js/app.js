// GPISSI - Client Form Logic, Masks, IBGE Autocomplete, Route Calculation & Vehicle Catalog

let veiculosData = { MOTO: { marcas: [], modelosPorMarca: {} }, CARRO: { marcas: [], modelosPorMarca: {} } };
let currentVehicleType = 'MOTO';

document.addEventListener('DOMContentLoaded', () => {
  setupDates();
  setupPhoneMasks();
  setupPlacaMask();
  setupIbgeAutocomplete();
  setupVehicleCatalog();
  setupCompanionToggle();
  setupPinValidation();
  setupFormSubmission();
});

// 1. DATES: Default today and sync Retorno = Saída
function setupDates() {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];
  const hours = String(today.getHours()).padStart(2, '0');
  const minutes = String(today.getMinutes()).padStart(2, '0');

  const dataSaidaInput = document.getElementById('data_saida');
  const horaSaidaInput = document.getElementById('hora_saida');
  const dataRetornoInput = document.getElementById('data_retorno');

  if (dataSaidaInput && !dataSaidaInput.value) {
    dataSaidaInput.value = dateStr;
  }
  if (horaSaidaInput && !horaSaidaInput.value) {
    horaSaidaInput.value = `${hours}:${minutes}`;
  }
  if (dataRetornoInput && !dataRetornoInput.value) {
    dataRetornoInput.value = dataSaidaInput.value;
  }

  // When data_saida changes, sync data_retorno automatically (can be altered)
  dataSaidaInput.addEventListener('change', () => {
    if (dataRetornoInput) {
      dataRetornoInput.value = dataSaidaInput.value;
    }
    triggerRouteCalculation();
  });

  horaSaidaInput.addEventListener('change', () => {
    triggerRouteCalculation();
  });
}

// 2. PHONE MASK: (XX) XXXXX-XXXX
function setupPhoneMasks() {
  const phoneInputs = document.querySelectorAll('.phone-mask');
  phoneInputs.forEach(input => {
    input.addEventListener('input', (e) => {
      let val = e.target.value.replace(/\D/g, '');
      if (val.length > 11) val = val.substring(0, 11);

      if (val.length > 6) {
        val = `(${val.substring(0, 2)}) ${val.substring(2, 7)}-${val.substring(7)}`;
      } else if (val.length > 2) {
        val = `(${val.substring(0, 2)}) ${val.substring(2)}`;
      } else if (val.length > 0) {
        val = `(${val}`;
      }
      e.target.value = val;
    });
  });
}

// 3. PLACA MASK: Brasil (ABC-1234) and Mercosul (ABC-1B34)
function setupPlacaMask() {
  const placaInput = document.getElementById('transporte_placa');
  if (!placaInput) return;

  placaInput.addEventListener('input', (e) => {
    let val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (val.length > 7) val = val.substring(0, 7);

    if (val.length > 3) {
      val = val.substring(0, 3) + '-' + val.substring(3);
    }
    e.target.value = val;
  });
}

// 4. IBGE CITIES AUTOCOMPLETE
function setupIbgeAutocomplete() {
  setupCityAutocompleteFor('origem', 'origem_suggestions');
  setupCityAutocompleteFor('destino', 'destino_suggestions');
}

function setupCityAutocompleteFor(inputId, suggestionsId) {
  const input = document.getElementById(inputId);
  const container = document.getElementById(suggestionsId);
  let debounceTimeout = null;

  input.addEventListener('input', () => {
    clearTimeout(debounceTimeout);
    const q = input.value.trim();
    if (q.length < 2) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    debounceTimeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cidades?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const cities = await res.json();

        if (cities.length === 0) {
          container.style.display = 'none';
          return;
        }

        container.innerHTML = cities.map(c => `
          <div class="autocomplete-item" data-value="${c.label}">
            📍 ${c.label}
          </div>
        `).join('');
        container.style.display = 'block';

        container.querySelectorAll('.autocomplete-item').forEach(item => {
          item.addEventListener('click', () => {
            input.value = item.dataset.value;
            container.style.display = 'none';
            triggerRouteCalculation();
          });
        });
      } catch (e) {
        console.warn('Erro ao buscar cidades:', e);
      }
    }, 200);
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !container.contains(e.target)) {
      container.style.display = 'none';
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      triggerRouteCalculation();
    }, 250);
  });
}

// 5. AUTOMATIC ARRIVAL CALCULATION
let isCalculatingRoute = false;
async function triggerRouteCalculation() {
  const origem = document.getElementById('origem').value.trim();
  const destino = document.getElementById('destino').value.trim();
  const dataSaida = document.getElementById('data_saida').value;
  const horaSaida = document.getElementById('hora_saida').value;
  const previsaoInput = document.getElementById('previsao_chegada');
  const indicator = document.getElementById('calcIndicator');

  if (!origem || !destino || origem.length < 3 || destino.length < 3) {
    return;
  }

  if (isCalculatingRoute) return;
  isCalculatingRoute = true;
  if (indicator) indicator.style.display = 'inline';

  try {
    const res = await fetch('/api/calcular-rota', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origem,
        destino,
        data_saida: dataSaida,
        hora_saida: horaSaida
      })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.previsao_chegada_hora) {
        previsaoInput.value = `${data.previsao_chegada_hora} (${data.distance_km} km | ~${data.duration_text})`;
      }
    }
  } catch (err) {
    console.warn('Falha no cálculo de previsão:', err);
  } finally {
    isCalculatingRoute = false;
    if (indicator) indicator.style.display = 'none';
  }
}

// 6. VEHICLES (MARCAS E MODELOS DADOS_EXTRAS)
async function setupVehicleCatalog() {
  const transportRadios = document.querySelectorAll('input[name="transporte_tipo"]');
  const marcaSelect = document.getElementById('transporte_marca');
  const modeloInput = document.getElementById('transporte_modelo');
  const modelosDatalist = document.getElementById('modelos_datalist');

  const motoCarroBox = document.getElementById('veiculo_moto_carro_box');
  const onibusBox = document.getElementById('veiculo_onibus_box');

  // Load initial vehicle data for MOTO & CARRO
  try {
    const resMoto = await fetch('/api/veiculos?tipo=MOTO');
    if (resMoto.ok) veiculosData.MOTO = await resMoto.json();

    const resCarro = await fetch('/api/veiculos?tipo=CARRO');
    if (resCarro.ok) veiculosData.CARRO = await resCarro.json();

    populateMarcas('MOTO');
  } catch (e) {
    console.warn('Erro ao carregar catálogo de veículos:', e);
  }

  // Populate brand dropdown
  function populateMarcas(tipo) {
    const data = veiculosData[tipo] || { marcas: [] };
    marcaSelect.innerHTML = '<option value="">Selecione a Marca...</option>';
    data.marcas.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.nome;
      opt.dataset.id = m.id;
      opt.textContent = m.nome;
      marcaSelect.appendChild(opt);
    });

    // Reset models
    modeloInput.value = '';
    modelosDatalist.innerHTML = '';
  }

  // When Marca changes, update Modelos datalist
  marcaSelect.addEventListener('change', () => {
    const selectedOption = marcaSelect.selectedOptions[0];
    if (!selectedOption || !selectedOption.dataset.id) {
      modelosDatalist.innerHTML = '';
      return;
    }

    const marcaId = selectedOption.dataset.id;
    const tipo = currentVehicleType;
    const modelos = (veiculosData[tipo] && veiculosData[tipo].modelosPorMarca[marcaId]) || [];

    modelosDatalist.innerHTML = modelos.map(m => `<option value="${m}">`).join('');
    modeloInput.placeholder = modelos.length > 0 
      ? `Escolha entre os ${modelos.length} modelos ou digite` 
      : 'Digite o modelo';
  });

  // Radio selection buttons
  transportRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      document.querySelectorAll('.transport-option').forEach(el => {
        el.classList.remove('selected');
        const span = el.querySelector('.t-label');
        if (span) span.innerHTML = span.innerHTML.replace('[ X ]', '[ &nbsp; ]');
      });

      const parent = radio.closest('.transport-option');
      if (parent) {
        parent.classList.add('selected');
        const span = parent.querySelector('.t-label');
        if (span) span.innerHTML = span.innerHTML.replace('[ &nbsp; ]', '[ X ]');
      }

      currentVehicleType = radio.value;

      if (radio.value === 'ÔNIBUS') {
        motoCarroBox.style.display = 'none';
        onibusBox.style.display = 'block';
      } else {
        motoCarroBox.style.display = 'block';
        onibusBox.style.display = 'none';
        populateMarcas(radio.value);
      }
    });
  });
}

// 7. COMPANION TOGGLE
function setupCompanionToggle() {
  const companionRadios = document.querySelectorAll('input[name="vai_acompanhado"]');
  const acompanhanteBox = document.getElementById('acompanhante_box');
  companionRadios.forEach(r => {
    r.addEventListener('change', () => {
      acompanhanteBox.style.display = r.value === 'Sim' ? 'block' : 'none';
    });
  });
}

// 7.1. PIN VALIDATION & GENERATOR
function isSequentialOrTrivialPin(pinStr) {
  if (!pinStr) return true;
  const clean = String(pinStr).trim();
  if (clean.length < 4 || clean.length > 6 || !/^\d+$/.test(clean)) return true;

  // Todos dígitos iguais (ex: 1111, 2222, 9999)
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

function generateClientSecurePin() {
  let pin = '';
  do {
    pin = Math.floor(1000 + Math.random() * 9000).toString();
  } while (isSequentialOrTrivialPin(pin));
  return pin;
}

function setupPinValidation() {
  const pinInput = document.getElementById('creator_pin');
  const btnGenPin = document.getElementById('btnGenPin');
  const msgEl = document.getElementById('pinValidationMsg');
  if (!pinInput) return;

  const setSecurePin = async () => {
    try {
      const res = await fetch('/api/gerar-pin');
      if (res.ok) {
        const data = await res.json();
        if (data.pin && !isSequentialOrTrivialPin(data.pin)) {
          pinInput.value = data.pin;
          validatePinUI();
          return;
        }
      }
    } catch (_) {}
    pinInput.value = generateClientSecurePin();
    validatePinUI();
  };

  const validatePinUI = () => {
    const val = pinInput.value.replace(/\D/g, '');
    pinInput.value = val;
    if (!msgEl) return true;

    if (!val) {
      msgEl.style.display = 'none';
      return false;
    }
    if (val.length < 4) {
      msgEl.textContent = 'O PIN deve conter no mínimo 4 dígitos numéricos.';
      msgEl.style.display = 'block';
      return false;
    }
    if (isSequentialOrTrivialPin(val)) {
      msgEl.textContent = '⚠️ PIN sequencial ou repetido não permitido (evite 1234, 2345, 4321, 1111). Escolha outro.';
      msgEl.style.display = 'block';
      return false;
    }
    msgEl.style.display = 'none';
    return true;
  };

  pinInput.addEventListener('input', validatePinUI);

  if (btnGenPin) {
    btnGenPin.addEventListener('click', (e) => {
      e.preventDefault();
      setSecurePin();
    });
  }

  // Pre-fill initial secure PIN if empty or invalid
  if (!pinInput.value || isSequentialOrTrivialPin(pinInput.value)) {
    setSecurePin();
  }
}

// 8. FORM SUBMISSION & WHATSAPP
function setupFormSubmission() {
  const form = document.getElementById('protocolForm');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const pinInput = document.getElementById('creator_pin');
    const pinVal = pinInput ? pinInput.value.trim() : '';

    if (isSequentialOrTrivialPin(pinVal)) {
      alert('⚠️ PIN de Segurança Inválido!\n\nPor favor, evite números sequenciais crescentes ou decrescentes (como 1234, 2345, 4321, 5432) e números repetidos (1111).\n\nClique no botão "🎲 Gerar" para obter um PIN seguro automaticamente.');
      if (pinInput) {
        pinInput.focus();
        pinInput.select();
      }
      return;
    }

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⚡ PROCESSANDO ROTA NO GPISSI...</span>';

    const formData = new FormData(form);
    const payload = {};
    formData.forEach((val, key) => {
      payload[key] = val;
    });

    try {
      const response = await fetch('/api/viagens', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Erro ao registrar protocolo.');
      }

      // Save creator credentials
      const savedAuth = {
        id: result.id,
        admin_token: result.admin_token,
        creator_pin: result.creator_pin
      };
      localStorage.setItem(`insanos_trip_${result.id}`, JSON.stringify(savedAuth));
      localStorage.setItem('insanos_last_trip', JSON.stringify(savedAuth));

      buildAndShowModal(result.viagem, result.admin_token);

    } catch (err) {
      alert('Falha ao registrar protocolo no GPISSI: ' + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<img src="/images/caveirasembg.png" alt="Caveira" class="skull-btn-icon"> <span>GERAR PROTOCOLO & FICHA DE VIAGEM</span> ➔';
    }
  });
}

function formatDateBR(dateString) {
  if (!dateString) return 'A definir';
  const parts = dateString.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateString;
}

function buildAndShowModal(viagem, adminToken) {
  const origin = window.location.origin;
  const publicTrackerUrl = `${origin}/tracker?id=${viagem.id}`;
  const adminTrackerUrl = `${origin}/tracker?id=${viagem.id}&token=${adminToken}`;

  const tTipo = viagem.transporte_tipo || 'MOTO';
  const vDetalhe = viagem.transporte_detalhe || (viagem.transporte_placa ? `Placa: ${viagem.transporte_placa}` : 'N/A');

  const motoCheck = tTipo === 'MOTO' ? `[X] MOTO (${vDetalhe})` : '[ ] MOTO';
  const carroCheck = tTipo === 'CARRO' ? `[X] CARRO (${vDetalhe})` : '[ ] CARRO';
  const busCheck = tTipo === 'ÔNIBUS' ? `[X] ÔNIBUS (${vDetalhe})` : '[ ] ÔNIBUS';

  const formattedMessage = 
`*GPISSI - PROTOCOLO DE VIAGEM - INSANOS MC*
🏍️ INSANO NA ESTRADA

📍 INFORMAÇÕES DA ROTA
Origem: ${viagem.origem}
Data de Saída: ${formatDateBR(viagem.data_saida)}
Hora de Saída: ${viagem.hora_saida || 'A definir'}
Destino: ${viagem.destino}
Previsão de Chegada: ${viagem.previsao_chegada || 'Conforme condições de tráfego'}
Data de Retorno: ${formatDateBR(viagem.data_retorno)}

👤 DADOS DO INTEGRANTE
Nome do Colete: ${viagem.nome_colete}
Função/Grau: ${viagem.grau}
Telefone: ${viagem.telefone}

🚌 VEÍCULO
${motoCheck}
${carroCheck}
${busCheck}

👥 ACOMPANHANTE(S)
Vai acompanhado? ${viagem.vai_acompanhado}
Quem vai junto? ${viagem.vai_acompanhado === 'Sim' ? (viagem.quem_vai_junto || 'Não informado') : 'Nenhum (Solo)'}

🆘 EMERGÊNCIA
Contato: ${viagem.emergencia_contato}
Telefone: ${viagem.emergencia_telefone}

📝 OBSERVAÇÕES E RESUMO
Notas: ${viagem.observacoes_notas || 'Nenhuma observação informada.'}
Resumo: ${viagem.observacoes_resumo || 'Sem relato prévio.'}

🔴 STATUS: EM ANDAMENTO (NA ESTRADA)
🗺️ ACOMPANHE EM TEMPO REAL NO MAPA (GPISSI):
${publicTrackerUrl}
*(Ficha válida por até 72h)*`;

  const previewBox = document.getElementById('fichaPreview');
  previewBox.textContent = formattedMessage;

  const waBtn = document.getElementById('btnShareWhatsapp');
  waBtn.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(formattedMessage)}`;

  const copyBtn = document.getElementById('btnCopyFicha');
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(formattedMessage);
      const originalText = copyBtn.innerHTML;
      copyBtn.innerHTML = '<span>✓ Ficha Copiada para a Área de Transferência!</span>';
      setTimeout(() => {
        copyBtn.innerHTML = originalText;
      }, 2500);
    } catch (e) {
      alert('Texto pronto para cópia na tela.');
    }
  };

  const openTrackerBtn = document.getElementById('btnOpenTracker');
  openTrackerBtn.href = adminTrackerUrl;

  const modal = document.getElementById('successModal');
  modal.classList.add('active');

  document.getElementById('closeModalBtn').onclick = () => {
    modal.classList.remove('active');
  };
}
