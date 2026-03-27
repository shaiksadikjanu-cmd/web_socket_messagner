const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

// Phone number → socket map (our "database")
const clients = new Map();

console.log(`Server running on port ${PORT}`);

wss.on('connection', (ws) => {
  let myPhone = null;

  ws.on('message', (data, isBinary) => {

    // ── Binary = file chunk being relayed ──
    if (isBinary) {
      // First 20 bytes = recipient phone (padded), rest = file chunk
      const header = data.slice(0, 20).toString('utf8').replace(/\0/g, '').trim();
      const chunk  = data.slice(20);
      const target = clients.get(header);
      if (target && target.readyState === WebSocket.OPEN) {
        target.send(data, { binary: true }); // relay raw to recipient
      }
      return;
    }

    // ── Text = JSON control message ──
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', text: 'Invalid JSON' }));
      return;
    }

    switch (msg.type) {

      // Client registers its phone number
      case 'register':
        myPhone = msg.phone;
        clients.set(myPhone, ws);
        ws.send(JSON.stringify({ type: 'registered', phone: myPhone }));
        console.log(`Registered: ${myPhone} | Total online: ${clients.size}`);
        break;

      // Client sends a text message to another phone
      case 'message':
        const target = clients.get(msg.to);
        if (target && target.readyState === WebSocket.OPEN) {
          target.send(JSON.stringify({
            type    : 'message',
            from    : myPhone,
            text    : msg.text,
            time    : Date.now()
          }));
        } else {
          ws.send(JSON.stringify({ type: 'offline', phone: msg.to }));
        }
        break;

      // File transfer start signal
      case 'file_start':
        const tgt = clients.get(msg.to);
        if (tgt && tgt.readyState === WebSocket.OPEN) {
          tgt.send(JSON.stringify({
            type     : 'file_start',
            from     : myPhone,
            fileName : msg.fileName,
            fileSize : msg.fileSize,
            fileType : msg.fileType
          }));
        } else {
          ws.send(JSON.stringify({ type: 'offline', phone: msg.to }));
        }
        break;

      // File transfer done signal
      case 'file_end':
        const t2 = clients.get(msg.to);
        if (t2 && t2.readyState === WebSocket.OPEN) {
          t2.send(JSON.stringify({ type: 'file_end', from: myPhone }));
        }
        break;

      default:
        ws.send(JSON.stringify({ type: 'error', text: 'Unknown type' }));
    }
  });

  // Clean up when client disconnects
  ws.on('close', () => {
    if (myPhone) {
      clients.delete(myPhone);
      console.log(`Disconnected: ${myPhone} | Total online: ${clients.size}`);
    }
  });

  ws.on('error', (err) => console.error('Socket error:', err.message));
});
// Keep Render free tier alive — ping every 14 minutes
setInterval(() => {
  console.log(`Alive | clients online: ${clients.size}`);
}, 14 * 60 * 1000);
