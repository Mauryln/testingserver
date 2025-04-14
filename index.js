const express = require('express');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// Middleware - Habilitar CORS para todos los orígenes (para probar)
app.use(cors({
  origin: '*',  // Esto permite solicitudes desde cualquier origen
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));

app.use(express.json());
app.use(fileUpload());

// Almacenamiento de clientes y QR codes
const clients = {};
const qrCodes = {};

// Rutas y lógica para manejar la sesión
app.post('/start-session', async (req, res) => {
  try {
    const { userId } = req.body;
    if (clients[userId] && clients[userId].isReady) {
      return res.status(400).json({ 
        success: false, 
        error: 'Ya existe una sesión activa para este usuario' 
      });
    }
    if (clients[userId]) {
      await clients[userId].destroy();
      delete clients[userId];
    }
    const client = new Client({
      authStrategy: new LocalAuth({ clientId: userId }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-web-security',
          '--window-size=1280,800',
          '--user-agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"'
        ],
        executablePath: process.env.CHROME_PATH,
        ignoreHTTPSErrors: true,
        defaultViewport: { width: 1280, height: 800 }
      }
    });

    client.on('qr', qr => {
      console.log(`📱 QR Code generado para usuario ${userId}`);
      qrCodes[userId] = qr;
    });

    client.on('ready', () => {
      console.log(`✅ Cliente WhatsApp listo para usuario ${userId}`);
      client.isReady = true;
      delete qrCodes[userId];  // Limpiar QR cuando esté listo
    });

    client.on('auth_failure', msg => {
      console.error(`❌ Fallo de autenticación para usuario ${userId}:`, msg);
    });

    client.on('disconnected', reason => {
      console.warn(`🔌 Cliente desconectado para usuario ${userId}:`, reason);
      client.isReady = false;
    });

    clients[userId] = client;
    client.initialize();

    return res.json({
      success: true,
      message: 'Iniciando sesión, solicita el código QR'
    });
  } catch (error) {
    console.error('❌ Error al iniciar sesión:', error.message);
    return res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

app.get('/get-qr/:userId', (req, res) => {
  const { userId } = req.params;
  if (!clients[userId]) {
    return res.status(404).json({ 
      success: false, 
      error: 'No existe una sesión iniciada para este usuario' 
    });
  }
  if (!qrCodes[userId]) {
    return res.status(202).json({ 
      success: false, 
      message: 'QR code aún no generado o sesión ya autenticada' 
    });
  }
  return res.json({ 
    success: true, 
    qrCode: qrCodes[userId] 
  });
});

app.get('/session-status/:userId', (req, res) => {
  const { userId } = req.params;
  if (!clients[userId]) {
    return res.json({ 
      success: false, 
      status: 'no_session' 
    });
  }
  if (clients[userId].isReady) {
    return res.json({ 
      success: true, 
      status: 'ready' 
    });
  } else if (qrCodes[userId]) {
    return res.json({ 
      success: true, 
      status: 'needs_scan' 
    });
  } else {
    return res.json({ 
      success: true, 
      status: 'initializing' 
    });
  }
});

app.post('/close-session', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!clients[userId]) {
      return res.status(404).json({ 
        success: false, 
        error: 'No existe una sesión para este usuario' 
      });
    }
    try {
      await clients[userId].destroy();
    } catch (err) {
      console.warn(`Advertencia al destruir cliente para ${userId}:`, err.message);
    }
    
    delete clients[userId];
    delete qrCodes[userId];
    res.json({ 
      success: true, 
      message: 'Sesión cerrada correctamente' 
    });
    try {
      const authPath = path.join(__dirname, '.wwebjs_auth', `session-${userId}`);
      setTimeout(() => {
        if (fs.existsSync(authPath)) {
          try {
            fs.rmSync(authPath, { recursive: true, force: true });
            console.log(`🧹 Archivos de autenticación eliminados para usuario ${userId}`);
          } catch (fsError) {
            console.warn(`⚠️ No se pudieron eliminar todos los archivos para ${userId}:`, fsError.message);
          }
        }
      }, 2000);
    } catch (cleanupError) {
      console.error(`❌ Error en limpieza posterior para ${userId}:`, cleanupError);
    }
    
  } catch (error) {
    console.error('❌ Error al cerrar sesión:', error.message);
    return res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

app.post('/send-messages', async (req, res) => {
  try {
    const { userId, delay } = req.body;
    const numbers = JSON.parse(req.body.numbers || '[]');
    const mensajesPorNumero = JSON.parse(req.body.mensajesPorNumero || '[]');
    const results = [];

    if (!clients[userId] || !clients[userId].isReady) {
      return res.status(400).json({ 
        success: false, 
        error: 'No hay una sesión activa para este usuario' 
      });
    }

    if (mensajesPorNumero.length === 0 && !req.files?.media) {
      return res.status(400).json({ success: false, error: 'Mensaje o archivo requerido' });
    }

    if (!Array.isArray(numbers) || numbers.length === 0) {
      return res.status(400).json({ success: false, error: 'No se enviaron números válidos' });
    }

    let media = null;

    if (req.files?.media) {
      const file = req.files.media;
      const filePath = path.join(__dirname, 'temp', file.name);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      await file.mv(filePath);
      const mediaData = fs.readFileSync(filePath, { encoding: 'base64' });
      media = new MessageMedia(file.mimetype, mediaData, file.name);
      fs.unlinkSync(filePath);
    }

    const client = clients[userId];

    for (let i = 0; i < numbers.length; i++) {
      const number = numbers[i];
      const formattedNumber = number.replace(/[^\d]/g, '') + '@c.us';
      const messageIndividual = mensajesPorNumero[i] || '';

      try {
        if (media && messageIndividual) {
          await client.sendMessage(formattedNumber, media, { caption: messageIndividual });
        } else if (media) {
          await client.sendMessage(formattedNumber, media);
        } else {
          await client.sendMessage(formattedNumber, messageIndividual);
        }
        console.log(`📤 Usuario ${userId} envió mensaje a ${number}`);
        results.push({ number, success: true });

      } catch (err) {
        console.error(`❌ Error al enviar a ${number}:`, err.message);
        results.push({ number, success: false, error: err.message });
      }

      await new Promise(resolve => setTimeout(resolve, parseInt(delay)));
    }

    return res.json({
      success: true,
      summary: {
        total: numbers.length,
        enviados: results.filter(r => r.success).length,
        fallidos: results.filter(r => !r.success).length
      },
      results
    });

  } catch (error) {
    console.error('❌ Error interno:', error.message);
    return res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});


app.get('/labels/:userId', async (req, res) => {
  const { userId } = req.params;
  const client = clients[userId];
  if (!client || !client.isReady) {
    return res.status(400).json({ success: false, error: 'Sesión no activa' });
  }
  try {
    const labels = await client.getLabels();
    return res.json({ success: true, labels });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/labels/:userId/:labelId/chats', async (req, res) => {
  const { userId, labelId } = req.params;
  const client = clients[userId];
  if (!client || !client.isReady) {
    return res.status(400).json({ success: false, error: 'Sesión no activa' });
  }
  try {
    const chats = await client.getChatsByLabelId(labelId);
    const numbers = chats.map(chat => chat.id.user);
    return res.json({ success: true, numbers });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/reports/:userId/:labelId/messages', async (req, res) => {
  const { userId, labelId } = req.params;
  const client = clients[userId];

  if (!client || !client.isReady) {
    return res.status(400).json({ success: false, error: 'Sesión no activa' });
  }

  try {
    const chats = await client.getChatsByLabelId(labelId);
    const reportData = [];

    for (const chat of chats) {
      const messages = await chat.fetchMessages({ limit: 50 });
      const sentMessages = messages.filter(msg => msg.fromMe); 
      for (const msg of sentMessages) {
        let respuesta = messages.find(m => !m.fromMe && m.timestamp > msg.timestamp);
        reportData.push({
          number: chat.id.user,
          body: msg.body,
          timestamp: msg.timestamp,
          ack: msg.ack,
          readTimestamp: msg.readTimestamp || null,
          response: respuesta ? respuesta.body : null,
          responseTimestamp: respuesta ? respuesta.timestamp : null
        });
      }
    }
    return res.json({ success: true, messages: reportData });
  } catch (err) {
    console.error("❌ Error al obtener mensajes:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});



app.listen(port, () => {
  console.log(`Servidor escuchando en el puerto ${port}`);
});
