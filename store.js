const fs = require('fs');
const path = require('path');

/*
 * Módulo responsável por gerenciar os grupos e persistir no disco.
 * A estrutura de dados é simples e mantida inteiramente em memória,
 * com gravações periódicas no arquivo data.json. Cada grupo contém
 * uma lista de participantes identificados pelo ID do socket, que
 * armazena seu nome, contagem de fatias e datas de entrada/atualização.
 */

const DATA_PATH = path.join(__dirname, 'data.json');
// Estado em memória; será preenchido ao carregar.
let state = { groups: {} };

// Controla escrita assíncrona para evitar gravações excessivas.
let writeTimer = null;
const WRITE_DEBOUNCE_MS = 250;

/**
 * Lê um JSON de forma segura do disco. Caso haja erro, retorna null.
 * @param {string} filePath Caminho do arquivo
 */
function safeReadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
}

/**
 * Carrega o estado do arquivo data.json ou inicializa se não existir.
 */
function load() {
  const parsed = safeReadJson(DATA_PATH);
  if (parsed && parsed.groups && typeof parsed.groups === 'object') {
    state = parsed;
  } else {
    state = { groups: {} };
    fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2));
  }
}

/**
 * Agenda uma gravação assíncrona do estado atual para o disco.
 */
function scheduleWrite() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    fs.writeFile(DATA_PATH, JSON.stringify(state, null, 2), err => {
      if (err) console.error('Erro ao salvar data.json:', err);
    });
  }, WRITE_DEBOUNCE_MS);
}

/**
 * Retorna a referência do estado interno (somente leitura externa).
 */
function getState() {
  return state;
}

/**
 * Cria um grupo se não existir e retorna o objeto do grupo.
 * @param {string} code Código do grupo
 */
function createGroup(code) {
  if (!state.groups[code]) {
    state.groups[code] = {
      code,
      createdAt: new Date().toISOString(),
      participants: {},
      history: []
    };
    scheduleWrite();
  }
  return state.groups[code];
}

/**
 * Recupera um grupo pelo código.
 * @param {string} code Código do grupo
 */
function getGroup(code) {
  return state.groups[code] || null;
}

/**
 * Cria ou atualiza um participante dentro de um grupo.
 * O participante é identificado pelo ID único do socket.
 * @param {string} code Código do grupo
 * @param {string} participantId Identificador do participante (socket.id)
 * @param {string} name Nome exibido
 */
function upsertParticipant(code, participantId, name) {
  const group = getGroup(code);
  if (!group) return null;
  const cleanName = (name || 'Sem nome').toString().trim().slice(0, 30);
  const now = new Date().toISOString();
  if (!group.participants[participantId]) {
    group.participants[participantId] = {
      id: participantId,
      name: cleanName,
      slices: 0,
      joinedAt: now,
      updatedAt: now
    };
  } else {
    group.participants[participantId].name = cleanName;
    group.participants[participantId].updatedAt = now;
  }
  scheduleWrite();
  return group.participants[participantId];
}

/**
 * Ajusta a contagem de fatias de um participante.
 * @param {string} code Código do grupo
 * @param {string} participantId Identificador do participante
 * @param {number} delta Variação a aplicar (+1 ou -1)
 */
function adjustSlices(code, participantId, delta) {
  const group = getGroup(code);
  if (!group) return null;
  const p = group.participants[participantId];
  if (!p) return null;
  const change = Number(delta);
  if (!Number.isFinite(change)) return null;
  p.slices = Math.max(0, (p.slices || 0) + change);
  p.updatedAt = new Date().toISOString();
  group.history.push({ at: p.updatedAt, participantId, delta: change });
  if (group.history.length > 1000) {
    group.history = group.history.slice(-1000);
  }
  scheduleWrite();
  return p;
}

/**
 * Remove um participante de um grupo quando ele se desconecta.
 * @param {string} code Código do grupo
 * @param {string} participantId Identificador do participante
 */
function removeParticipant(code, participantId) {
  const group = getGroup(code);
  if (!group) return false;
  if (group.participants[participantId]) {
    delete group.participants[participantId];
    scheduleWrite();
  }
  return true;
}

load();

module.exports = {
  getState,
  createGroup,
  getGroup,
  upsertParticipant,
  adjustSlices,
  removeParticipant
};