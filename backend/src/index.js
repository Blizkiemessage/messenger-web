require('dotenv').config();

const logger = require('./utils/logger');

// ─── Startup env validation ────────────────────────────────────────────────
// Always required (server cannot function without these)
const REQUIRED_ENV = ['JWT_SECRET', 'MESSAGE_ENCRYPTION_KEY'];
// Required only in production (dev can run without SMTP, admin hash, etc.)
const PROD_REQUIRED_ENV = ['SMTP_HOST', 'ADMIN_PASSWORD_HASH', 'APP_URL'];

const missingAlways = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingAlways.length) {
  logger.error('[STARTUP]', `Missing required env vars: ${missingAlways.join(', ')}`, null, {});
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  const missingProd = PROD_REQUIRED_ENV.filter(k => !process.env[k]);
  if (missingProd.length) {
    logger.error('[STARTUP]', `Missing required production env vars: ${missingProd.join(', ')}`, null, {});
    process.exit(1);
  }
}

// ─── Global crash handlers (must be first) ────────────────────────────────
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : null;
  const message = err ? err.message : String(reason);
  logger.error('[PROCESS]', 'Unhandled Promise Rejection', err, { reason: message });
  // Do NOT exit — one bad promise must not kill the server for all users
});

process.on('uncaughtException', (err) => {
  // Always print raw stack to stderr so it appears in any log collector (Amvera, PM2, etc.)
  console.error('[FATAL] Uncaught Exception:', err?.message);
  console.error(err?.stack || err);
  logger.error('[PROCESS]', 'Uncaught Exception — завершение', err, {});
  // Synchronous crash: state is undefined, exit is the only safe option
  process.exit(1);
});

const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

console.log('[STARTUP] Loading core modules...');
const { runMigrations }       = require('./db/migrations');
const { initSocket }          = require('./socket/socketServer');
const { errorHandler }        = require('./middleware/errorHandler');
const { corsOriginCallback }  = require('./utils/corsOrigin');
const { closeDb }             = require('./config/database');
const { startDbBackupWorker }  = require('./workers/dbBackup');
const { startS3CleanupWorker } = require('./workers/s3Cleanup');

console.log('[STARTUP] Loading route modules...');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const chatsRoutes = require('./routes/chats');
const messagesRoutes = require('./routes/messages');
const uploadRoutes = require('./routes/upload');
const adminRoutes = require('./routes/admin');
const friendsRoutes = require('./routes/friends');
const supportRoutes = require('./routes/support');
const pollsRoutes = require('./routes/polls');
const pushRoutes        = require('./routes/push');
const searchRoutes      = require('./routes/search');
const sessionsRoutes    = require('./routes/sessions');
const linkPreviewRoutes = require('./routes/linkPreview');
const { stickerPacksRouter, quotaRouter } = require('./routes/sticker-packs');
const gifRoutes         = require('./routes/gif');
const totpRoutes        = require('./routes/totp');
const callsRoutes       = require('./routes/calls');
const notesRoutes       = require('./routes/notes');
const healthRoutes      = require('./routes/health');
console.log('[STARTUP] All modules loaded.');
const path = require('path');

const app = express();
const server = http.createServer(app);

// ─── Middleware ────────────────────────────────────────────────────────────
app.set('trust proxy', 1);

// Resolve S3 origin once at startup so undefined env var never leaks into CSP
const _s3Origin = (() => {
  try { return process.env.S3_PUBLIC_URL ? new URL(process.env.S3_PUBLIC_URL).origin : null; }
  catch { return null; }
})();

app.use(helmet({
  contentSecurityPolicy: false,    // set per-path below
  crossOriginEmbedderPolicy: false, // required for S3 media playback
}));

// Content Security Policy
// Admin panel needs 'unsafe-inline' for scriptSrc: Bootstrap JS is loaded from
// cdn.jsdelivr.net AND the HTML uses dozens of inline onclick="..." handlers
// (Bootstrap-generated markup). All other routes get the strict policy.
app.use((req, res, next) => {
  const isAdmin = req.path.startsWith('/admin');
  return helmet.contentSecurityPolicy({
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:     isAdmin
        ? ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net']
        : ["'self'"],
      scriptSrcAttr: isAdmin ? ["'unsafe-inline'"] : ["'none'"],
      styleSrc:      ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      imgSrc:        ["'self'", 'data:', 'blob:', ...(_s3Origin ? [_s3Origin] : [])],
      mediaSrc:      ["'self'", 'blob:', ...(_s3Origin ? [_s3Origin] : [])],
      connectSrc:    isAdmin
        ? ["'self'", 'https://cdn.jsdelivr.net']
        : ["'self'"],
      fontSrc:       ["'self'", 'data:', 'https://cdn.jsdelivr.net'],
      objectSrc:   ["'none'"],
      frameAncestors: ["'none'"],
      // upgrade-insecure-requests breaks local HTTP dev; production only
      ...(process.env.NODE_ENV === 'production' ? { upgradeInsecureRequests: [] } : {}),
    },
  })(req, res, next);
});
app.use(cors({
  origin: corsOriginCallback,
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json());

// ─── Routes ────────────────────────────────────────────────────────────────
// Health check is registered first — no auth required, used by UptimeRobot probe.
app.locals.isShuttingDown = false;
app.use('/health', healthRoutes);

// Admin API is registered before global CORS so same-origin requests from the
// admin panel (served by this same server) are never rejected by corsOriginCallback.
// Security is handled by adminLoginLimiter + JWT auth inside the router itself.
app.use('/admin/api', adminRoutes);
app.use('/auth', authRoutes);
app.use('/users', usersRoutes);
app.use('/chats', chatsRoutes);
app.use('/chats', messagesRoutes);
app.use('/friends', friendsRoutes);
app.use('/support', supportRoutes);
app.use('/polls', pollsRoutes);
app.use('/push',         pushRoutes);
app.use('/search',       searchRoutes);
app.use('/sessions',     sessionsRoutes);
app.use('/link-preview', linkPreviewRoutes);
app.use('/sticker-packs', stickerPacksRouter);
app.use('/quota',         quotaRouter);
app.use('/gif',           gifRoutes);
app.use('/totp',          totpRoutes);
app.use('/calls',         callsRoutes);
app.use('/chats',         notesRoutes);

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/admin', express.static(path.join(__dirname, '../public/admin')));
app.use('/upload', uploadRoutes);

// ─── Error Handler ─────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Socket.io ─────────────────────────────────────────────────────────────
console.log('[STARTUP] Initialising Socket.IO...');
const io = initSocket(server);
app.set('io', io);

// ─── Start ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

console.log('[STARTUP] Running migrations...');
runMigrations();
console.log('[STARTUP] Migrations done.');

server.listen(PORT, () => {
  console.log(`[Server] Blizkie backend running on port ${PORT}`);
  console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);

  // Start automated DB backup worker after server is up
  // (needs DB to be open and migrations done — both guaranteed at this point)
  startDbBackupWorker();
  startS3CleanupWorker();
});

// ─── Graceful Shutdown ─────────────────────────────────────────────────────
// Amvera sends SIGTERM when redeploying or stopping the container.
// Sequence: stop accepting → close WebSockets → flush & close DB → exit.
let isShuttingDown = false;

function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  app.locals.isShuttingDown = true; // health route will return 503

  logger.info('[shutdown]', `Received ${signal} — starting graceful shutdown`);

  // Force-exit if shutdown takes longer than 10 s (stuck requests / sockets)
  const forceExitTimer = setTimeout(() => {
    logger.error('[shutdown]', 'Forced exit after 10 s timeout', null, {});
    process.exit(1);
  }, 10_000);
  forceExitTimer.unref(); // don't keep the event loop alive just for this timer

  // Step 1: stop accepting new HTTP connections
  server.close(() => {
    logger.info('[shutdown]', 'HTTP server closed');

    // Step 2: close Socket.IO (sends disconnect to all clients)
    io.close(() => {
      logger.info('[shutdown]', 'Socket.IO closed');

      // Step 3: checkpoint WAL and close SQLite
      closeDb();

      clearTimeout(forceExitTimer);
      logger.info('[shutdown]', 'Shutdown complete — exiting');
      process.exit(0);
    });
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
