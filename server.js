const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

const clients = new Map();      // phone → ws
const msgQueue = new Map();     // phone → [pending messages]

console.log(`Server running on port ${PORT}`);

wss.on('connection', (ws) => {
  let myPhone = null;

  // Ping client every 25s to keep connection alive
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }, 25000);

  ws.on('message', (data, isBinary) => {

    if (isBinary) {
      const header = data.slice(0, 20).toString('utf8').replace(/\0/g, '').trim();
      const target = clients.get(header);
      if (target && target.readyState === WebSocket.OPEN) {
        target.send(data, { binary: true });
      }
      return;
    }

    let msg;
    try { msg = JSON.parse(data.toString()); }
    catch { return; }

    switch (msg.type) {

      case 'register':
        myPhone = msg.phone;
        clients.set(myPhone, ws);
        ws.send(JSON.stringify({ type: 'registered', phone: myPhone }));
        console.log(`+ Registered: ${myPhone} | Online: ${clients.size}`);

        // Deliver any queued messages
        if (msgQueue.has(myPhone)) {
          const pending = msgQueue.get(myPhone);
          pending.forEach(m => ws.send(JSON.stringify(m)));
          msgQueue.delete(myPhone);
          console.log(`  Delivered ${pending.length} queued msgs to ${myPhone}`);
        }
        break;

      case 'message':
        const target = clients.get(msg.to);
        const payload = {
          type: 'message',
          from: myPhone,
          text: msg.text,
          time: Date.now(),
          id  : msg.id || Date.now().toString()
        };
        if (target && target.readyState === WebSocket.OPEN) {
          target.send(JSON.stringify(payload));
          // Ack sender
          ws.send(JSON.stringify({ type: 'ack', id: payload.id }));
        } else {
          // Queue for later delivery (max 50 msgs per user)
          if (!msgQueue.has(msg.to)) msgQueue.set(msg.to, []);
          const q = msgQueue.get(msg.to);
          if (q.length < 50) q.push(payload);
          ws.send(JSON.stringify({ type: 'queued', id: payload.id }));
        }
        break;

      case 'file_start':
        const ft = clients.get(msg.to);
        if (ft && ft.readyState === WebSocket.OPEN) {
          ft.send(JSON.stringify({
            type: 'file_start', from: myPhone,
            fileName: msg.fileName, fileSize: msg.fileSize, fileType: msg.fileType
          }));
        }
        break;

      case 'file_end':
        const fe = clients.get(msg.to);
        if (fe && fe.readyState === WebSocket.OPEN) {
          fe.send(JSON.stringify({ type: 'file_end', from: myPhone }));
        }
        break;
    }
  });

  ws.on('close', () => {
    clearInterval(pingInterval);
    if (myPhone) {
      clients.delete(myPhone);
      console.log(`- Disconnected: ${myPhone} | Online: ${clients.size}`);
    }
  });

  ws.on('error', (err) => console.error('Error:', err.message));
});

// Keep Render alive log every 14 min
setInterval(() => {
  console.log(`Heartbeat | Online: ${clients.size} | Queued for: ${msgQueue.size} users`);
}, 14 * 60 * 1000);
