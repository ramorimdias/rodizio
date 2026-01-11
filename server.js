const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const store = require('./store');

/*
 * Servidor HTTP simples com suporte a Server‑Sent Events (SSE) para
 * atualizações em tempo real. Não utiliza dependências externas,
 * permitindo que o app funcione em ambientes restritos sem acesso ao
 * npm. Os endpoints principais são:
 *   POST /create-group      → cria um novo grupo e devolve o código
 *   POST /join-group        → participa de um grupo existente
 *   POST /update-slices     → ajusta as fatias consumidas de um participante
 *   GET  /events            → abre conexão SSE para receber atualizações
 * Arquivos estáticos são servidos da pasta 'public'.
 */

const PORT = process.env.PORT || 3000;

// Mapas de watchers: para cada grupo, uma Map de id -> res (resposta SSE)
const watchers = {};

// MIME types simples para servir arquivos estáticos
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css':  'text/css; charset=UTF-8',
  '.js':   'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon'
};

/**
 * Ordena os participantes de um grupo por fatias (descendente) e data de
 * entrada (ascendente) como critério de desempate.
 */
function getSortedParticipants(group) {
  const list = Object.values(group.participants || {});
  return list.sort((a, b) => {
    const diff = (b.slices || 0) - (a.slices || 0);
    if (diff !== 0) return diff;
    return (a.joinedAt || '').localeCompare(b.joinedAt || '');
  });
}

/**
 * Envia um objeto JSON como resposta.
 */
function sendJson(res, statusCode, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=UTF-8',
    'Content-Length': Buffer.byteLength(data)
  });
  res.end(data);
}

/**
 * Serve arquivos estáticos da pasta public. Se o arquivo não for
 * encontrado, envia erro 404.
 */
function serveStatic(req, res) {
  let reqPath = url.parse(req.url).pathname;
  if (reqPath === '/') reqPath = '/index.html';
  const safePath = path.normalize(reqPath).replace(/^\.+/, '');
  const filePath = path.join(__dirname, 'public', safePath);
  // Evita acesso a diretórios fora de public
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

/**
 * Adiciona um watcher SSE para um participante em determinado grupo.
 * Quando a conexão fecha, remove o participante do grupo e emite
 * atualização para os demais.
 */
function addWatcher(code, id, res) {
  if (!watchers[code]) watchers[code] = new Map();
  watchers[code].set(id, res);
  // Configura headers SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write('\n');
  // Ao fechar a conexão, remove watcher e participante
  res.on('close', () => {
    if (watchers[code]) {
      watchers[code].delete(id);
      if (watchers[code].size === 0) delete watchers[code];
    }
    // Remove o participante do grupo
    store.removeParticipant(code, id);
    broadcastGroupState(code);
  });
}

/**
 * Envia o estado atual de um grupo para todos os watchers ativos.
 */
function broadcastGroupState(code) {
  const group = store.getGroup(code);
  if (!group) return;
  const data = JSON.stringify({ code, participants: getSortedParticipants(group) });
  const line = `event: update\ndata: ${data}\n\n`;
  const groupWatchers = watchers[code];
  if (groupWatchers) {
    for (const [watcherId, res] of groupWatchers.entries()) {
      try {
        res.write(line);
      } catch (e) {
        // Em caso de erro, remove watcher e participante
        groupWatchers.delete(watcherId);
        store.removeParticipant(code, watcherId);
      }
    }
  }
}

/**
 * Gera um código de grupo único de 6 caracteres. Se o código já
 * existir, gera outro.
 */
function generateGroupCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  } while (store.getGroup(code));
  return code;
}

/**
 * Processa solicitações HTTP.
 */
function requestHandler(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  // Endpoint SSE
  if (req.method === 'GET' && pathname === '/events') {
    const code = (parsedUrl.query.code || '').toUpperCase();
    const id = (parsedUrl.query.id || '').trim();
    if (!code || !id) {
      res.writeHead(400); res.end('Missing code or id'); return;
    }
    const group = store.getGroup(code);
    if (!group) {
      res.writeHead(404); res.end('Group not found'); return;
    }
    addWatcher(code, id, res);
    // envia estado inicial
    broadcastGroupState(code);
    return;
  }
  // Cria um grupo
  if (req.method === 'POST' && pathname === '/create-group') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const code = generateGroupCode();
      store.createGroup(code);
      sendJson(res, 200, { ok: true, code });
    });
    return;
  }
  // Participa de um grupo existente
  if (req.method === 'POST' && pathname === '/join-group') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body || '{}'); } catch (e) { parsed = {}; }
      const code = (parsed.code || '').toUpperCase();
      const name = (parsed.name || '').trim();
      const id = (parsed.id || '').trim();
      if (!code || !name || !id) {
        sendJson(res, 400, { ok: false, error: 'Dados incompletos' }); return;
      }
      const group = store.getGroup(code);
      if (!group) {
        sendJson(res, 404, { ok: false, error: 'Grupo não encontrado' }); return;
      }
      store.upsertParticipant(code, id, name);
      sendJson(res, 200, { ok: true, code });
      broadcastGroupState(code);
    });
    return;
  }
  // Atualiza contagem de fatias
  if (req.method === 'POST' && pathname === '/update-slices') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body || '{}'); } catch (e) { parsed = {}; }
      const code = (parsed.code || '').toUpperCase();
      const id = (parsed.id || '').trim();
      const delta = Number(parsed.delta);
      if (!code || !id || !Number.isFinite(delta) || delta === 0) {
        sendJson(res, 400, { ok: false, error: 'Dados inválidos' }); return;
      }
      const updated = store.adjustSlices(code, id, delta);
      if (!updated) {
        sendJson(res, 400, { ok: false, error: 'Participante ou grupo inexistente' }); return;
      }
      sendJson(res, 200, { ok: true });
      broadcastGroupState(code);
    });
    return;
  }
  // Remove participante explicitamente (opcional)
  if (req.method === 'POST' && pathname === '/leave-group') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body || '{}'); } catch (e) { parsed = {}; }
      const code = (parsed.code || '').toUpperCase();
      const id = (parsed.id || '').trim();
      if (!code || !id) {
        sendJson(res, 400, { ok: false, error: 'Dados inválidos' }); return;
      }
      store.removeParticipant(code, id);
      sendJson(res, 200, { ok: true });
      broadcastGroupState(code);
    });
    return;
  }
  // Por padrão, serve arquivos estáticos
  serveStatic(req, res);
}

const server = http.createServer(requestHandler);

server.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});