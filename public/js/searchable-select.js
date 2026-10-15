/**
 * Searchable Select Component para GPISSI
 * Transforma qualquer <select> em um dropdown pesquisável em tempo real,
 * permitindo digitar qualquer caractere para filtrar instantaneamente.
 */
function makeSearchableSelect(selectEl, defaultPlaceholder = 'Selecione ou digite para filtrar...') {
  if (!selectEl) return null;
  if (selectEl._searchableSelect) return selectEl._searchableSelect;

  selectEl.style.display = 'none';

  const wrapper = document.createElement('div');
  wrapper.className = 'searchable-select-wrap';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = (selectEl.className || 'form-control') + ' searchable-select-input';
  input.placeholder = defaultPlaceholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.disabled = selectEl.disabled;

  const chevron = document.createElement('span');
  chevron.className = 'searchable-select-chevron';
  chevron.innerHTML = '&#9662;'; // ▾

  const dropdown = document.createElement('div');
  dropdown.className = 'searchable-select-dropdown';

  wrapper.appendChild(input);
  wrapper.appendChild(chevron);
  wrapper.appendChild(dropdown);
  selectEl.parentNode.insertBefore(wrapper, selectEl.nextSibling);

  function getOptions() {
    return Array.from(selectEl.options).filter(opt => opt.value !== '');
  }

  function syncFromSelect() {
    input.disabled = selectEl.disabled;
    const selected = selectEl.options[selectEl.selectedIndex];
    if (selected && selected.value) {
      input.value = selected.textContent;
    } else {
      input.value = '';
      const firstOpt = selectEl.options[0];
      input.placeholder = firstOpt && firstOpt.textContent ? firstOpt.textContent : defaultPlaceholder;
    }
  }

  function renderList(query = '') {
    dropdown.innerHTML = '';
    const cleanQ = (query || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const opts = getOptions();

    const filtered = opts.filter(opt => {
      if (!cleanQ) return true;
      const text = (opt.textContent || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return text.includes(cleanQ);
    });

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'dropdown-empty-msg';
      empty.textContent = 'Nenhum resultado encontrado';
      dropdown.appendChild(empty);
      return;
    }

    filtered.forEach(opt => {
      const item = document.createElement('div');
      item.className = 'dropdown-item-option' + (opt.value === selectEl.value ? ' selected' : '');
      item.textContent = opt.textContent;
      item.dataset.value = opt.value;

      item.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Impede perda de foco antes da seleção
        selectEl.value = opt.value;
        input.value = opt.textContent;
        dropdown.style.display = 'none';
        wrapper.classList.remove('open');
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      });

      dropdown.appendChild(item);
    });
  }

  function openDropdown() {
    if (input.disabled) return;
    renderList(input.value);
    dropdown.style.display = 'block';
    wrapper.classList.add('open');
  }

  function closeDropdown() {
    dropdown.style.display = 'none';
    wrapper.classList.remove('open');
    const selected = selectEl.options[selectEl.selectedIndex];
    if (selected && selected.value) {
      input.value = selected.textContent;
    } else if (!selectEl.value) {
      input.value = '';
    }
  }

  input.addEventListener('focus', () => {
    openDropdown();
    input.select();
  });

  input.addEventListener('click', () => {
    openDropdown();
  });

  input.addEventListener('input', () => {
    if (dropdown.style.display !== 'block') {
      dropdown.style.display = 'block';
      wrapper.classList.add('open');
    }
    renderList(input.value);

    // Se o usuário apagar o texto por completo, limpa a seleção
    if (!input.value.trim()) {
      if (selectEl.value !== '') {
        selectEl.value = '';
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else {
      // Se digitou exatamente o nome de uma opção
      const cleanQ = input.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      const exact = getOptions().find(opt => {
        const t = (opt.textContent || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        return t === cleanQ;
      });
      if (exact && selectEl.value !== exact.value) {
        selectEl.value = exact.value;
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target)) {
      closeDropdown();
    }
  });

  // Observa mudanças nas opções ou no estado disabled do select nativo
  const observer = new MutationObserver(() => {
    syncFromSelect();
  });
  observer.observe(selectEl, { childList: true, attributes: true, attributeFilter: ['disabled'] });

  syncFromSelect();
  const api = { input, wrapper, sync: syncFromSelect };
  selectEl._searchableSelect = api;
  return api;
}

if (typeof window !== 'undefined') {
  window.makeSearchableSelect = makeSearchableSelect;
}
