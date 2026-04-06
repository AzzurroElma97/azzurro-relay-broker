const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", // allow web app from anywhere (Vercel)
    methods: ["GET", "POST"]
  }
});

// The socket ID of the single Android Master Phone
let serverSocketId = null;
let isMaintenanceActive = false; // Flag globale per il Kill Switch
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'Azzurro97_Master';

io.on('connection', (socket) => {
  console.log('⚡ Nuova connessione rilevata:', socket.id);

  // 1. Identificazione
  socket.on('identify', (data, callback) => {
    if (data && data.secret === ADMIN_SECRET) {
      // È IL TELEFONO ANDROID!
      serverSocketId = socket.id;
      console.log('📱 Server Android Master CONNESSO:', socket.id);
      
      // Avvisa tutti i siti web/client che il sistema è operativo (se non in manutenzione)
      io.emit('server_status', { online: !isMaintenanceActive });
      if (callback) callback({ success: true, message: 'Autenticato come Android Master' });
    } else {
      // È un normale cliente web
      console.log('👤 Web Client connesso:', socket.id);
      // Comunica subito lo stato al cliente
      if (callback) callback({ success: true, isServerOnline: (serverSocketId !== null && !isMaintenanceActive) });
    }
  });

  // Comando speciale dall'Admin
  socket.on('admin_toggle_maintenance', (data) => {
      isMaintenanceActive = data.active;
      console.log(`📡 STATO MANUTENZIONE CAMBIATO: ${isMaintenanceActive}`);
      io.emit('server_status', { online: (serverSocketId !== null && !isMaintenanceActive) });
  });

  // 2. Il Web Client fa una richiesta (es: cerca preventivo)
  socket.on('client_request', (data, callback) => {
    if (!serverSocketId) {
      // Se il telefono è spento, blocca tutto con manutenzione
      return callback({ 
        error: 'MAINTENANCE_MODE', 
        message: 'Il server centrale è attualmente scollegato (Manutenzione).' 
      });
    }

    // Inoltra la richiesta dal Web al Telefono e aspetta la risposta
    io.to(serverSocketId).emit('process_request', data, (response) => {
      // Una volta che il telefono calcola, rimandiamo la risposta al Web
      callback(response);
    });
  });

  // 3. Il Master Server (Android) invia Notifiche Push a tutti o a uno specifico Web Client
  socket.on('broadcast_to_web', (data) => {
      if (socket.id === serverSocketId) {
          console.log(`📡 Broadcast dal Master [${data.topic}]:`, data.payload);
          io.emit(data.topic, data.payload);
      }
  });

  // 4. Disconnessione
  socket.on('disconnect', () => {
    console.log('❌ Disconnesso:', socket.id);
    if (socket.id === serverSocketId) {
      console.log('🚨 Server Android Master DISCONNESSO! Tutto in Manutenzione.');
      serverSocketId = null;
      // Avvisa tutti i web client di bloccare i bottoni
      io.emit('server_status', { online: false });
    }
  });
});

app.get('/', (req, res) => {
  res.send(`Ponte Relay in funzione. Stato Server Principale: ${serverSocketId ? '🟢 ONLINE' : '🔴 OFFLINE (Manutenzione)'}`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Relay Broker in esecuzione sulla porta ${PORT}`);
});
