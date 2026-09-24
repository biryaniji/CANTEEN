const WebSocket = require('ws');
const url = require('url');

let wss = null;
const clients = new Set(); // Set of { ws, scopes: Set<string> }

function initWebSocket(server) {
  wss = new WebSocket.Server({ server, path: '/realtime' });

  wss.on('connection', (ws, req) => {
    const parsedUrl = url.parse(req.url, true);
    const scopeParam = parsedUrl.query.scope; // e.g. "vendor:cds" or "student:student_kabir" or comma-separated

    const clientInfo = {
      ws,
      scopes: new Set(scopeParam ? scopeParam.split(',').map(s => s.trim()) : ['all'])
    };
    clientInfo.scopes.add('all');

    clients.add(clientInfo);

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'SUBSCRIBE_SCOPE' && data.scope) {
          clientInfo.scopes.add(data.scope);
        }
      } catch (e) {
        // ignore non-json
      }
    });

    ws.on('close', () => {
      clients.delete(clientInfo);
    });

    // Send initial connected ping
    ws.send(JSON.stringify({ type: 'CONNECTED', scopes: Array.from(clientInfo.scopes) }));
  });

  // Heartbeat ping every 30s
  const interval = setInterval(() => {
    for (const client of clients) {
      if (client.ws.isAlive === false) {
        client.ws.terminate();
        clients.delete(client);
        continue;
      }
      client.ws.isAlive = false;
      client.ws.ping();
    }
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });
}

function broadcast(targetScope, eventType, data) {
  if (!wss) return;

  const payload = JSON.stringify({ type: eventType, data, timestamp: new Date().toISOString() });

  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      if (targetScope === 'all' || client.scopes.has('all') || client.scopes.has(targetScope)) {
        client.ws.send(payload);
      }
    }
  }
}

function broadcastToVendor(vendorId, eventType, data) {
  broadcast(`vendor:${vendorId}`, eventType, data);
}

function broadcastToStudent(studentId, eventType, data) {
  broadcast(`student:${studentId}`, eventType, data);
}

function broadcastToAll(eventType, data) {
  broadcast('all', eventType, data);
}

module.exports = {
  initWebSocket,
  broadcastToVendor,
  broadcastToStudent,
  broadcastToAll
};
