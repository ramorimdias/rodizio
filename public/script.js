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

  async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
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
    const foodType =
      document.querySelector('input[name="food-type"]:checked')?.value || 'pizza';
    const participantId = generateParticipantId();
    try {
      const response = await fetch('/create-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, participantId, foodType })
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
      const response = await fetchWithTimeout(
        `/group-info?code=${encodeURIComponent(code)}`
      );
      const result = await response.json();
      if (!response.ok) {
        return {
          code,
          participants: [],
          errorMessage: result.error || 'Erro ao buscar participantes.',
          foodType: result.foodType || 'pizza'
        };
      }
      return { code, participants: result.participants || [], foodType: result.foodType || 'pizza' };
    } catch (err) {
      console.error(err);
      const errorMessage =
        err && err.name === 'AbortError'
          ? 'Tempo esgotado ao buscar participantes.'
          : 'Falha ao buscar participantes.';
      return {
        code,
        participants: [],
        errorMessage,
        foodType: 'pizza'
      };
    }
  }

  const foodLabels = {
    pizza: { unit: 'fatia', plural: 'fatias' },
    japones: { unit: 'peça', plural: 'peças' },
    hamburger: { unit: 'porção', plural: 'porções' },
    pastel: { unit: 'porção', plural: 'porções' },
    churrasco: { unit: 'porção', plural: 'porções' }
  };

  function getSliceLabel(foodType, count) {
    const config = foodLabels[foodType] || foodLabels.pizza;
    return count === 1 ? config.unit : config.plural;
  }

  function renderParticipantsList(participants, foodType = 'pizza') {
    if (!joinExistingSelect) return;
    joinExistingSelect.innerHTML = '';
    participants.forEach((participant) => {
      const option = document.createElement('option');
      option.value = participant.id;
      option.textContent = `${participant.name} (${participant.slices} ${getSliceLabel(
        foodType,
        participant.slices
      )})`;
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
    setJoinFeedback('Carregando participantes...');
    loadParticipantsBtn.disabled = true;
    const result = await loadParticipants();
    loadParticipantsBtn.disabled = false;
    if (!result) {
      return;
    }
    joinOptions?.classList.remove('hidden');
    setJoinMode(document.querySelector('input[name="join-mode"]:checked')?.value || 'new');
    renderParticipantsList(result.participants, result.foodType);
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
    const name = joinNameInput.value.trim();
    if (!code) return;
    if (joinOptions?.classList.contains('hidden')) {
      setJoinFeedback('Carregando participantes...');
      const result = await loadParticipants();
      if (!result) return;
      renderParticipantsList(result.participants, result.foodType);
      joinOptions.classList.remove('hidden');
      setJoinMode(document.querySelector('input[name="join-mode"]:checked')?.value || 'new');
      setJoinFeedback(result.errorMessage || '');
      return;
    }
    if (!name) {
      setJoinFeedback('Por favor, insira o seu nome.');
      return;
    }
    setJoinFeedback('');
    try {
      // Determine if the user chose to join as a new participant or rejoin
      // an existing one.  When the "existing" mode is selected we honour
      // the selected participant from the drop‑down and send its ID and
      // stored name to the server.  Otherwise we perform name‑based
      // matching as before.
      const mode = document.querySelector('input[name="join-mode"]:checked')?.value || 'new';
      let body;
      let finalId;
      let finalName;
      if (mode === 'existing' && joinExistingSelect && joinExistingSelect.value) {
        // The user selected an existing participant to rejoin.  Use its
        // ID from the option value and the name from the dataset.  This
        // bypasses the name entry and ensures the correct identity is
        // resumed.
        const selectedId = joinExistingSelect.value;
        const selectedName =
          joinExistingSelect.options[joinExistingSelect.selectedIndex].dataset.name || name;
        body = { code, name: selectedName, participantId: selectedId };
        const response = await fetch('/join-group', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const result = await response.json();
        if (response.ok) {
          finalId = result.participantId || selectedId;
          finalName = (result.participant && result.participant.name) || selectedName;
          storeParticipantForGroup(code, finalId, finalName);
          window.location.href = `/group.html?code=${encodeURIComponent(code)}`;
        } else {
          setJoinFeedback(result.error || 'Erro ao entrar no grupo');
        }
      } else {
        // User is joining as a new participant.  Check if we have a stored
        // identity for this group and only reuse it if the name matches.
        let storedId = localStorage.getItem(`participantId:${code}`);
        let storedName = localStorage.getItem(`participantName:${code}`);
        let participantIdToSend = null;
        if (
          storedId &&
          storedName &&
          storedName.trim().toLowerCase() === name.trim().toLowerCase()
        ) {
          participantIdToSend = storedId;
        } else {
          // Names do not match or no stored participant: remove old keys so
          // a fresh identity will be generated
          localStorage.removeItem(`participantId:${code}`);
          localStorage.removeItem(`participantName:${code}`);
          // Also clear global keys to avoid accidentally reusing them across
          // different groups
          localStorage.removeItem('participantId');
          localStorage.removeItem('participantName');
        }
        body = { code, name };
        if (participantIdToSend) {
          body.participantId = participantIdToSend;
        }
        const response = await fetch('/join-group', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const result = await response.json();
        if (response.ok) {
          finalId = result.participantId || participantIdToSend || generateParticipantId();
          finalName =
            (result.participant && result.participant.name) || name;
          storeParticipantForGroup(code, finalId, finalName);
          window.location.href = `/group.html?code=${encodeURIComponent(code)}`;
        } else {
          setJoinFeedback(result.error || 'Erro ao entrar no grupo');
        }
      }
    } catch (err) {
      console.error(err);
      setJoinFeedback('Falha ao entrar no grupo');
    }
  });
})();