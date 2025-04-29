const express = require('express');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// Limpiar archivos de autenticación al iniciar
const authDir = path.join(__dirname, '.wwebjs_auth');
if (fs.existsSync(authDir)) {
  try {
    fs.rmSync(authDir, { recursive: true, force: true });
    console.log('🧹 Archivos de autenticación anteriores eliminados');
  } catch (error) {
    console.error('❌ Error al limpiar archivos de autenticación:', error);
  }
}

// Middleware - Configuración CORS
app.use(cors({
  origin: ['chrome-extension://dnblhcngpajdonchphgokjgcgapocjld', 'http://localhost:3000'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Cache-Control', 'Pragma'],
  credentials: true
}));

app.use(express.json());
app.use(fileUpload());

// Almacenamiento de clientes y QR codes
const clients = {};
const qrCodes = {};

// Ruta para iniciar una nueva sesión
app.post('/start-session', async (req, res) => {
  try {
    const { userId } = req.body;
    
    // Validar si ya existe una sesión para este usuario
    if (clients[userId] && clients[userId].isReady) {
      return res.status(400).json({ 
        success: false, 
        error: 'Ya existe una sesión activa para este usuario' 
      });
    }

    // Si hay un cliente previo, lo destruimos y limpiamos
    if (clients[userId]) {
      try {
        await clients[userId].destroy();
      } catch (err) {
        console.warn(`Advertencia al destruir cliente previo para ${userId}:`, err.message);
      } finally {
        delete clients[userId];
        delete qrCodes[userId];
        // Limpiar archivos de autenticación
        const authPath = path.join(__dirname, '.wwebjs_auth', `session-${userId}`);
        if (fs.existsSync(authPath)) {
          try {
            fs.rmSync(authPath, { recursive: true, force: true });
            console.log(`🧹 Archivos de autenticación eliminados para usuario ${userId}`);
          } catch (fsError) {
            console.warn(`⚠️ No se pudieron eliminar todos los archivos para ${userId}:`, fsError.message);
          }
        }
      }
    }

    // Crear nuevo cliente
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
        defaultViewport: {width: 1280, height: 800}
      }
    });

    // Configurar eventos
    client.on('qr', qr => {
      console.log(`📱 QR Code generado para usuario ${userId}`);
      qrCodes[userId] = qr;
    });

    client.on('ready', () => {
      console.log(`✅ Cliente WhatsApp listo para usuario ${userId}`);
      client.isReady = true;
      // Limpiamos el QR code cuando ya está autenticado
      delete qrCodes[userId];
    });

    client.on('auth_failure', msg => {
      console.error(`❌ Fallo de autenticación para usuario ${userId}:`, msg);
      // Limpiar archivos de autenticación en caso de fallo
      const authPath = path.join(__dirname, '.wwebjs_auth', `session-${userId}`);
      if (fs.existsSync(authPath)) {
        try {
          fs.rmSync(authPath, { recursive: true, force: true });
          console.log(`🧹 Archivos de autenticación eliminados por fallo para usuario ${userId}`);
        } catch (fsError) {
          console.warn(`⚠️ No se pudieron eliminar archivos por fallo para ${userId}:`, fsError.message);
        }
      }
    });

    client.on('disconnected', reason => {
      console.warn(`🔌 Cliente desconectado para usuario ${userId}:`, reason);
      client.isReady = false;
      // Limpiar archivos de autenticación al desconectar
      const authPath = path.join(__dirname, '.wwebjs_auth', `session-${userId}`);
      if (fs.existsSync(authPath)) {
        try {
          fs.rmSync(authPath, { recursive: true, force: true });
          console.log(`🧹 Archivos de autenticación eliminados por desconexión para usuario ${userId}`);
        } catch (fsError) {
          console.warn(`⚠️ No se pudieron eliminar archivos por desconexión para ${userId}:`, fsError.message);
        }
      }
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

// Ruta para obtener el código QR
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

// Ruta para verificar el estado de la sesión
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

// Ruta para cerrar sesión
app.post('/close-session', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!clients[userId]) {
      return res.status(404).json({ 
        success: false, 
        error: 'No existe una sesión para este usuario' 
      });
    }

    const client = clients[userId];
    
    try {
      // Verificar si el cliente está listo antes de intentar destruirlo
      if (client.isReady) {
        await client.destroy();
      }
    } catch (err) {
      console.warn(`Advertencia al destruir cliente para ${userId}:`, err.message);
    } finally {
      // Limpiar siempre los datos del cliente
      delete clients[userId];
      delete qrCodes[userId];
    }
    
    res.json({ 
      success: true, 
      message: 'Sesión cerrada correctamente' 
    });

    // Limpiar archivos de autenticación después de un tiempo
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

// Ruta para obtener los grupos del usuario
app.get('/groups/:userId', async (req, res) => {
  const { userId } = req.params;
  const client = clients[userId];

  if (!client || !client.isReady) {
    return res.status(400).json({ success: false, error: 'Sesión no activa' });
  }

  try {
    const chats = await client.getChats();
    const groups = chats.filter(chat => chat.isGroup);
    
    const formattedGroups = await Promise.all(groups.map(async (group) => {
      const participants = await group.participants;
      return {
        id: group.id._serialized,
        name: group.name,
        participants: participants.length
      };
    }));

    return res.json({ success: true, groups: formattedGroups });
  } catch (error) {
    console.error("Error al obtener grupos:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Ruta para obtener los participantes de un grupo
app.get('/groups/:userId/:groupId/participants', async (req, res) => {
  const { userId, groupId } = req.params;
  const client = clients[userId];

  if (!client || !client.isReady) {
    return res.status(400).json({ success: false, error: 'Sesión no activa' });
  }

  try {
    const chat = await client.getChatById(groupId);
    if (!chat || !chat.isGroup) {
      return res.status(404).json({ success: false, error: 'Grupo no encontrado' });
    }

    const participants = await chat.participants;
    const numbers = new Set();

    // Obtener los números de los participantes
    for (const participant of participants) {
      try {
        // Obtener el contacto completo
        const contact = await client.getContactById(participant.id._serialized);
        if (contact) {
          // Intentar obtener el número del título
          const title = contact.name || contact.pushname || '';
          if (title) {
            // Extraer números del título
            const matches = title.match(/\+?\d{7,15}/g);
            if (matches) {
              matches.forEach(num => {
                const formattedNumber = num.startsWith('+') ? num : `+${num}`;
                numbers.add(formattedNumber);
              });
            }
          }
        }
      } catch (err) {
        console.warn(`No se pudo obtener el número para el participante:`, err.message);
      }
    }

    return res.json({ success: true, numbers: Array.from(numbers) });
  } catch (error) {
    console.error("Error al obtener participantes:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Ruta para enviar mensajes
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

// Ruta para obtener etiquetas
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

// Ruta para obtener chats por etiqueta
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

// Ruta para obtener mensajes para reportes
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
  console.log(`🚀 Servidor escuchando en http://localhost:${port}`);
});
