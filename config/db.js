// Apply DNS fix for SRV resolution
require('./dns-fix');

const mongoose = require('mongoose');

let isConnecting = false;

const connectDB = async () => {
    // Prevent multiple simultaneous connection attempts
    if (isConnecting) return;
    if (mongoose.connection.readyState === 1) return;
    
    isConnecting = true;
    try {
        if (!process.env.MONGODB_URI || process.env.MONGODB_URI === 'undefined') {
            throw new Error('The `uri` parameter to `openUri()` must be a string, got "undefined". Make sure the first parameter to `mongoose.connect()` or `mongoose.createConnection()` is a string.');
        }

        const conn = await mongoose.connect(process.env.MONGODB_URI, {
            dbName: process.env.DB_NAME,
            serverSelectionTimeoutMS: 30000,
            socketTimeoutMS: 45000,
            maxPoolSize: 10,
            retryWrites: true,
            retryReads: true,
        });
        // connected event will handle resetting wasDisconnected
    } catch (err) {
        if (!wasDisconnected) {
            console.error(`MongoDB Connection Error: ${err.message}`);
            wasDisconnected = true;
        }
    } finally {
        isConnecting = false;
    }
};

// Connection event listeners
let wasDisconnected = false;

mongoose.connection.on('disconnected', () => {
    if (!wasDisconnected) {
        console.warn('MongoDB Warning: Connection lost. Auto-reconnect is active.');
        wasDisconnected = true;
    }
});

mongoose.connection.on('error', (err) => {
    // Only log operational errors once to avoid spam
    if (!wasDisconnected) {
        console.error('MongoDB Error:', err.message);
        wasDisconnected = true;
    }
});

mongoose.connection.on('connected', () => {
    if (wasDisconnected) {
        console.log('MongoDB info: Connection re-established.');
        wasDisconnected = false;
    } else {
        console.log('MongoDB info: Connection established.');
    }
});

const isDBConnected = () => mongoose.connection.readyState === 1;

connectDB.isDBConnected = isDBConnected;

module.exports = connectDB;
