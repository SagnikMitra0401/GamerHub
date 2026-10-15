require('dotenv').config();
const http = require('http');
const app        = require('./app');
const connectDB  = require('./config/db');
const { initSocket } = require('./config/socket');

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  const httpServer = http.createServer(app);
  initSocket(httpServer);  // Attach Socket.io to the HTTP server
  httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
