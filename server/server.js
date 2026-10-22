require('dotenv').config();
const http = require('http');
const app        = require('./app');
const connectDB  = require('./config/db');
const { initSocket } = require('./config/socket');
const { startRetentionWorker } = require('./jobs/retention');

/**
 * Port from the environment, or 5000.
 *
 * `PORT=0` (which some shells/process managers export by default) means "any
 * free port": the API would then listen on a random port while the client proxy
 * and socket URL keep pointing at 5000, and every request fails with ECONNREFUSED.
 * Treat non-positive/non-numeric values as "not set" instead.
 */
const rawPort = Number(process.env.PORT);
const PORT = Number.isInteger(rawPort) && rawPort > 0 ? rawPort : 5000;
if (process.env.PORT && PORT !== rawPort) {
  console.warn(`[Startup] Ignoring PORT=${process.env.PORT}; listening on ${PORT} instead.`);
}

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
