(() => {
  // Utility: generate or retrieve a persistent participant ID.  We store
  // this identifier in localStorage so that reloading the page or joining
  // multiple groups keeps the same identity.  Browsers that support
  // crypto.randomUUID will produce RFC 4122 UUIDs; otherwise we use a
  // fallback.
  function getParticipantId() {
    const key = 'participantId';
    let id = localStorage.getItem(key);
    if (!id) {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        id = crypto.randomUUID();
      } else {
        // Fallback: simple random string
        id = 'id-' + Math.random().toString(36).substring(2, 10);
      }
      localStorage.setItem(key, id);
    }
    return id;
  }

  const participantId = getParticipantId();
  // Grab elements from the DOM.
  const showCreateBtn = document.getElementById('show-create');
  const showJoinBtn = document.getElementById('show-join');
  const createForm = document.getElementById('create-form');
  const joinForm = document.getElementById('join-form');
  const createNameInput = document.getElementById('create-name');
  const joinCodeInput = document.getElementById('join-code');
  const joinNameInput = document.getElementById('join-name');

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
    try {
      const response = await fetch('/create-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, participantId })
      });
      const result = await response.json();
      if (response.ok && result.code) {
        // Store the name in localStorage to reuse when rejoining.
        localStorage.setItem('participantName', name);
        window.location.href = `/group.html?code=${encodeURIComponent(result.code)}`;
      } else {
        alert(result.error || 'Erro ao criar grupo');
      }
    } catch (err) {
      console.error(err);
      alert('Falha ao criar grupo');
    }
  });

  // Handle joining an existing group.
  joinForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = joinCodeInput.value.trim().toUpperCase();
    const name = joinNameInput.value.trim();
    if (!code || !name) return;
    try {
      const response = await fetch('/join-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, participantId })
      });
      const result = await response.json();
      if (response.ok) {
        localStorage.setItem('participantName', name);
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