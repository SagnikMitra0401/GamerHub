const mongoose = require('mongoose');
const dns = require('dns');

// Local DNS server fails to resolve MongoDB Atlas SRV records.
// Override to use Google Public DNS which resolves them correctly.
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const connectDB = async () => {
  // Atlas' free tier allows ~100 connections per cluster; a small pool per
  // process leaves headroom for the migration runner and the Atlas UI.
  await mongoose.connect(process.env.MONGO_URI, {
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) || 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000
  });
  console.log('MongoDB connected');
};

module.exports = connectDB;
