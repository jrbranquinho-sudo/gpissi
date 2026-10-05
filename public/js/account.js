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

async function sendJson(url, data) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const result = await response.json();
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
  const relations = ['Nenhum', 'Esposa', 'Filho(a)', 'Neto(a)', 'Sobrinho(a)', 'Amigo(a)'];
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
  const relations = ['Nenhum', 'Esposa', 'Filho(a)', 'Neto(a)', 'Sobrinho(a)', 'Amigo(a)'];
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
    const row = document.createElement('div');
    row.className = 'account-vehicle-item';
    const description = document.createElement('span');
    const parts = [vehicle.tipo, vehicle.placa, vehicle.marca, vehicle.modelo, vehicle.detalhes].filter(Boolean);
    description.textContent = parts.join(' · ');
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
    row.append(description, remove);
    container.append(row);
  });
}

fetch('/api/auth/me').then(async response => {
  if (!response.ok) return;
  const result = await response.json();
  document.getElementById('authView').hidden = true;
  document.getElementById('sessionView').hidden = false;
  const profile = result.user.profile;
  const role = profile.funcao_grau || [profile.grau, profile.funcao].filter(Boolean).join(' - ');
  document.getElementById('sessionProfile').textContent = `${profile.nome_colete} | ${role} | ${result.user.email}`;
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
    item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; padding: 0.4rem; background: var(--bg-secondary); border-radius: 4px;';
    const link = document.createElement('a');
    link.href = `/tracker?id=${encodeURIComponent(trip.id)}&share=${encodeURIComponent(trip.share_token)}`;
    link.textContent = `${trip.origem} → ${trip.destino} | ${trip.status} | ${trip.data_saida}`;
    link.style.flex = '1';
    const returnBtn = document.createElement('a');
    returnBtn.href = `/novo?retorno_de=${encodeURIComponent(trip.id)}`;
    returnBtn.className = 'btn-secondary';
    returnBtn.style.cssText = 'padding: 0.25rem 0.6rem; font-size: 0.8rem; color: #ff9933; border-color: rgba(255, 102, 0, 0.4); margin-left: 0.5rem; text-decoration: none; display: inline-flex; align-items: center;';
    returnBtn.textContent = '🔄 Retorno';

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-secondary';
    delBtn.style.cssText = 'padding: 0.25rem 0.6rem; font-size: 0.8rem; color: #ef4444; border-color: rgba(239, 68, 68, 0.4); margin-left: 0.5rem;';
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
    item.append(link, returnBtn, delBtn);
    return item;
  }));
}).catch(() => {});
