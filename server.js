const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss  = new WebSocket.Server({ port: PORT });

const clients  = new Map(); // phone → ws
const msgQueue = new Map(); // phone → [msgs]
const lastSeen = new Map(); // phone → timestamp

console.log(`Server running on port ${PORT}`);

wss.on('connection', (ws) => {
  let myPhone = null;

  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }, 25000);

  ws.on('message', (data, isBinary) => {

    if (isBinary) {
      const header = data.slice(0, 20).toString('utf8').replace(/\0/g,'').trim();
      const target = clients.get(header);
      if (target && target.readyState === WebSocket.OPEN)
        target.send(data, { binary: true });
      return;
    }

    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    switch (msg.type) {

      case 'register':
        myPhone = msg.phone;
        clients.set(myPhone, ws);
        lastSeen.set(myPhone, Date.now());
        ws.send(JSON.stringify({ type: 'registered', phone: myPhone }));
        console.log(`+ ${myPhone} | online: ${clients.size}`);

        // Notify contacts this user is now online
        broadcast(myPhone, { type: 'user_online', phone: myPhone });

        // Deliver queued messages
        if (msgQueue.has(myPhone)) {
          msgQueue.get(myPhone).forEach(m => ws.send(JSON.stringify(m)));
          msgQueue.delete(myPhone);
        }
        break;

      case 'message': {
        const payload = {
          type : 'message',
          from : myPhone,
          text : msg.text,
          time : Date.now(),
          id   : msg.id || Date.now().toString()
        };
        const target = clients.get(msg.to);
        if (target && target.readyState === WebSocket.OPEN) {
          target.send(JSON.stringify(payload));
          ws.send(JSON.stringify({ type: 'ack', id: payload.id }));
        } else {
          enqueue(msg.to, payload);
          ws.send(JSON.stringify({ type: 'queued', id: payload.id }));
        }
        break;
      }

      case 'edit': {
        const target = clients.get(msg.to);
        const payload = { type:'edit', from:myPhone, id:msg.id, text:msg.text };
        if (target && target.readyState === WebSocket.OPEN)
          target.send(JSON.stringify(payload));
        break;
      }

      case 'delete': {
        const target = clients.get(msg.to);
        const payload = { type:'delete', from:myPhone, id:msg.id };
        if (target && target.readyState === WebSocket.OPEN)
          target.send(JSON.stringify(payload));
        break;
      }

      case 'typing': {
        const target = clients.get(msg.to);
        if (target && target.readyState === WebSocket.OPEN)
          target.send(JSON.stringify({ type:'typing', from:myPhone, isTyping:msg.isTyping }));
        break;
      }

      case 'get_status': {
        const online   = clients.has(msg.phone);
        const lastSeenTime = lastSeen.get(msg.phone) || 0;
        ws.send(JSON.stringify({
          type     : 'status',
          phone    : msg.phone,
          online   : online,
          lastSeen : lastSeenTime
        }));
        break;
      }

      case 'file_start': {
        const target = clients.get(msg.to);
        if (target && target.readyState === WebSocket.OPEN)
          target.send(JSON.stringify({
            type:msg.type, from:myPhone,
            fileName:msg.fileName, fileSize:msg.fileSize,
            fileType:msg.fileType, fileId:msg.fileId
          }));
        break;
      }

      case 'file_end': {
        const target = clients.get(msg.to);
        if (target && target.readyState === WebSocket.OPEN)
          target.send(JSON.stringify({ type:'file_end', from:myPhone, fileId:msg.fileId }));
        break;
      }
    }
  });

  ws.on('close', () => {
    clearInterval(pingInterval);
    if (myPhone) {
      lastSeen.set(myPhone, Date.now());
      clients.delete(myPhone);
      broadcast(myPhone, { type:'user_offline', phone:myPhone, lastSeen:Date.now() });
      console.log(`- ${myPhone} | online: ${clients.size}`);
    }
  });

  ws.on('error', e => console.error('err:', e.message));
});

function broadcast(senderPhone, payload) {
  const data = JSON.stringify(payload);
  clients.forEach((ws, phone) => {
    if (phone !== senderPhone && ws.readyState === WebSocket.OPEN)
      ws.send(data);
  });
}

function enqueue(phone, msg) {
  if (!msgQueue.has(phone)) msgQueue.set(phone, []);
  const q = msgQueue.get(phone);
  if (q.length < 50) q.push(msg);
}

setInterval(() => {
  console.log(`Heartbeat | online:${clients.size} queued:${msgQueue.size}`);
}, 14 * 60 * 1000);
