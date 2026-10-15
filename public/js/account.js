const accountMessage = document.getElementById('accountMessage');

function formatBrazilMobile(value) {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : '';
  let formatted = `(${digits.slice(0, 2)})`;
  const number = digits.slice(2);
  if (number.length > 0) formatted += ` ${number[0]}`;
  if (number.length > 1) formatted += ` ${number.slice(1, 5)}`;
  if (number.length > 5) formatted += `-${number.slice(5, 9)}`;
  return formatted;
}

function setupPhoneMask(input) {
  input.addEventListener('input', () => {
    input.value = formatBrazilMobile(input.value);
  });
}

document.querySelectorAll('.phone-account-mask').forEach(setupPhoneMask);

function showMessage(message, isError = false) {
  accountMessage.textContent = message;
  accountMessage.style.color = isError ? '#ff5252' : 'var(--accent-green)';
}

async function sendJson(url, data, method = 'POST') {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const contentType = response.headers.get('content-type') || '';
  let result;
  if (contentType.includes('application/json')) {
    result = await response.json();
  } else {
    throw new Error('Servidor retornou resposta inválida.');
  }
  if (!response.ok) {
    const error = new Error(result.error || 'Não foi possível concluir a solicitação.');
    error.payload = result;
    throw error;
  }
  return result;
}

async function loadChallenge(kind) {
  const panel = document.getElementById(`${kind}ChallengePanel`);
  const image = document.getElementById(`${kind}ChallengeImage`);
  const idInput = document.getElementById(`${kind}ChallengeId`);
  const codeInput = document.getElementById(`${kind}ChallengeCode`);
  try {
    const response = await fetch('/api/auth/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        purpose: kind,
        email: document.getElementById('loginEmail').value,
        password: document.getElementById('loginPassword').value
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível gerar a sequência.');
    idInput.value = result.id;
    image.src = result.image;
    codeInput.value = '';
    codeInput.required = true;
    panel.hidden = false;
    codeInput.focus();
  } catch (error) {
    showMessage(error.message, true);
  }
}

function replaceChallenge(kind, challenge) {
  if (!challenge) return;
  document.getElementById(`${kind}ChallengeId`).value = challenge.id;
  document.getElementById(`${kind}ChallengeImage`).src = challenge.image;
  document.getElementById(`${kind}ChallengeCode`).value = '';
  document.getElementById(`${kind}ChallengeCode`).focus();
}

function showForm(formName) {
  const register = formName === 'register';
  document.getElementById('loginForm').hidden = register;
  document.getElementById('registerForm').hidden = !register;
  document.getElementById('loginChallengePanel').hidden = true;
  document.getElementById('registerChallengePanel').hidden = true;
  document.getElementById('requestLoginChallenge').hidden = false;
  document.getElementById('loginChallengeId').value = '';
  document.getElementById('registerChallengeId').value = '';
  document.getElementById('loginChallengeCode').required = false;
  document.getElementById('registerChallengeCode').required = false;
  document.getElementById('showLogin').classList.toggle('active', !register);
  document.getElementById('showRegister').classList.toggle('active', register);
  showMessage('');
  if (register) loadChallenge('register');
}

document.getElementById('showLogin').addEventListener('click', () => showForm('login'));
document.getElementById('showRegister').addEventListener('click', () => showForm('register'));
document.getElementById('refreshRegisterChallenge').addEventListener('click', () => loadChallenge('register'));
document.getElementById('refreshLoginChallenge').addEventListener('click', () => loadChallenge('login'));
document.getElementById('cancelRegisterChallenge').addEventListener('click', () => showForm('login'));
document.getElementById('cancelLoginChallenge').addEventListener('click', () => {
  document.getElementById('loginChallengePanel').hidden = true;
  document.getElementById('requestLoginChallenge').hidden = false;
  document.getElementById('loginChallengeId').value = '';
  document.getElementById('loginChallengeCode').required = false;
  document.getElementById('loginChallengeCode').value = '';
  showMessage('');
});

document.getElementById('registerForm').addEventListener('submit', async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  try {
    await sendJson('/api/auth/register', data);
    window.location.href = '/';
  } catch (error) {
    replaceChallenge('register', error.payload && error.payload.challenge);
    showMessage(error.message, true);
  }
});

document.getElementById('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const result = await sendJson('/api/auth/login', data);
    if (result.requires_challenge) {
      replaceChallenge('login', result.challenge);
      document.getElementById('loginChallengePanel').hidden = false;
      document.getElementById('requestLoginChallenge').hidden = true;
      document.getElementById('loginChallengeCode').required = true;
      document.getElementById('loginSubmit').textContent = 'Confirmar acesso';
      showMessage('Digite a sequência exibida para confirmar seu acesso.');
      return;
    }
    window.location.href = '/';
  } catch (error) {
    replaceChallenge('login', error.payload && error.payload.challenge);
    showMessage(error.message, true);
  }
});

document.getElementById('logoutButton').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.reload();
});

function renderCompanionInputs(companions = []) {
  const container = document.getElementById('accountCompanionsFields');
  container.replaceChildren();
  const relations = ['Nenhum', 'Esposa', 'Esposo', 'Filho(a)', 'Neto(a)', 'Mãe', 'Pai', 'Irmã(o)', 'Sobrinho(a)', 'Cunhada', 'Cunhado', 'Amigo(a)', 'Outros'];
  for (let index = 0; index < 4; index += 1) {
    const companion = companions[index] || {};
    const row = document.createElement('div');
    row.className = 'account-companion-row';
    const title = document.createElement('strong');
    title.textContent = `Acompanhante ${index + 1}`;
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Nome';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'form-control companion-name';
    nameInput.maxLength = 100;
    nameInput.value = companion.nome || '';
    nameInput.autocomplete = 'off';

    const relLabel = document.createElement('label');
    relLabel.textContent = 'Tipo de Relação';
    const relSelect = document.createElement('select');
    relSelect.className = 'form-control companion-relacao';
    relations.forEach(rel => {
      const opt = document.createElement('option');
      opt.value = rel;
      opt.textContent = rel;
      if ((companion.relacao || 'Nenhum').toLowerCase() === rel.toLowerCase()) {
        opt.selected = true;
      }
      relSelect.appendChild(opt);
    });

    const phoneLabel = document.createElement('label');
    phoneLabel.textContent = 'Celular';
    const phoneInput = document.createElement('input');
    phoneInput.type = 'tel';
    phoneInput.className = 'form-control phone-account-mask companion-phone';
    phoneInput.inputMode = 'numeric';
    phoneInput.placeholder = '(64) 9 9999-9999';
    phoneInput.maxLength = 18;
    phoneInput.value = companion.telefone || '';
    phoneInput.autocomplete = 'off';
    const idInput = document.createElement('input');
    idInput.type = 'hidden';
    idInput.className = 'companion-id';
    idInput.value = companion.id || '';
    row.append(title, nameLabel, nameInput, relLabel, relSelect, phoneLabel, phoneInput, idInput);
    container.append(row);
    setupPhoneMask(phoneInput);
  }
}

function renderEmergencyContactInputs(contacts = []) {
  const container = document.getElementById('emergencyContactsFields');
  container.replaceChildren();
  const relations = ['Nenhum', 'Esposa', 'Esposo', 'Filho(a)', 'Neto(a)', 'Mãe', 'Pai', 'Irmã(o)', 'Sobrinho(a)', 'Cunhada', 'Cunhado', 'Amigo(a)', 'Outros'];
  for (let index = 0; index < 3; index += 1) {
    const contact = contacts[index] || {};
    const row = document.createElement('div');
    row.className = 'account-companion-row';
    const title = document.createElement('strong');
    title.textContent = `Contato ${index + 1}`;
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Nome';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'form-control emergency-contact-name';
    nameInput.maxLength = 100;
    nameInput.value = contact.nome || '';

    const relLabel = document.createElement('label');
    relLabel.textContent = 'Tipo de Relação';
    const relSelect = document.createElement('select');
    relSelect.className = 'form-control emergency-contact-relacao';
    relations.forEach(rel => {
      const opt = document.createElement('option');
      opt.value = rel;
      opt.textContent = rel;
      if ((contact.relacao || 'Nenhum').toLowerCase() === rel.toLowerCase()) {
        opt.selected = true;
      }
      relSelect.appendChild(opt);
    });

    const phoneLabel = document.createElement('label');
    phoneLabel.textContent = 'Celular';
    const phoneInput = document.createElement('input');
    phoneInput.type = 'tel';
    phoneInput.className = 'form-control phone-account-mask emergency-contact-phone';
    phoneInput.inputMode = 'numeric';
    phoneInput.placeholder = '(64) 9 9999-9999';
    phoneInput.maxLength = 18;
    phoneInput.value = contact.telefone || '';
    const idInput = document.createElement('input');
    idInput.type = 'hidden';
    idInput.className = 'emergency-contact-id';
    idInput.value = contact.id || '';
    row.append(title, nameLabel, nameInput, relLabel, relSelect, phoneLabel, phoneInput, idInput);
    container.append(row);
    setupPhoneMask(phoneInput);
  }
}

document.getElementById('companionsForm').addEventListener('submit', async event => {
  event.preventDefault();
  const message = document.getElementById('companionsMessage');
  const companions = [...document.querySelectorAll('#accountCompanionsFields .account-companion-row')].map(row => ({
    id: row.querySelector('.companion-id').value,
    nome: row.querySelector('.companion-name').value.trim(),
    relacao: row.querySelector('.companion-relacao')?.value || 'Nenhum',
    telefone: row.querySelector('.companion-phone').value
  }));
  try {
    const response = await fetch('/api/account/companions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companions })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível salvar os contatos.');
    renderCompanionInputs(result.companions);
    message.textContent = 'Acompanhantes salvos na sua conta.';
    message.style.color = 'var(--accent-green)';
  } catch (error) {
    message.textContent = error.message;
    message.style.color = '#ff5252';
  }
});

document.getElementById('emergencyContactsForm').addEventListener('submit', async event => {
  event.preventDefault();
  const message = document.getElementById('emergencyContactsMessage');
  const contacts = [...document.querySelectorAll('#emergencyContactsFields .account-companion-row')].map(row => ({
    id: row.querySelector('.emergency-contact-id').value,
    nome: row.querySelector('.emergency-contact-name').value.trim(),
    relacao: row.querySelector('.emergency-contact-relacao')?.value || 'Nenhum',
    telefone: row.querySelector('.emergency-contact-phone').value
  }));
  try {
    const response = await fetch('/api/account/emergency-contacts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contacts })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível salvar os contatos.');
    renderEmergencyContactInputs(result.contacts);
    message.textContent = 'Contatos de emergência salvos na sua conta.';
    message.style.color = 'var(--accent-green)';
  } catch (error) {
    message.textContent = error.message;
    message.style.color = '#ff5252';
  }
});

function renderVehicles(vehicles = []) {
  const container = document.getElementById('accountVehiclesList');
  container.replaceChildren();
  if (vehicles.length === 0) {
    container.textContent = 'Nenhum veículo salvo. Os dados serão adicionados quando você preencher um protocolo.';
    return;
  }
  vehicles.forEach(vehicle => {
    const card = document.createElement('div');
    card.className = 'account-card-item';

    const info = document.createElement('div');
    info.className = 'account-card-text';
    const parts = [vehicle.tipo, vehicle.placa, vehicle.marca, vehicle.modelo, vehicle.detalhes].filter(Boolean);
    info.textContent = parts.join(' · ');

    const actions = document.createElement('div');
    actions.className = 'account-card-actions';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn-secondary account-vehicle-delete';
    remove.textContent = 'Excluir';
    remove.setAttribute('aria-label', `Excluir veículo ${vehicle.placa || vehicle.modelo || ''}`);
    remove.addEventListener('click', async () => {
      const response = await fetch(`/api/account/vehicles/${encodeURIComponent(vehicle.id)}`, { method: 'DELETE' });
      const result = await response.json();
      if (response.ok) renderVehicles(result.vehicles);
    });

    actions.append(remove);
    card.append(info, actions);
    container.append(card);
  });
}

fetch('/api/auth/me').then(async response => {
  if (!response.ok) return;
  const result = await response.json();
  document.getElementById('authView').hidden = true;
  document.getElementById('sessionView').hidden = false;
  const profile = result.user.profile;
  const role = profile.funcao_grau || [profile.grau, profile.funcao].filter(Boolean).join(' - ');
  const formattedDivStructure = [profile.divisao, profile.regional, profile.comando].filter(Boolean).join(' | ');
  const divInfo = formattedDivStructure || 'Sem Divisão cadastrada';
  document.getElementById('sessionProfile').textContent = `${profile.nome_colete} | ${role} | ${divInfo} | ${result.user.email}`;

  // Detalhes da Divisão atual e aviso para usuários já cadastrados sem Divisão
  const currentDivEl = document.getElementById('currentDivisaoDetails');
  const alertEl = document.getElementById('missingDivisaoAlert');
  if (profile.divisao && profile.divisao !== 'Sem Divisão') {
    if (currentDivEl) {
      currentDivEl.innerHTML = `<span style="font-weight: 700; color: #fff; font-size: 0.95rem;">${formattedDivStructure}</span>`;
    }
    if (alertEl) alertEl.style.display = 'none';
  } else {
    if (currentDivEl) {
      currentDivEl.innerHTML = `<span style="color:#ef4444;font-weight:600;">⚠️ Nenhuma Divisão vinculada. Atualize abaixo para aninhar com sua Regional e Comando.</span>`;
    }
    if (alertEl) alertEl.style.display = 'block';
  }

  // Inicializa os selects encadeados de Comando, Regional e Divisão no perfil
  configurarDropdownsEstrutura(
    document.getElementById('accountComandoSelect'),
    document.getElementById('accountRegionalSelect'),
    document.getElementById('accountDivisaoSelect'),
    {
      comando: profile.comando,
      regional: profile.regional,
      divisao: profile.divisao
    }
  );

  const companionsResponse = await fetch('/api/account/companions');
  const companions = await companionsResponse.json();
  renderCompanionInputs(companionsResponse.ok ? companions : []);
  const emergencyResponse = await fetch('/api/account/emergency-contacts');
  const emergencyContacts = await emergencyResponse.json();
  renderEmergencyContactInputs(emergencyResponse.ok ? emergencyContacts : []);
  const vehiclesResponse = await fetch('/api/account/vehicles');
  const vehicles = await vehiclesResponse.json();
  renderVehicles(vehiclesResponse.ok ? vehicles : []);
  const tripsResponse = await fetch('/api/minhas-viagens');
  const trips = await tripsResponse.json();
  const tripsList = document.getElementById('myTripsList');
  if (!tripsResponse.ok) {
    tripsList.textContent = trips.error || 'Não foi possível carregar suas viagens.';
    return;
  }
  if (trips.length === 0) {
    tripsList.textContent = 'Você ainda não registrou viagens.';
    return;
  }
  tripsList.replaceChildren(...trips.map(trip => {
    const item = document.createElement('div');
    item.className = 'account-card-item';

    const info = document.createElement('div');
    info.className = 'account-card-text';

    const link = document.createElement('a');
    link.href = `/tracker?id=${encodeURIComponent(trip.id)}&share=${encodeURIComponent(trip.share_token)}`;
    link.textContent = `${trip.origem} → ${trip.destino} | ${trip.status} | ${trip.data_saida}`;
    link.className = 'account-trip-title';
    info.append(link);

    const actions = document.createElement('div');
    actions.className = 'account-card-actions';

    const returnBtn = document.createElement('a');
    returnBtn.href = `/novo?retorno_de=${encodeURIComponent(trip.id)}`;
    returnBtn.className = 'btn-secondary account-trip-btn-return';
    returnBtn.textContent = '🔄 Retorno';

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-secondary account-trip-btn-del';
    delBtn.textContent = 'Apagar';
    delBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!confirm(`Deseja realmente apagar a viagem ${trip.origem} → ${trip.destino}?`)) return;
      const res = await fetch(`/api/viagens/${encodeURIComponent(trip.id)}`, { method: 'DELETE' });
      if (res.ok) {
        item.remove();
        if (tripsList.children.length === 0) {
          tripsList.textContent = 'Você ainda não registrou viagens.';
        }
      } else {
        const err = await res.json();
        alert(err.error || 'Não foi possível apagar a viagem.');
      }
    });

    actions.append(returnBtn, delBtn);
    item.append(info, actions);
    return item;
  }));
}).catch(() => {});

// Integração com a API de Estrutura do ISSI (Comandos -> Regionais -> Divisões)
const ESTRUTURA_API_URL = 'https://issi-expansao.duckdns.org/api/public/estrutura?pais_id=BR';
let cachedEstruturaData = null;

async function obterEstrutura() {
  if (cachedEstruturaData && Array.isArray(cachedEstruturaData) && cachedEstruturaData.length > 0) {
    return cachedEstruturaData;
  }
  try {
    const res = await fetch(ESTRUTURA_API_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    cachedEstruturaData = json.data || json;
    return cachedEstruturaData;
  } catch (err) {
    console.warn('Tentando fallback para /api/public/estrutura:', err.message);
    try {
      const localRes = await fetch('/api/public/estrutura');
      const localJson = await localRes.json();
      cachedEstruturaData = localJson.data || localJson;
      return cachedEstruturaData;
    } catch (localErr) {
      console.error('Erro ao carregar estrutura:', localErr);
      return [];
    }
  }
}

function configurarDropdownsEstrutura(selectComando, selectRegional, selectDivisao, preSelected = {}) {
  if (!selectComando || !selectRegional || !selectDivisao) return;

  if (typeof makeSearchableSelect === 'function') {
    makeSearchableSelect(selectComando, '1. Selecione ou digite o Comando...');
    makeSearchableSelect(selectRegional, '2. Selecione ou digite a Regional...');
    makeSearchableSelect(selectDivisao, '3. Selecione ou digite a Divisão...');
  }

  function preencherRegionais(cmdObj, selectedRegNome = '', selectedDivNome = '') {
    selectRegional.innerHTML = '<option value="">Selecione uma Regional</option>';
    selectDivisao.innerHTML = '<option value="">Selecione uma regional primeiro</option>';
    selectDivisao.disabled = true;

    if (!cmdObj || !Array.isArray(cmdObj.regionais) || cmdObj.regionais.length === 0) {
      selectRegional.disabled = true;
      selectRegional.innerHTML = '<option value="">Nenhuma regional encontrada</option>';
      return;
    }

    cmdObj.regionais.forEach(reg => {
      const opt = document.createElement('option');
      const nome = reg.label || reg.nome;
      opt.value = nome;
      opt.textContent = nome;
      opt.dataset.id = reg.id;
      if (selectedRegNome && (reg.nome === selectedRegNome || reg.label === selectedRegNome || nome.toLowerCase() === selectedRegNome.toLowerCase())) {
        opt.selected = true;
      }
      selectRegional.appendChild(opt);
    });
    selectRegional.disabled = false;

    if (selectRegional.value) {
      preencherDivisoes(cmdObj, selectRegional.value, selectedDivNome);
    }
  }

  function preencherDivisoes(cmdObj, regNome, selectedDivNome = '') {
    selectDivisao.innerHTML = '<option value="">Selecione uma Divisão</option>';
    if (!regNome) {
      selectDivisao.disabled = true;
      return;
    }

    const regional = cmdObj?.regionais?.find(r => (r.nome === regNome || r.label === regNome));
    if (!regional || !Array.isArray(regional.divisoes) || regional.divisoes.length === 0) {
      selectDivisao.disabled = true;
      selectDivisao.innerHTML = '<option value="">Nenhuma divisão encontrada</option>';
      return;
    }

    regional.divisoes.forEach(div => {
      const opt = document.createElement('option');
      const nome = div.label || div.nome;
      opt.value = nome;
      opt.textContent = nome;
      opt.dataset.id = div.id;
      if (selectedDivNome && (
        div.nome === selectedDivNome ||
        div.label === selectedDivNome ||
        nome.toLowerCase() === selectedDivNome.toLowerCase() ||
        nome.toLowerCase().includes(selectedDivNome.toLowerCase()) ||
        selectedDivNome.toLowerCase().includes(nome.toLowerCase())
      )) {
        opt.selected = true;
      }
      selectDivisao.appendChild(opt);
    });
    selectDivisao.disabled = false;
  }

  obterEstrutura().then(dadosEstrutura => {
    selectComando.innerHTML = '<option value="">Selecione um Comando</option>';
    let selectedCmdObj = null;

    dadosEstrutura.forEach(cmd => {
      const opt = document.createElement('option');
      const nome = cmd.label || cmd.nome;
      opt.value = nome;
      opt.textContent = nome;
      opt.dataset.id = cmd.id;
      if (preSelected.comando && (cmd.nome.toLowerCase() === preSelected.comando.toLowerCase() || cmd.label.toLowerCase() === preSelected.comando.toLowerCase())) {
        opt.selected = true;
        selectedCmdObj = cmd;
      }
      selectComando.appendChild(opt);
    });

    if (selectedCmdObj || selectComando.value) {
      const activeCmd = selectedCmdObj || dadosEstrutura.find(c => (c.label === selectComando.value || c.nome === selectComando.value));
      preencherRegionais(activeCmd, preSelected.regional, preSelected.divisao);
    }
  }).catch(err => {
    console.error('Erro ao preencher comandos:', err);
    selectComando.innerHTML = '<option value="">Erro ao carregar comandos</option>';
  });

  selectComando.addEventListener('change', async () => {
    const dadosEstrutura = await obterEstrutura();
    const cmdNome = selectComando.value;
    const cmdObj = dadosEstrutura.find(c => c.label === cmdNome || c.nome === cmdNome);
    preencherRegionais(cmdObj);
  });

  selectRegional.addEventListener('change', async () => {
    const dadosEstrutura = await obterEstrutura();
    const cmdNome = selectComando.value;
    const cmdObj = dadosEstrutura.find(c => c.label === cmdNome || c.nome === cmdNome);
    preencherDivisoes(cmdObj, selectRegional.value);
  });
}

// Inicializa dropdowns encadeados para cadastro de novo integrante
configurarDropdownsEstrutura(
  document.getElementById('registerComando'),
  document.getElementById('registerRegional'),
  document.getElementById('registerDivisao')
);

// Atualização de Divisão cadastral no perfil do integrante
const updateDivForm = document.getElementById('updateDivisaoForm');
if (updateDivForm) {
  updateDivForm.addEventListener('submit', async e => {
    e.preventDefault();
    const cmdSelect = document.getElementById('accountComandoSelect');
    const regSelect = document.getElementById('accountRegionalSelect');
    const divSelect = document.getElementById('accountDivisaoSelect');
    const msg = document.getElementById('divisaoUpdateMessage');

    const comando = (cmdSelect?.value || '').trim();
    const regional = (regSelect?.value || '').trim();
    const divisao = (divSelect?.value || '').trim();

    if (!divisao) {
      msg.textContent = 'Por favor, selecione sua Divisão.';
      msg.style.color = '#ef4444';
      return;
    }

    try {
      msg.textContent = 'Atualizando...';
      msg.style.color = 'var(--text-muted)';
      const res = await sendJson('/api/account/divisao', { divisao, regional, comando });
      msg.textContent = '✓ Divisão atualizada com sucesso!';
      msg.style.color = '#00e676';
      const prof = res.profile;
      const currentDivEl = document.getElementById('currentDivisaoDetails');
      if (currentDivEl) {
        const textStr = [prof.divisao || divisao, prof.regional || regional, prof.comando || comando].filter(Boolean).join(' | ');
        currentDivEl.innerHTML = `<span style="font-weight: 700; color: #fff; font-size: 0.95rem;">${textStr}</span>`;
      }
      const alertEl = document.getElementById('missingDivisaoAlert');
      if (alertEl) alertEl.style.display = 'none';
    } catch (err) {
      msg.textContent = err.message || 'Erro ao atualizar divisão.';
      msg.style.color = '#ef4444';
    }
  });
}
