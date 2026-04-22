const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

// Configurazione Socket.io ottimizzata per stabilità estrema e recupero sessione
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  },
  connectionStateRecovery: {
    // max 2 minuti di buffer per messaggi persi durante sbalzi di segnale
    maxDisconnectionDuration: 2 * 60 * 1000,
    // mantiene lo stato dei socket
    skipMiddlewares: true,
  },
  pingInterval: 5000, 
  pingTimeout: 10000,  
  allowEIO3: true
});

let serverSocketId = null;
let lastMasterHeartbeat = Date.now();
let isMaintenanceActive = false; 
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'Azzurro97_Master';

// Monitoraggio costante del Master
setInterval(() => {
  if (serverSocketId && (Date.now() - lastMasterHeartbeat > 25000)) {
    console.log('⚠️ Master non risponde da 25s, forzo offline.');
    serverSocketId = null;
    io.emit('server_status', { online: false });
  }
}, 10000);

io.on('connection', (socket) => {
  console.log('⚡ Connessione:', socket.id);

  socket.on('identify', (data, callback) => {
    if (data && data.secret === ADMIN_SECRET) {
      serverSocketId = socket.id;
      lastMasterHeartbeat = Date.now();
      console.log('📱 Master Android CONNESSO:', socket.id);
      io.emit('server_status', { online: !isMaintenanceActive });
      if (callback) callback({ success: true, message: 'Autenticato' });
    } else {
      if (callback) callback({ success: true, isServerOnline: (serverSocketId !== null && !isMaintenanceActive) });
    }
  });

  // Ricezione battito cardiaco dal Master
  socket.on('master_heartbeat', () => {
    if (socket.id === serverSocketId) {
      lastMasterHeartbeat = Date.now();
    }
  });

  // SPEGNIMENTO MANUALE: Il Master avvisa che sta chiudendo apposta
  socket.on('master_shutdown', () => {
    if (socket.id === serverSocketId) {
      console.log('🛑 Master spento manualmente dall\'utente.');
      serverSocketId = null;
      io.emit('server_status', { online: false });
    }
  });

  socket.on('client_request', (data, callback) => {
    if (!serverSocketId) {
      return callback({ error: 'OFFLINE', message: 'Il server Master è scollegato.' });
    }
    
    // Timeout di sicurezza per le richieste al Master
    const timeout = setTimeout(() => {
      callback({ success: false, error: 'TIMEOUT', message: 'Il telefono non ha risposto in tempo.' });
    }, 15000);

    io.to(serverSocketId).emit('process_request', data, (response) => {
      clearTimeout(timeout);
      callback(response);
    });
  });

  socket.on('broadcast_to_web', (data) => {
    if (socket.id === serverSocketId) {
      io.emit(data.topic, data.payload);
    }
  });

  socket.on('disconnect', (reason) => {
    if (socket.id === serverSocketId) {
      console.log(`🚨 Master Disconnesso accidentalmente (${reason}). Mantengo ONLINE per 60s...`);
      // Manteniamo ONLINE per 1 minuto intero per dare tempo al telefono di rientrare (es: galleria o cambio cella)
      const currentId = socket.id;
      setTimeout(() => {
        if (serverSocketId === currentId) {
           console.log('💀 Master non rientrato dopo 60s. Dichiaro OFFLINE.');
           serverSocketId = null;
           io.emit('server_status', { online: false });
        }
      }, 60000); 
    }
  });
});

app.get('/ping', (req, res) => {
  res.json({ 
    status: 'ok', 
    master: serverSocketId ? 'online' : 'offline',
    maintenance: isMaintenanceActive,
    uptime: process.uptime()
  });
});

app.get('/', (req, res) => {
  res.send(`Azzurro Relay attivo. Master: ${serverSocketId ? '🟢' : '🔴'}`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Relay Broker Titanium pronto sulla porta ${PORT}`);
});
