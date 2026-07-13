// Prevent server crashes from unhandled errors in external libraries (e.g. animepahe-api)
process.on('uncaughtException', (err) => {
    console.error('[AniEmpire-API] FATAL: Uncaught Exception:', err.message);
    if (err.stack) console.error(err.stack);
    // Keep server running for transient network errors (ECONNRESET/TIMEOUT)
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[AniEmpire-API] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Load environment variables immediately
require('dotenv').config();

// Force DNS servers to Google/Cloudflare (fix for SRV resolution)
require('./config/dns-fix');

console.log('--------------------------------------------------');
console.log('[AniEmpire-API] Server is running with DB-Free patches.');
console.log('--------------------------------------------------');

const express = require('express');
const app = express(); 
const animeRoutes = require('./routes/animeRoutes'); // Import anime routes
const mangaRoutes = require('./routes/mangaRoutes'); // Import manga routes
const characterRoutes = require('./routes/characterRoutes'); // Import character routes
const userRoutes = require('./routes/userRoutes'); // Import user routes
const clubRoutes = require('./routes/clubRoutes'); // Import club routes
const magazineRoutes = require('./routes/magazineRoutes'); // Import magazine routes
const producerRoutes = require('./routes/producerRoutes'); // Import producer routes
const personRoutes = require('./routes/personRoutes'); // Import person routes
const updateMappings = require('./routes/mappingRoutes'); // Import updateMappings function
const systemRoutes = require('./routes/systemRoutes'); // Import system routes
const proxyRoutes = require('./routes/proxyRoutes'); // Import proxy routes
const streamRoutes = require('./routes/streamRoutes'); // Import stream routes
const { handleDatabaseError, errorHandler } = require('./middleware/errorHandler');
const { initialize } = require('./controllers/mappingController');
const { updateMangaMappingsDatabase } = require('./controllers/mangaMappingController');
const syncService = require('./services/syncService');
require('./services/backgroundService');

const jikanjs = require('@mateoaranda/jikanjs');

jikanjs.settings.setBaseURL('https://api.jikan.moe/v4'); // sets the API Base URL

const cors = require('cors');

app.use(cors());
app.use(express.json()); // Middleware to parse JSON data

app.get('/api', (req, res) => {
    res.send('Welcome to the animeEmpire API');
});

app.get('/api/anime/', (req, res) => {
    res.send('Anime route');
});

app.get('/api/manga', (req, res) => {
    res.send('Manga Route');
});

app.get('/api/character', (req, res) => {
    res.send('Character Route');
});

app.get('/api/user', (req, res) => {
    res.send('User Route');
});

app.get('/api/club', (req, res) => {
    res.send('Club Route');
});

app.get('/api/magazines', (req, res) => {
    res.send('Magazine Route');
});

app.get('/api/producers', (req, res) => {
    res.send('Producer Route');
});

app.get('/api/person', (req, res) => {
    res.send('Person Route');
});

app.use('/api', animeRoutes);
app.use('/api', mangaRoutes);
app.use('/api', characterRoutes);
app.use('/api', userRoutes);
app.use('/api', clubRoutes);
app.use('/api', magazineRoutes);
app.use('/api', producerRoutes);
app.use('/api', personRoutes);
app.use('/system', systemRoutes);
app.use('/api/proxy', proxyRoutes);
app.use('/api/stream', streamRoutes);

app.use('/admin', updateMappings);

// Global Error Handler - must be after routes
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
const connectDB = require('./config/db');

app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    
    // Skip retries if MONGODB_URI is missing or "undefined" string (it's intentional for some environments)
    if (!process.env.MONGODB_URI || process.env.MONGODB_URI === 'undefined') {
        await connectDB(); // Log the error once
        console.warn('Server started without DB initialization. It will connect when available.');
        return;
    }

    // Attempt DB connection with retries before running init
    const maxRetries = 5;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await connectDB();
            if (connectDB.isDBConnected()) {
                console.log('Database ready. Running initialization...');
                await initialize(false);
                await updateMangaMappingsDatabase(false);
                console.log('Initial mapping updates completed.');
                
                // Sync airing anime on startup (has built-in 12h cooldown)
                syncService.syncAiringAnime().then(result => {
                    if (result.success) {
                        console.log(`Startup airing sync: Matched ${result.matched || 0}, Queued ${result.queued || 0}`);
                    } else {
                        console.log(`Startup airing sync skipped: ${result.message || result.error}`);
                    }
                }).catch(err => console.error('Startup airing sync error:', err.message));
                
                return; // Success, exit retry loop
            }
        } catch (error) {
            console.error(`Initialization attempt ${attempt}/${maxRetries} failed:`, error.message);
        }
        
        if (attempt < maxRetries) {
            const delay = attempt * 5000; // 5s, 10s, 15s, 20s
            console.log(`Retrying in ${delay / 1000}s...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
    
    console.warn('Server started without DB initialization. It will connect when available.');
});