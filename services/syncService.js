const { fetchUrl } = require('../utils/fetchUtils');
const AnimeMapping = require('../models/AnimeMapping');
const MangaMapping = require('../models/MangaMapping');
const { addToQueue } = require('./queueService');
const { addMangaToQueue } = require('./queueService');
const { isDBConnected } = require('../config/db');

class SyncService {
    constructor() {
        this.AIRING_URL = 'https://raw.githubusercontent.com/anime-and-manga/lists/main/anime-airing.json';
        this.ANIME_GLOBAL_URL = 'https://raw.githubusercontent.com/anime-and-manga/lists/main/anime.json';
        this.MANGA_GLOBAL_URL = 'https://raw.githubusercontent.com/anime-and-manga/lists/main/manga.json';
        
        this.lastAiringSync = null;
        this.syncInProgress = false;
    }

    /**
     * Sync currently airing anime from GitHub list
     * Optimized for free tier: only runs if DB is connected and not already syncing
     */
    async syncAiringAnime(force = false) {
        if (!isDBConnected()) return { success: false, error: 'DB not connected' };
        if (this.syncInProgress && !force) return { success: false, error: 'Sync already in progress' };

        // Only sync once every 12 hours unless forced (free tier safety)
        const now = new Date();
        if (!force && this.lastAiringSync && (now - this.lastAiringSync < 12 * 60 * 60 * 1000)) {
            return { success: true, message: 'Sync skipped (recent)' };
        }

        this.syncInProgress = true;
        console.log('SyncService: Starting airing anime sync...');

        try {
            const responseData = await fetchUrl(this.AIRING_URL);
            let airingList = responseData;

            if (typeof airingList === 'string') {
                if (airingList.trim().startsWith('<')) {
                    throw new Error('Received HTML instead of JSON (likely a proxy/network error page)');
                }
                try {
                    airingList = JSON.parse(airingList);
                    console.log('SyncService: Successly parsed string response as JSON');
                } catch (e) {
                    console.error('SyncService: Failed to parse string as JSON. Snippet:', airingList.substring(0, 100));
                    throw new Error('Invalid airing list format (not JSON)');
                }
            }

            if (!Array.isArray(airingList)) {
                console.error('SyncService: Invalid format. Expected Array, got:', typeof airingList);
                throw new Error('Invalid airing list format (not an array)');
            }

            let matchedCount = 0;
            let queuedCount = 0;

            for (const item of airingList) {
                const malId = item.idMal;
                const anilistId = item.idAL;
                const titles = item.titles || {};
                const title = titles.romaji || titles.english || titles.native;

                if (!malId) continue;

                // Update or create mapping
                const mapping = await AnimeMapping.findOneAndUpdate(
                    { mal_id: malId },
                    { 
                        $set: { 
                            anilist_id: anilistId,
                            title: title,
                            title_romaji: titles.romaji,
                            title_english: titles.english,
                            title_native: titles.native,
                            updated_at: new Date()
                        } 
                    },
                    { upsert: true, new: true }
                ).lean();

                matchedCount++;

                // Check if it needs provider mapping (Zoro/AnimePahe)
                // If it's not mapped or has very low confidence, add to queue
                if (mapping.mapping_status !== 'mapped' || !mapping.animepahe_id || !mapping.zoro_id) {
                    // Staggered queueing for free tier: just add to the normal queue
                    // The backgroundService will handle it with its own rate limits
                    await addToQueue(title, malId, anilistId, Object.values(titles).filter(Boolean), { priority: true });
                    queuedCount++;
                }
            }

            this.lastAiringSync = now;
            console.log(`SyncService: Airing sync complete. Matched: ${matchedCount}, Queued for processing: ${queuedCount}`);
            return { success: true, matched: matchedCount, queued: queuedCount };

        } catch (error) {
            console.error('SyncService: Airing sync failed:', error.message);
            return { success: false, error: error.message };
        } finally {
            this.syncInProgress = false;
        }
    }

    /**
     * Global ID Sync for Anime and Manga
     * This is a heavier operation, should be run manually or very infrequently
     */
    async syncGlobalIds(type = 'anime') {
        if (!isDBConnected()) return { success: false, error: 'DB not connected' };
        
        const url = type === 'anime' ? this.ANIME_GLOBAL_URL : this.MANGA_GLOBAL_URL;
        const Model = type === 'anime' ? AnimeMapping : MangaMapping;

        console.log(`SyncService: Starting global ${type} ID sync...`);

        try {
            const responseData = await fetchUrl(url);
            const list = responseData;

            if (!Array.isArray(list)) throw new Error(`Invalid ${type} list format`);

            const bulkOps = [];
            for (const item of list) {
                const malId = item.idMal || item.malId;
                const anilistId = item.idAL || item.anilistId;

                if (malId && anilistId) {
                    bulkOps.push({
                        updateOne: {
                            filter: { mal_id: malId },
                            update: { $set: { anilist_id: anilistId } },
                            upsert: false // Don't create new records for global sync to stay light
                        }
                    });
                }
            }

            if (bulkOps.length > 0) {
                // Batch updates for free tier efficiency
                const batchSize = 1000;
                for (let i = 0; i < bulkOps.length; i += batchSize) {
                    const batch = bulkOps.slice(i, i + batchSize);
                    await Model.bulkWrite(batch);
                }
            }

            console.log(`SyncService: Global ${type} ID sync complete. Processed ${bulkOps.length} potential updates.`);
            return { success: true, count: bulkOps.length };

        } catch (error) {
            console.error(`SyncService: Global ${type} sync failed:`, error.message);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new SyncService();
