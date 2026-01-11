const http = require('http');
const fs = require('fs');
const path = require('path');

// Path to persistent data file.  Data survive across restarts.
const DATA_FILE = path.join(__dirname, 'data.json');

// Load data from disk or start fresh.
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error('Erro ao carregar data.json:', err);
  }
  return { groups: {} };
}

// Save current data to disk.  We write synchronously for simplicity.
function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Erro ao salvar data.json:', err);
  }
}

// Generate a random 6‑character code using unambiguous characters.
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function generateParticipantId() {
  return `id-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeName(value) {
  return (value || '').trim().toLowerCase();
}

function findParticipantByName(group, name) {
  const target = normalizeName(name);
  if (!target) return null;
  return Object.values(group.participants || {}).find(
    (participant) => normalizeName(participant.name) === target
  );
}

function buildParticipantsList(group) {
  return Object.values(group.participants || {})
    .sort((a, b) => b.slices - a.slices)
    .map((participant) => ({
      id: participant.id,
      name: participant.name,
      slices: participant.slices
    }));
}

// In‑memory data store and SSE connections.
const data = loadData();
// Map of group code -> Set of SSE connections (response objects).
const sseConnections = {};

// Determine MIME type based on file extension.  Minimal list.
const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const validFoodTypes = new Set(['pizza', 'japones', 'hamburger', 'pastel', 'churrasco']);

/**
 * Send the current state of a group via SSE to all connected clients.
 * Builds a sorted list of participants (descending by slices) and writes
 * it as JSON to each connection.  The SSE event name defaults to
 * "message" when unspecified.
 */
function broadcastGroupState(code) {
  const group = data.groups[code];
  if (!group) return;
  const participants = buildParticipantsList(group);
  const payload = JSON.stringify({
    participants,
    foodType: group.foodType || 'pizza'
  });
  (sseConnections[code] || []).forEach((res) => {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch (err) {
      // Ignore errors; the connection will be cleaned up on close.
    }
  });
}

/**
 * Remove an SSE connection from the registry when a client disconnects.
 */
function removeSseConnection(code, res, participantId) {
  const set = sseConnections[code];
  if (set) {
    const idx = set.indexOf(res);
    if (idx >= 0) set.splice(idx, 1);
    if (set.length === 0) delete sseConnections[code];
  }
}

/**
 * Handle HTTP POST requests.  We parse the incoming body as JSON and
 * route to the appropriate endpoint: /create-group, /join-group or
 * /update-slices.  Each handler updates the data store and triggers
 * broadcasts when necessary.  Returns a JSON response.
 */
function handlePost(req, res) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    // Limit body size to avoid abuse.
    if (body.length > 1e6) req.connection.destroy();
  });
  req.on('end', () => {
    let payload;
    try {
      payload = body ? JSON.parse(body) : {};
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }
    const now = new Date().toISOString();
    if (req.url === '/create-group') {
      const { name, participantId } = payload || {};
      if (!name || !participantId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'name and participantId are required' }));
        return;
      }
      const foodType = validFoodTypes.has(payload.foodType)
        ? payload.foodType
        : 'pizza';
      let code;
      do {
        code = generateCode();
      } while (data.groups[code]);
      data.groups[code] = {
        code,
        foodType,
        createdAt: now,
        participants: {
          [participantId]: {
            id: participantId,
            name,
            slices: 0,
            joinedAt: now,
            updatedAt: now
          }
        }
      };
      saveData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code }));
      return;
    }
    if (req.url === '/join-group') {
      const { code, name, participantId } = payload || {};
      if (!code || !name) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'code and name are required' }));
        return;
      }
      const group = data.groups[code];
      if (!group) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'group not found' }));
        return;
      }
      const matchedByName = findParticipantByName(group, name);
      let resolvedParticipantId = participantId || '';
      let participant = null;
      if (matchedByName) {
        resolvedParticipantId = matchedByName.id;
        participant = matchedByName;
      } else if (resolvedParticipantId) {
        participant = group.participants[resolvedParticipantId];
      }
      if (participant) {
        if (normalizeName(participant.name) === normalizeName(name)) {
          if (participant.name !== name) {
            participant.name = name;
          }
          participant.updatedAt = now;
        } else {
          resolvedParticipantId = '';
          participant = null;
        }
      }
      if (!participant) {
        if (!resolvedParticipantId) {
          resolvedParticipantId = generateParticipantId();
        }
        group.participants[resolvedParticipantId] = {
          id: resolvedParticipantId,
          name,
          slices: 0,
          joinedAt: now,
          updatedAt: now
        };
        participant = group.participants[resolvedParticipantId];
      }
      saveData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          code,
          foodType: group.foodType || 'pizza',
          participantId: resolvedParticipantId,
          participant: participant
            ? { id: participant.id, name: participant.name, slices: participant.slices }
            : null,
          participants: buildParticipantsList(group)
        })
      );
      broadcastGroupState(code);
      return;
    }
    if (req.url === '/update-slices') {
      const { code, participantId, delta } = payload || {};
      if (!code || !participantId || typeof delta !== 'number') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'code, participantId and numeric delta are required' }));
        return;
      }
      const group = data.groups[code];
      if (!group) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'group not found' }));
        return;
      }
      const participant = group.participants[participantId];
      if (!participant) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'participant not found' }));
        return;
      }
      participant.slices = Math.max(0, participant.slices + delta);
      participant.updatedAt = now;
      saveData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      broadcastGroupState(code);
      return;
    }
    // Unknown endpoint.
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });
}

/**
 * Serve static files from the "public" directory.  If the file does not
 * exist respond with a 404.  The default route `/` serves index.html.
 */
function serveStatic(req, res) {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  let filePath = urlObj.pathname;
  if (filePath === '/') filePath = '/index.html';
  // Prevent directory traversal.
  const safePath = path.normalize(filePath).replace(/^\/|(?:\.\.)/g, '');
  const fullPath = path.join(__dirname, 'public', safePath);
  fs.readFile(fullPath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(fullPath);
    const mimeType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mimeType });
    res.end(content);
  });
}

/**
 * Handle SSE connections.  Clients request `/events` with query
 * parameters code and participantId (and optionally name).  We add
 * the participant to the group if necessary, register the SSE
 * connection and send the initial state.  When the client
 * disconnects we remove them and broadcast the updated state.
 */
function handleSse(req, res) {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const code = urlObj.searchParams.get('code');
  const participantId = urlObj.searchParams.get('participantId');
  const name = urlObj.searchParams.get('name');
  if (!code || !participantId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'code and participantId are required' }));
    return;
  }
  const group = data.groups[code];
  if (!group) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'group not found' }));
    return;
  }
  const now = new Date().toISOString();
  const participant = group.participants[participantId];
  if (participant) {
    if (name && normalizeName(participant.name) === normalizeName(name)) {
      if (participant.name !== name) {
        participant.name = name;
        participant.updatedAt = now;
        saveData();
      }
    }
  } else {
    group.participants[participantId] = {
      id: participantId,
      name: name || 'Anônimo',
      slices: 0,
      joinedAt: now,
      updatedAt: now
    };
    saveData();
  }
  // Set up SSE headers.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    // CORS: allow connections from same origin.  Remove or adjust as needed.
    'Access-Control-Allow-Origin': '*'
  });
  res.write('\n');
  // Register connection.
  sseConnections[code] = sseConnections[code] || [];
  sseConnections[code].push(res);
  // Send initial state.
  broadcastGroupState(code);
  // When client disconnects, clean up.
  req.on('close', () => {
    removeSseConnection(code, res, participantId);
  });
}

/**
 * Return a list of participants for a given group code so the client can
 * let users rejoin an existing participant.
 */
function handleGroupInfo(req, res) {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const code = urlObj.searchParams.get('code');
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'code is required' }));
    return;
  }
  const group = data.groups[code];
  if (!group) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'group not found' }));
    return;
  }
  const participants = Object.values(group.participants || {})
    .map((participant) => ({
      id: participant.id,
      name: participant.name,
      slices: participant.slices
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ participants, foodType: group.foodType || 'pizza' }));
}

// Create and start the HTTP server.
const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    handlePost(req, res);
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/group-info')) {
    handleGroupInfo(req, res);
    return;
  }
  // SSE endpoint: /events
  if (req.method === 'GET' && req.url.startsWith('/events')) {
    handleSse(req, res);
    return;
  }
  // Serve static assets for GET requests.
  if (req.method === 'GET') {
    serveStatic(req, res);
    return;
  }
  res.writeHead(405, { 'Content-Type': 'text/plain' });
  res.end('Method Not Allowed');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});
