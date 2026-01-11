(() => {
  // Parse the group code from the query string. If none is present, redirect.
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) {
    window.location.href = '/';
    return;
  }

  // Ensure we have a stable participantId across reloads.
  const participantIdKey = `participantId:${code}`;
  const participantNameKey = `participantName:${code}`;
  let participantId = localStorage.getItem(participantIdKey);
  if (!participantId) {
    participantId =
      localStorage.getItem('participantId') ||
      crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem('participantId', participantId);
    localStorage.setItem(participantIdKey, participantId);
  }

  // Ensure we have a name (optional but helps SSE / display).
  const storedName = localStorage.getItem(participantNameKey);
  let participantName =
    storedName ||
    localStorage.getItem('participantName') ||
    '';
  if (participantName && !storedName) {
    localStorage.setItem(participantNameKey, participantName);
  }
  if (!participantName) {
    localStorage.setItem(participantNameKey, participantName);
    participantName = 'Anônimo';
    localStorage.setItem('participantName', participantName);
  }

  const groupCodeEl = document.getElementById('group-code');
  const copyBtn = document.getElementById('copy-code');
  const participantsEl = document.getElementById('participants');
  let currentFoodType = 'pizza';

  // Show the group code on screen.
  groupCodeEl.textContent = code;

  // Copy code button
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

  function setFoodIcon(foodType) {
    const icon = document.getElementById('food-icon');
    if (!icon) return;
    if (foodType === 'japones') {
      icon.src = 'uramaki.png';
      icon.alt = 'Japonês';
    } else {
      icon.src = 'pizza.png';
      icon.alt = 'Pizza';
    }
  }

  setFoodIcon(currentFoodType);

  // SSE connection
  const sseUrl = `/events?code=${encodeURIComponent(code)}&participantId=${encodeURIComponent(
    participantId
  )}&name=${encodeURIComponent(participantName)}`;

  const evtSource = new EventSource(sseUrl);

  function getSliceLabel(foodType, count) {
    const unit = foodType === 'japones' ? 'peça' : 'fatia';
    return count === 1 ? unit : `${unit}s`;
  }

  evtSource.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (Array.isArray(msg.participants)) {
        if (msg.foodType) {
          currentFoodType = msg.foodType;
          setFoodIcon(currentFoodType);
        }
        renderParticipants(msg.participants);
      }
    } catch (err) {
      console.error('Erro ao processar evento SSE:', err);
    }
  };

  evtSource.onerror = (err) => {
    console.error('Erro SSE:', err);
  };

  function updateSlices(delta) {
    fetch('/update-slices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, participantId, delta })
    }).catch((err) => console.error(err));
  }

  function renderParticipants(participants) {
    participantsEl.innerHTML = '';
    const maxSlices = Math.max(0, ...participants.map((p) => p.slices || 0));
    let crownAssigned = false;
    participants.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'participant';
      const isLeader = maxSlices > 0 && p.slices === maxSlices;
      if (isLeader) {
        row.classList.add('leader');
      }

      const info = document.createElement('div');
      info.className = 'info';

      const nameEl = document.createElement('div');
      nameEl.className = 'name';
      if (isLeader && !crownAssigned) {
        nameEl.textContent = `👑 ${p.name}`;
        crownAssigned = true;
      } else {
        nameEl.textContent = p.name;
      }

      const slicesEl = document.createElement('div');
      slicesEl.className = 'slices';
      slicesEl.innerHTML = `<span class="count">${p.slices}</span> ${getSliceLabel(
        currentFoodType,
        p.slices
      )}`;

      info.appendChild(nameEl);
      info.appendChild(slicesEl);
      row.appendChild(info);

      // Only the current user can change their own count
      if (p.id === participantId) {
        const controls = document.createElement('div');
        controls.className = 'controls';

        const minus = document.createElement('button');
        minus.textContent = '-';
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
