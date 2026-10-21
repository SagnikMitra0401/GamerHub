require('dotenv').config();
const http = require('http');
const app        = require('./app');
const connectDB  = require('./config/db');
const { initSocket } = require('./config/socket');
const { startRetentionWorker } = require('./jobs/retention');

const PORT = process.env.PORT ?? 5000;

async function start() {
  try {
    await connectDB();
  } catch (err) {
    console.error('[Startup] MongoDB connection failed:', err.message);
    process.exit(1);
  }

  const httpServer = http.createServer(app);
  const io = initSocket(httpServer);
  startRetentionWorker();

  httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
  });

  const shutdown = (signal) => {
    console.log(`[Shutdown] ${signal} received, closing server…`);
    io.close();
    httpServer.close(() => process.exit(0));
    // Never hang a container restart.
    setTimeout(() => process.exit(0), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled rejection:', reason);
});

start();
