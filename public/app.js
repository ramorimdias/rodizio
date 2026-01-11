/*
 * Script principal que lida com a lógica do lado do cliente para
 * as diferentes páginas (index, create, join e group). Utiliza
 * Socket.IO somente na página de grupo, onde ocorre a comunicação
 * em tempo real.
 */

// Helper para obter parâmetros da query string
function parseQuery(search) {
  const params = {};
  if (!search) return params;
  const s = search.replace(/^\?/, '');
  s.split('&').forEach(pair => {
    const [key, value] = pair.split('=');
    params[decodeURIComponent(key)] = value === undefined ? '' : decodeURIComponent(value);
  });
  return params;
}

// Debounce auxiliar para evitar múltiplas chamadas rápidas
function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page;
  if (page === 'index') handleIndexPage();
  else if (page === 'create') handleCreatePage();
  else if (page === 'join') handleJoinPage();
  else if (page === 'group') handleGroupPage();
});

function handleIndexPage() {
  const btnCriar = document.getElementById('btn-criar');
  const btnEntrar = document.getElementById('btn-entrar');
  btnCriar.addEventListener('click', () => {
    window.location.href = 'create.html';
  });
  btnEntrar.addEventListener('click', () => {
    window.location.href = 'join.html';
  });
}

function handleCreatePage() {
  const nameInput = document.getElementById('name-input');
  const createBtn = document.getElementById('create-btn');
  const msgEl = document.getElementById('msg');
  createBtn.addEventListener('click', () => {
    const name = (nameInput.value || '').trim();
    if (!name) {
      msgEl.textContent = 'Por favor, insira seu nome.';
      return;
    }
    msgEl.textContent = '';
    // Redireciona para group.html com flag de criação e nome
    const url = `group.html?create=1&name=${encodeURIComponent(name)}`;
    window.location.href = url;
  });
}

function handleJoinPage() {
  const codeInput = document.getElementById('code-input');
  const nameInput = document.getElementById('name-input');
  const joinBtn = document.getElementById('join-btn');
  const msgEl = document.getElementById('msg');
  joinBtn.addEventListener('click', () => {
    const code = (codeInput.value || '').trim().toUpperCase();
    const name = (nameInput.value || '').trim();
    if (!code) {
      msgEl.textContent = 'Por favor, insira o código do grupo.';
      return;
    }
    if (!name) {
      msgEl.textContent = 'Por favor, insira seu nome.';
      return;
    }
    msgEl.textContent = '';
    // Redireciona para group.html com código e nome
    const url = `group.html?code=${encodeURIComponent(code)}&name=${encodeURIComponent(name)}`;
    window.location.href = url;
  });
}

function handleGroupPage() {
  const params = parseQuery(window.location.search);
  const createFlag = params.create === '1' || params.new === '1';
  let groupCodeParam = params.code || null;
  const nameParam = (params.name || '').trim();
  const infoEl = document.getElementById('group-code');
  const copyBtn = document.getElementById('copy-code');
  const msgEl = document.getElementById('msg');
  const listEl = document.getElementById('participants-list');
  listEl.innerHTML = '<li class="placeholder">Conectando ao grupo...</li>';
  if (!createFlag && !groupCodeParam) {
    msgEl.textContent = 'Informações insuficientes. Volte e tente novamente.';
    return;
  }
  if (!nameParam) {
    msgEl.textContent = 'Nome não informado.';
    return;
  }
  // Gera ou recupera ID exclusivo para este dispositivo. Persistido
  // em localStorage para que o participante permaneça o mesmo em
  // recarregamentos e múltiplas abas.
  const localKey = 'pizza_app_id';
  let myId = localStorage.getItem(localKey);
  if (!myId) {
    myId = 'id-' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem(localKey, myId);
  }
  let groupCode = null;
  let pollTimer = null;
  function setGroupCodeUI(code) {
    infoEl.textContent = code;
    if (!copyBtn) return;
    copyBtn.disabled = false;
    copyBtn.onclick = () => {
      const text = code;
      const useClipboardApi = navigator.clipboard
        && navigator.clipboard.writeText
        && window.isSecureContext;
      if (useClipboardApi) {
        navigator.clipboard.writeText(text)
          .then(() => {
            msgEl.textContent = 'Código copiado!';
          })
          .catch(() => {
            fallbackCopy(text);
          });
      } else {
        fallbackCopy(text);
      }
    };
  }
  function fallbackCopy(text) {
    try {
      const temp = document.createElement('input');
      temp.value = text;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      document.body.removeChild(temp);
      msgEl.textContent = 'Código copiado!';
    } catch (_err) {
      msgEl.textContent = 'Não foi possível copiar automaticamente.';
    }
  }
  // Função para entrar no grupo via API
  function joinGroup(code, name) {
    fetch('/join-group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name, participantId: myId })
    }).then(response => response.json())
      .then(data => {
        if (!data.code) {
          msgEl.textContent = data.error || 'Erro ao entrar no grupo.';
          return;
        }
        if (data.participantId && data.participantId !== myId) {
          myId = data.participantId;
          localStorage.setItem(localKey, myId);
        }
        groupCode = data.code;
        // Estabelece conexão SSE
        connectEventStream(groupCode);
        renderParticipants([{ id: myId, name, slices: 0 }]);
      }).catch(err => {
        msgEl.textContent = 'Falha na comunicação com o servidor.';
      });
  }
  // Conecta ao stream SSE para receber atualizações
  let eventSource = null;
  function connectEventStream(code) {
    if (!window.EventSource) {
      startPolling(code);
      return;
    }
    if (eventSource) eventSource.close();
    eventSource = new EventSource(
      `/events?code=${encodeURIComponent(code)}&participantId=${encodeURIComponent(myId)}&name=${encodeURIComponent(nameParam)}`
    );
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    eventSource.onmessage = ev => {
      try {
        const data = JSON.parse(ev.data);
        renderParticipants(data.participants || []);
        msgEl.textContent = '';
      } catch (_err) {
        // ignora erros de parse
      }
    };
    eventSource.onerror = () => {
      // Reconectar automaticamente após algum tempo
      msgEl.textContent = 'Reconectando ao grupo...';
      startPolling(code);
      setTimeout(() => connectEventStream(code), 3000);
    };
  }
  function startPolling(code) {
    if (pollTimer) return;
    const poll = () => {
      fetch(`/group-info?code=${encodeURIComponent(code)}`)
        .then(response => response.json())
        .then(data => {
          renderParticipants(data.participants || []);
        })
        .catch(() => {
          msgEl.textContent = 'Falha ao atualizar o grupo.';
        });
    };
    poll();
    pollTimer = setInterval(poll, 4000);
  }
  // Renderiza lista de participantes com botões de controle para o usuário atual
  function renderParticipants(participants) {
    listEl.innerHTML = '';
    if (!participants.length) {
      const empty = document.createElement('li');
      empty.className = 'placeholder';
      empty.textContent = 'Nenhum participante ainda.';
      listEl.appendChild(empty);
      return;
    }
    participants.forEach(part => {
      const li = document.createElement('li');
      if (part.id === myId) li.classList.add('me');
      const nameSpan = document.createElement('span');
      nameSpan.textContent = part.name;
      const controlsDiv = document.createElement('div');
      controlsDiv.className = 'controls';
      const countSpan = document.createElement('span');
      countSpan.className = 'slice-count';
      countSpan.textContent = part.slices;
      if (part.id === myId) {
        const btnMinus = document.createElement('button');
        btnMinus.className = 'control-btn minus';
        btnMinus.textContent = '-';
        btnMinus.addEventListener('click', () => {
          updateSlices(-1);
        });
        const btnPlus = document.createElement('button');
        btnPlus.className = 'control-btn plus';
        btnPlus.textContent = '+';
        btnPlus.addEventListener('click', () => {
          updateSlices(1);
        });
        controlsDiv.appendChild(btnMinus);
        controlsDiv.appendChild(countSpan);
        controlsDiv.appendChild(btnPlus);
      } else {
        controlsDiv.appendChild(countSpan);
      }
      li.appendChild(nameSpan);
      li.appendChild(controlsDiv);
      listEl.appendChild(li);
    });
  }
  // Envia alteração de fatias para o servidor
  function updateSlices(delta) {
    if (!groupCode) return;
    fetch('/update-slices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: groupCode, participantId: myId, delta })
    }).catch(() => {
      // erro silencioso
    });
  }
  // Antes de sair ou recarregar, remove participante explicitamente
  window.addEventListener('beforeunload', () => {
    if (groupCode) {
      navigator.sendBeacon('/leave-group', JSON.stringify({ code: groupCode, participantId: myId }));
    }
    if (pollTimer) clearInterval(pollTimer);
  });
  // Decide criação ou entrada
  if (createFlag) {
    // Cria grupo
    fetch('/create-group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nameParam, participantId: myId })
    })
      .then(response => response.json())
      .then(data => {
        if (!data.code) {
          msgEl.textContent = data.error || 'Erro ao criar grupo.';
          return;
        }
        groupCode = data.code;
        setGroupCodeUI(groupCode);
        joinGroup(groupCode, nameParam);
      })
      .catch(() => {
        msgEl.textContent = 'Falha na comunicação com o servidor.';
      });
  } else {
    groupCode = (groupCodeParam || '').toString().toUpperCase();
    setGroupCodeUI(groupCode);
    joinGroup(groupCode, nameParam);
  }
}
