(() => {
  // Parse the group code from the query string.  If none is present
  // redirect back to the home page.
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) {
    window.location.href = '/';
    return;
  }
  const participantId = localStorage.getItem('participantId');
  const participantName = localStorage.getItem('participantName') || '';
  const groupCodeEl = document.getElementById('group-code');
  const copyBtn = document.getElementById('copy-code');
  const participantsEl = document.getElementById('participants');
  // Show the group code on screen.
  groupCodeEl.textContent = code;
  // Provide a convenient way to copy the code to the clipboard.
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code);
      copyBtn.textContent = 'Copiado!';
      setTimeout(() => (copyBtn.textContent = 'Copiar código'), 2000);
    } catch (err) {
      console.error(err);
      alert('Não foi possível copiar');
    }
  });
  // Establish an SSE (Server‑Sent Events) connection to receive real‑time
  // updates.  The EventSource API automatically reconnects if the
  // connection drops.  We send the group code, participantId and name
  // as query parameters to allow the server to identify this client.
  const sseUrl = `/events?code=${encodeURIComponent(code)}&participantId=${encodeURIComponent(
    participantId
  )}&name=${encodeURIComponent(participantName)}`;
  const evtSource = new EventSource(sseUrl);
  evtSource.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (Array.isArray(msg.participants)) {
        renderParticipants(msg.participants);
      }
    } catch (err) {
      console.error('Erro ao processar evento SSE:', err);
    }
  };
  evtSource.onerror = (err) => {
    console.error('Erro SSE:', err);
  };
  // Send an update message via HTTP.  We call the REST endpoint
  // /update-slices with the delta.  The server ensures the value never
  // goes below zero and broadcasts the updated state via SSE.
  function updateSlices(delta) {
    fetch('/update-slices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, participantId, delta })
    }).catch((err) => console.error(err));
  }
  // Render the list of participants.  Each entry shows the name,
  // slice count and, for the current user, buttons to increment or
  // decrement the count.  We ensure values never go negative by
  // disabling the − button at zero.
  function renderParticipants(participants) {
    participantsEl.innerHTML = '';
    participants.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'participant';
      const info = document.createElement('div');
      info.className = 'info';
      const nameEl = document.createElement('div');
      nameEl.className = 'name';
      nameEl.textContent = p.name;
      const slicesEl = document.createElement('div');
      slicesEl.className = 'slices';
      slicesEl.textContent = `${p.slices} fatias`;
      info.appendChild(nameEl);
      info.appendChild(slicesEl);
      row.appendChild(info);
      // If this is the current participant show controls.
      if (p.id === participantId) {
        const controls = document.createElement('div');
        controls.className = 'controls';
        const minus = document.createElement('button');
        minus.textContent = '−';
        minus.className = 'secondary';
        minus.disabled = p.slices === 0;
        minus.addEventListener('click', () => updateSlices(-1));
        const plus = document.createElement('button');
        plus.textContent = '+';
        plus.className = 'primary';
        plus.addEventListener('click', () => updateSlices(1));
        controls.appendChild(minus);
        controls.appendChild(plus);
        row.appendChild(controls);
      }
      participantsEl.appendChild(row);
    });
  }
})();