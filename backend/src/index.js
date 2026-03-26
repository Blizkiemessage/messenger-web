require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const { runMigrations } = require('./db/migrations');
const { initSocket } = require('./socket/socketServer');
const { errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const chatsRoutes = require('./routes/chats');
const messagesRoutes = require('./routes/messages');
const uploadRoutes = require('./routes/upload');
const adminRoutes = require('./routes/admin');
const friendsRoutes = require('./routes/friends');
const path = require('path');

const app = express();
const server = http.createServer(app);

// ─── Middleware ────────────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: false, // Prevent helmet from blocking our inline admin scripts/styles
}));
app.use(cors({
  origin: (origin, cb) => {
    // Allow non-browser clients (curl, mobile, etc.)
    if (!origin) return cb(null, true);

    // Allow local dev + common private LAN hostnames
    if (
      /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin) ||
      /^https?:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/.test(origin) ||
      /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin) ||
      /^https?:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+(:\d+)?$/.test(origin)
    ) {
      return cb(null, true);
    }
// Allow Vercel deployments
if (/^https:\/\/.*\.vercel\.app$/.test(origin)) {
  return cb(null, true);
}

// Allow custom domain from env
const allowed = process.env.ALLOWED_ORIGIN;
if (allowed && origin === allowed) {
  return cb(null, true);
}
    return cb(new Error(`CORS blocked origin: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json());

// ─── Routes ────────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/users', usersRoutes);
app.use('/chats', chatsRoutes);
app.use('/chats', messagesRoutes);
app.use('/admin/api', adminRoutes);
app.use('/friends', friendsRoutes);

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/admin', express.static(path.join(__dirname, '../public/admin')));
app.use('/upload', uploadRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ─── Error Handler ─────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Socket.io ─────────────────────────────────────────────────────────────
const io = initSocket(server);
app.set('io', io);

// ─── Start ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

runMigrations();

server.listen(PORT, () => {
  console.log(`[Server] Blizkie backend running on port ${PORT}`);
  console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
});
