(() => {
  // Utility: generate or retrieve a persistent participant ID.  We store
  // this identifier in localStorage so that reloading the page or joining
  // multiple groups keeps the same identity.  Browsers that support
  // crypto.randomUUID will produce RFC 4122 UUIDs; otherwise we use a
  // fallback.
  function generateParticipantId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'id-' + Math.random().toString(36).substring(2, 10);
  }

  function storeParticipantForGroup(code, participantId, name) {
    localStorage.setItem('participantId', participantId);
    localStorage.setItem(`participantId:${code}`, participantId);
    if (name) {
      localStorage.setItem('participantName', name);
      localStorage.setItem(`participantName:${code}`, name);
    }
  }
  // Grab elements from the DOM.
  const showCreateBtn = document.getElementById('show-create');
  const showJoinBtn = document.getElementById('show-join');
  const createForm = document.getElementById('create-form');
  const joinForm = document.getElementById('join-form');
  const createNameInput = document.getElementById('create-name');
  const joinCodeInput = document.getElementById('join-code');
  const joinNameInput = document.getElementById('join-name');
  const loadParticipantsBtn = document.getElementById('load-participants');
  const joinOptions = document.getElementById('join-options');
  const joinModeInputs = document.querySelectorAll('input[name="join-mode"]');
  const joinNewPanel = document.getElementById('join-new');
  const joinExistingPanel = document.getElementById('join-existing');
  const joinExistingSelect = document.getElementById('join-existing-select');
  const joinExistingEmpty = document.getElementById('join-existing-empty');
  const joinFeedback = document.getElementById('join-feedback');

  function setJoinFeedback(message) {
    if (!joinFeedback) return;
    joinFeedback.textContent = message || '';
    joinFeedback.classList.toggle('hidden', !message);
  }

  // Toggle visibility of forms.  Only one should be visible at a time.
  showCreateBtn?.addEventListener('click', () => {
    createForm.classList.remove('hidden');
    joinForm.classList.add('hidden');
  });
  showJoinBtn?.addEventListener('click', () => {
    joinForm.classList.remove('hidden');
    createForm.classList.add('hidden');
  });

  // Handle creating a new group.  Prevent the default form submission,
  // gather the user's name and send a POST request.  Upon success
  // redirect to the group page with the returned code.
  createForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = createNameInput.value.trim();
    if (!name) return;
    const participantId = generateParticipantId();
    try {
      const response = await fetch('/create-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, participantId })
      });
      const result = await response.json();
      if (response.ok && result.code) {
        // Store the name in localStorage to reuse when rejoining.
        storeParticipantForGroup(result.code, participantId, name);
        window.location.href = `/group.html?code=${encodeURIComponent(result.code)}`;
      } else {
        alert(result.error || 'Erro ao criar grupo');
      }
    } catch (err) {
      console.error(err);
      alert('Falha ao criar grupo');
    }
  });

  async function loadParticipants() {
    const code = joinCodeInput.value.trim().toUpperCase();
    if (!code) {
      setJoinFeedback('Por favor, insira o código do grupo.');
      return null;
    }
    setJoinFeedback('');
    try {
      const response = await fetch(`/group-info?code=${encodeURIComponent(code)}`);
      const result = await response.json();
      if (!response.ok) {
        return {
          code,
          participants: [],
          errorMessage: result.error || 'Erro ao buscar participantes.'
        };
      }
      return { code, participants: result.participants || [] };
    } catch (err) {
      console.error(err);
      return {
        code,
        participants: [],
        errorMessage: 'Falha ao buscar participantes.'
      };
    }
  }

  function renderParticipantsList(participants) {
    if (!joinExistingSelect) return;
    joinExistingSelect.innerHTML = '';
    participants.forEach((participant) => {
      const option = document.createElement('option');
      option.value = participant.id;
      option.textContent = `${participant.name} (${participant.slices} fatias)`;
      option.dataset.name = participant.name;
      joinExistingSelect.appendChild(option);
    });
    const hasParticipants = participants.length > 0;
    joinExistingSelect.disabled = !hasParticipants;
    joinExistingEmpty?.classList.toggle('hidden', hasParticipants);
  }

  function setJoinMode(mode) {
    joinNewPanel?.classList.toggle('hidden', mode !== 'new');
    joinExistingPanel?.classList.toggle('hidden', mode !== 'existing');
  }

  loadParticipantsBtn?.addEventListener('click', async () => {
    const result = await loadParticipants();
    if (!result) return;
    renderParticipantsList(result.participants);
    joinOptions?.classList.remove('hidden');
    setJoinMode(document.querySelector('input[name="join-mode"]:checked')?.value || 'new');
    setJoinFeedback(result.errorMessage || '');
  });

  joinModeInputs.forEach((input) => {
    input.addEventListener('change', (event) => {
      setJoinMode(event.target.value);
    });
  });

  // Handle joining an existing group.
  joinForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = joinCodeInput.value.trim().toUpperCase();
    if (!code) return;
    if (joinOptions?.classList.contains('hidden')) {
      const result = await loadParticipants();
      if (!result) return;
      renderParticipantsList(result.participants);
      joinOptions.classList.remove('hidden');
      setJoinMode(document.querySelector('input[name="join-mode"]:checked')?.value || 'new');
      return;
    }
    const selectedMode =
      document.querySelector('input[name="join-mode"]:checked')?.value || 'new';
    let name = '';
    let participantId = '';
    if (selectedMode === 'existing') {
      const selectedOption = joinExistingSelect?.selectedOptions?.[0];
      if (!selectedOption) return;
      participantId = selectedOption.value;
      name = selectedOption.dataset.name || selectedOption.textContent || '';
    } else {
      name = joinNameInput.value.trim();
      if (!name) return;
      participantId = generateParticipantId();
    }
    try {
      const response = await fetch('/join-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, participantId })
      });
      const result = await response.json();
      if (response.ok) {
        storeParticipantForGroup(code, participantId, name);
        window.location.href = `/group.html?code=${encodeURIComponent(code)}`;
      } else {
        alert(result.error || 'Erro ao entrar no grupo');
      }
    } catch (err) {
      console.error(err);
      alert('Falha ao entrar no grupo');
    }
  });
})();
