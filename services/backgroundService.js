const { providerQueue } = require('./queueService');
const idProcessingService = require('./idProcessingService');
const mangaIdProcessingService = require('./mangaIdProcessingService');
const { isDBConnected } = require('../config/db');
const connectDB = require('../config/db');
const syncService = require('./syncService');

// Cleanup stale failed jobs on startup
(async () => {
    // Skip if core environment is missing to avoid "max retries" noise
    if (!process.env.REDIS_URL || !process.env.MONGODB_URI || process.env.MONGODB_URI === 'undefined') {
        return;
    }

    try {
        const failedJobs = await providerQueue.getFailed();
        if (failedJobs.length > 0) {
            console.log(`BackgroundService: Cleaning ${failedJobs.length} stale failed jobs...`);
            // Remove all failed jobs so they don't clog the queue
            for (const job of failedJobs) {
                await job.remove();
            }
            console.log('BackgroundService: Failed jobs cleared.');
        }
    } catch (err) {
        console.error('BackgroundService: Could not clean failed jobs:', err.message);
    }
})();

// Start processing Provider IDs (concurrency: 3)
providerQueue.process(3, async (job) => {
    console.log(`BackgroundService: Processing job ${job.id} - ${job.data.title || 'Unknown'}`);
    
    // 1. Ensure DB is connected before processing
    if (!isDBConnected()) {
        console.warn(`BackgroundService: DB not connected for job ${job.data.title || job.id}. Attempting reconnect...`);
        try {
            await connectDB();
            await new Promise(resolve => setTimeout(resolve, 2000));

            if (!isDBConnected()) {
                throw new Error('Database still disconnected after reconnect attempt');
            }
        } catch (connectError) {
            console.error('BackgroundService: DB reconnect failed:', connectError.message);
            throw new Error('Database connection failed');
        }
    }

    const { type } = job.data;

    try {
        let requestsMade = false;

        if (type === 'manga') {
            requestsMade = await mangaIdProcessingService.processManga(job.data);
        } else {
            requestsMade = await idProcessingService.processAnime(job.data);
        }

        if (requestsMade) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    } catch (error) {
        // Retry on DB-related errors
        if (error.message.includes('topology') || error.message.includes('disconnected') ||
            error.message.includes('buffering timed out') || error.message.includes('ECONNREFUSED')) {
            console.error('BackgroundService: DB Error during processing. Will retry...');
            throw error;
        }
        console.error(`BackgroundService: Processing error for ${job.data.title}:`, error.message);
    }
});

// Monitor queue health — every 5 minutes
setInterval(async () => {
    try {
        const counts = await providerQueue.getJobCounts();
        // Only log if there's something interesting
        if (counts.waiting > 0 || counts.active > 0 || counts.failed > 0) {
            console.log(`Queue: waiting=${counts.waiting} active=${counts.active} completed=${counts.completed} failed=${counts.failed}`);
        }
    } catch (err) {
        // Silently ignore queue status errors (Redis might be down)
    }
}, 300000);

// Daily Housekeeping — every 24 hours
setInterval(async () => {
    try {
        if (!isDBConnected()) return;
        
        console.log('BackgroundService: Starting daily housekeeping...');
        
        await syncService.syncAiringAnime();
        
        // Alternate anime/manga global sync by day
        const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
        if (dayOfYear % 2 === 0) {
            await syncService.syncGlobalIds('anime');
        } else {
            await syncService.syncGlobalIds('manga');
        }
        
        // Clean up completed jobs to free Redis memory
        const completed = await providerQueue.getCompleted();
        if (completed.length > 100) {
            for (const job of completed.slice(100)) {
                await job.remove();
            }
        }
        
        console.log('BackgroundService: Daily housekeeping complete.');
    } catch (err) {
        console.error('Housekeeping Error:', err.message);
    }
}, 86400000);