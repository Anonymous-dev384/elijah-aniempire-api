const Queue = require('bull');
const idProcessingService = require('./idProcessingService');
const animeMappingService = require('./animeMappingService');
const MangaMapping = require('../models/MangaMapping');
const { isDBConnected } = require('../config/db');

// Create single unified queue with additional options for better reliability
const providerQueue = new Queue('provider-id-processing', {
    redis: process.env.REDIS_URL,
    defaultJobOptions: {
        attempts: 5,
        backoff: {
            type: 'exponential',
            delay: 5000
        },
        removeOnComplete: {
            count: 1000
        },
        removeOnFail: {
            count: 1000
        }
    }
});

// Handle failed jobs
providerQueue.on('failed', (job, error) => {
    console.error(`Provider job failed processing ${job.data.title}:`, error);
});

module.exports = {
    providerQueue,
    
    addToQueue: async (title, malId, anilistId, altTitles = [], options = {}) => {
        try {
            const validMalId = Number(malId);
            if (isNaN(validMalId)) return;

            // Log clearly, even if title is undefined (MAL ID is key)
            const logTitle = title || `MAL:${validMalId}`;

            // Check DB connection
            if (!isDBConnected()) {
                console.warn(`QueueService: DB not connected. Skipping DB check for ${logTitle}`);
            } else if (!options.skipCheck) {
                // 1. Check if we should even process this (only if DB is connected and not skipped)
                const mapping = await animeMappingService.getMappingByMalId(validMalId);

                // If already completed or currently pending, skip
                if (mapping?.background_status === 'completed' || mapping?.background_status === 'pending') {
                    return;
                }

                // If failed, wait at least 24 hours before trying again
                if (mapping?.background_status === 'failed') {
                    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
                    if (mapping.background_last_attempt > oneDayAgo) {
                        console.log(`Skipping queue for ${logTitle} - recently failed.`);
                        return;
                    }
                }
            }

            console.log(`Adding to provider queue - Title: ${logTitle}`);

            const validAnilistId = anilistId ? Number(anilistId) : null;

            // Add to unified queue
            await providerQueue.add(
                {
                    type: 'anime',
                    title: title, // title might be null/undefined, worker handles it
                    malId: validMalId,
                    anilistId: validAnilistId,
                    altTitles: altTitles
                },
                {
                    jobId: `anime:${validMalId}`,
                    attempts: 5,
                    backoff: {
                        type: 'exponential',
                        delay: 5000
                    },
                    removeOnComplete: {
                        count: 1000 // Keep last 1000 jobs for visibility
                    }
                }
            );
            console.log('Added to Provider queue (Anime)');
        } catch (error) {
            console.error('Error adding to provider queue:', error);
        }
    },

    addMangaToQueue: async (title, malId, anilistId, altTitles = [], options = {}) => {
        try {
            const validMalId = Number(malId);
            if (isNaN(validMalId)) return;

            const logTitle = title || `MAL:${validMalId}`;

            // Check DB connection
            if (!isDBConnected()) {
                console.warn(`QueueService: DB not connected. Skipping DB check for manga ${logTitle}`);
            } else if (!options.skipCheck) {
                // 1. Check if we should even process this
                const mapping = await MangaMapping.findOne({ mal_id: validMalId });

                // If already completed or currently pending, skip
                if (mapping?.background_status === 'completed' || mapping?.background_status === 'pending') {
                    return;
                }

                // If failed, wait at least 24 hours before trying again
                if (mapping?.background_status === 'failed') {
                    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
                    if (mapping.background_last_attempt > oneDayAgo) {
                        console.log(`Skipping manga queue for ${logTitle} - recently failed.`);
                        return;
                    }
                }
            }

            console.log(`Adding manga to provider queue - Title: ${logTitle}`);

            const validAnilistId = anilistId ? Number(anilistId) : null;

            // Add to unified queue
            await providerQueue.add(
                {
                    type: 'manga',
                    title: title,
                    malId: validMalId,
                    anilistId: validAnilistId,
                    altTitles: altTitles
                },
                {
                    jobId: `manga:${validMalId}`,
                    attempts: 5,
                    backoff: {
                        type: 'exponential',
                        delay: 5000
                    },
                    removeOnComplete: {
                        count: 1000 // Keep last 1000 jobs for visibility
                    }
                }
            );
            console.log('Added to Provider queue (Manga)');
        } catch (error) {
            console.error('Error adding manga to provider queue:', error);
        }
    },

    getQueueSize: async () => {
        try {
            const counts = await providerQueue.getJobCounts();
            return counts.waiting + counts.active + counts.delayed;
        } catch {
            return 0;
        }
    }
};