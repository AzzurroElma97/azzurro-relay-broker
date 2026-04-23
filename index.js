const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

// Configurazione Socket.io Ultra-Stabile
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  },
  pingInterval: 10000, 
  pingTimeout: 20000,
  allowEIO3: true
});

let serverSocketId = null;
let masterSocket = null;
let lastMasterHeartbeat = Date.now();
let isMaintenanceActive = false; 
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'Azzurro97_Master';

// Monitoraggio costante del Master (Watchdog)
setInterval(() => {
  const now = Date.now();
  const diff = now - lastMasterHeartbeat;
  if (serverSocketId && diff > 90000) {
    console.log(`⚠️ Master inattivo da ${diff}ms. Forzo reset stato.`);
    serverSocketId = null;
    masterSocket = null;
    io.emit('server_status', { online: false });
  }
}, 15000);

io.on('connection', (socket) => {
  console.log(`⚡ Nuova connessione [${socket.id}]`);

  socket.on('identify', (data, callback) => {
    if (data && data.secret === ADMIN_SECRET) {
      serverSocketId = socket.id;
      masterSocket = socket;
      lastMasterHeartbeat = Date.now();
      console.log(`📱 MASTER IDENTIFICATO: ${socket.id}`);
      io.emit('server_status', { online: !isMaintenanceActive });
      if (callback) callback({ success: true, message: 'Autenticato come Master' });
    } else {
      // Normale client web o driver
      console.log(`👤 Client identificato. Master attuale: ${serverSocketId ? '🟢' : '🔴'}`);
      if (callback) callback({ 
        success: true, 
        isServerOnline: (serverSocketId !== null && !isMaintenanceActive),
        debugInfo: { masterConnected: !!serverSocketId, maintenance: isMaintenanceActive }
      });
    }
  });

  socket.on('master_heartbeat', () => {
    // Se il socket che manda l'heartbeat è il master, aggiorna il timestamp
    // Se il serverSocketId è andato perduto (es. riavvio broker) ma il socket è quello del master
    if (!serverSocketId && socket === masterSocket) {
      serverSocketId = socket.id;
      console.log('🔄 Master recuperato tramite heartbeat.');
    }
    
    if (socket.id === serverSocketId) {
      lastMasterHeartbeat = Date.now();
    }
  });

  socket.on('master_shutdown', () => {
    if (socket.id === serverSocketId || socket === masterSocket) {
      console.log('🛑 Master ha richiesto lo spegnimento manuale.');
      serverSocketId = null;
      masterSocket = null;
      io.emit('server_status', { online: false });
    }
  });

  socket.on('client_request', (data, callback) => {
    // Se è un PING di controllo, rispondiamo OK se il Master è nel periodo di grazia (serverSocketId presente)
    if (data.action === 'PING' && serverSocketId) {
      return callback({ success: true, status: 'GRACE_PERIOD', timestamp: Date.now() });
    }

    if (!serverSocketId) {
      console.log('❌ Richiesta client fallita: Master totalmente offline.');
      return callback({ success: false, error: 'OFFLINE', message: 'Il server Master è scollegato.' });
    }
    
    // Se il socket c'è ma è temporaneamente disconnesso, non rifiutiamo subito, 
    // lasciamo che la richiesta vada in timeout o venga processata al rientro.
    const timeout = setTimeout(() => {
      console.log(`⏰ Timeout richiesta client per azione: ${data.action}`);
      callback({ success: false, error: 'TIMEOUT', message: 'Il telefono non ha risposto entro 20 secondi.' });
    }, 20000);

    io.to(serverSocketId).emit('process_request', data, (response) => {
      clearTimeout(timeout);
      callback(response);
    });
  });

  socket.on('broadcast_to_web', (data) => {
    if (socket.id === serverSocketId || socket === masterSocket) {
      io.emit(data.topic, data.payload);
    }
  });

  socket.on('disconnect', (reason) => {
    if (socket.id === serverSocketId || socket === masterSocket) {
      console.log(`🚨 MASTER DISCONNESSO (${reason}). Mantengo ONLINE per 60s per recupero...`);
      const disconnectedId = socket.id;
      
      setTimeout(() => {
        // Se dopo 90s il master non si è ricollegato (quindi serverSocketId è ancora quello vecchio o nullo)
        if (serverSocketId === disconnectedId) {
           console.log('💀 Master non recuperato dopo 90s. Dichiaro OFFLINE.');
           serverSocketId = null;
           masterSocket = null;
           io.emit('server_status', { online: false });
        }
      }, 90000);
    }
  });
});

// Endpoint di Diagnostica per l'utente
app.get('/debug', (req, res) => {
  res.json({
    master_online: !!serverSocketId,
    master_socket_id: serverSocketId,
    last_heartbeat: new Date(lastMasterHeartbeat).toLocaleTimeString(),
    seconds_since_heartbeat: Math.floor((Date.now() - lastMasterHeartbeat) / 1000),
    maintenance_mode: isMaintenanceActive,
    relay_uptime: Math.floor(process.uptime()) + 's',
    env_secret_set: ADMIN_SECRET !== 'Azzurro97_Master' ? 'CUSTOM' : 'DEFAULT'
  });
});

app.get('/ping', (req, res) => { res.json({ status: 'ok' }); });

app.get('/', (req, res) => {
  res.send(`<h1>Azzurro Titanium Relay</h1><p>Master: ${serverSocketId ? '🟢 ONLINE' : '🔴 OFFLINE'}</p><p>Usa <a href="/debug">/debug</a> per info tecniche.</p>`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Relay Broker Titanium pronto sulla porta ${PORT}`);
});
