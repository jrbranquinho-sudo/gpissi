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
    window.location.href = '/novo';
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
    window.location.href = '/novo';
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
    row.append(title, nameLabel, nameInput, phoneLabel, phoneInput, idInput);
    container.append(row);
    setupPhoneMask(phoneInput);
  }
}

function renderEmergencyContactInputs(contacts = []) {
  const container = document.getElementById('emergencyContactsFields');
  container.replaceChildren();
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
    row.append(title, nameLabel, nameInput, phoneLabel, phoneInput, idInput);
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
  const contacts = [...document.querySelectorAll('.account-companion-row .emergency-contact-name')].map(nameInput => {
    const row = nameInput.closest('.account-companion-row');
    return {
      id: row.querySelector('.emergency-contact-id').value,
      nome: nameInput.value.trim(),
      telefone: row.querySelector('.emergency-contact-phone').value
    };
  });
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
    const item = document.createElement('p');
    const link = document.createElement('a');
    link.href = `/tracker?id=${encodeURIComponent(trip.id)}&share=${encodeURIComponent(trip.share_token)}`;
    link.textContent = `${trip.origem} → ${trip.destino} | ${trip.status} | ${trip.data_saida}`;
    item.append(link);
    return item;
  }));
}).catch(() => {});
