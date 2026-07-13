const MangaMapping = require('../models/MangaMapping');
const consumet = require('./manga/consumet');
const yomu = require('./manga/yomu');

class MangaOrchestrator {
    constructor() {
        this.availableProviders = [
            { name: 'mangapill', service: yomu, type: 'yomu' },
            { name: 'mangafire', service: yomu, type: 'yomu' },
            { name: 'flamecomics', service: yomu, type: 'yomu' },
            { name: 'mangadex', service: consumet, type: 'consumet' },
            { name: 'mangapark', service: yomu, type: 'yomu' }
        ];

        this.rateLimitConfig = {
            delayBetweenRequests: 1000,
            maxConcurrent: 3,
            maxRetries: 3,
            retryDelay: 2000
        };
        
        this.activeRequests = 0;
        this.requestQueue = [];
    }

    async acquireRequestSlot() {
        return new Promise((resolve) => {
            const tryAcquire = () => {
                if (this.activeRequests < this.rateLimitConfig.maxConcurrent) {
                    this.activeRequests++;
                    resolve();
                } else {
                    this.requestQueue.push(tryAcquire);
                }
            };
            tryAcquire();
        });
    }

    releaseRequestSlot() {
        this.activeRequests--;
        if (this.requestQueue.length > 0) {
            const next = this.requestQueue.shift();
            setTimeout(next, 0);
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async executeRequestWithRetry(requestFn, retries = this.rateLimitConfig.maxRetries) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                await this.acquireRequestSlot();
                await this.delay(this.rateLimitConfig.delayBetweenRequests);
                return await requestFn();
            } catch (error) {
                if (this.isLogicalFailure(error)) throw error;
                if (attempt === retries) throw error;
                const totalDelay = this.rateLimitConfig.retryDelay * Math.pow(2, attempt) + Math.random() * 1000;
                await this.delay(totalDelay);
            } finally {
                this.releaseRequestSlot();
            }
        }
    }

    async bulkFetchAndSaveProviderIds(mangaEntries) {
        const results = [];
        const batchSize = 10;
        for (let i = 0; i < mangaEntries.length; i += batchSize) {
            const batch = mangaEntries.slice(i, i + batchSize);
            const batchPromises = batch.map(entry => 
                this.executeRequestWithRetry(async () => {
                    try {
                        return await this.fetchAndSaveProviderIds(entry);
                    } catch (error) {
                        return { malId: entry.malId, error: error.message };
                    }
                })
            );
            const batchResults = await Promise.allSettled(batchPromises);
            results.push(...batchResults);
            await this.delay(2000);
        }
        return results;
    }

    async fetchAndSaveProviderIds(mangaData) {
        const { title, malId, anilistId, altTitles = [] } = mangaData;
        let updates = {};

        for (const provider of this.availableProviders) {
            // Skip mangapark currently
            if (provider.name === 'mangapark') continue;

            try {
                const id = provider.type === 'direct'
                    ? await provider.service.resolveMangaId(title, altTitles, malId)
                    : await provider.service.resolveMangaId(provider.name, title, altTitles);
                    
                if (id) {
                    updates[`${provider.name}_id`] = id;
                    updates[`${provider.name}_verified`] = true;
                    updates[`${provider.name}_last_check`] = new Date();
                }
            } catch (error) {
                console.warn(`MangaOrchestrator: Failed to resolve ID for ${provider.name}: ${error.message}`);
            }
        }

        if (Object.keys(updates).length > 0) {
            let mappingStatus = 'mapped';
            let mappingConfidence = 0.7;
            const providerCount = Object.keys(updates).filter(key => key.includes('_id')).length;
            if (providerCount >= 3) mappingConfidence = 1.0;
            else if (providerCount >= 2) mappingConfidence = 0.8;

            updates.mapping_status = mappingStatus;
            updates.mapping_confidence = mappingConfidence;
            updates.mapping_last_update = new Date();

            await MangaMapping.updateOne({ mal_id: malId }, { $set: updates }, { upsert: true });
        }

        return updates;
    }

    async getChapters(malId, preferredProvider, language = 'EN', title = null) {
        const { isDBConnected } = require('../config/db');
        const dbReady = isDBConnected();

        let mapping = null;
        if (dbReady) {
            try {
                mapping = await MangaMapping.findOne({ mal_id: malId }).lean();
            } catch (dbErr) {
                console.warn('[getChapters] DB mapping fetch failed, falling back to dynamic:', dbErr.message);
            }
        }
        if (!mapping) mapping = { mal_id: malId, title: title || `MAL_ID_${malId}` };

        // Gold fallback title: resolve via Jikan if missing
        let activeTitle = title || mapping.title || `MAL_ID_${malId}`;
        if ((!activeTitle || activeTitle.startsWith('MAL_ID_')) && malId) {
            try {
                const jikanFunctions = require('../utils/jikanUtils');
                const meta = await jikanFunctions.rawFetch(`https://api.jikan.moe/v4/manga/${malId}`);
                activeTitle = meta.data?.title || meta.data?.title_english || meta.data?.title_romaji || activeTitle;
            } catch (err) {
                console.warn(`[getChapters] Jikan title resolution failed:`, err.message);
            }
        }

        const providersToTry = this.getProviders(preferredProvider);

        for (const provider of providersToTry) {
            if (provider.name === 'mangapark') continue; // Still skip

            let providerId = mapping[`${provider.name}_id`];
            
            // DYNAMIC RESOLUTION FALLBACK:
            // If the provider ID is not in our database mapping, search for it on-the-fly!
            if (!providerId && activeTitle && !activeTitle.startsWith('MAL_ID_')) {
                console.log(`MangaOrchestrator: Mapped ID missing for ${provider.name}, resolving dynamically for: "${activeTitle}"`);
                try {
                    providerId = provider.type === 'direct'
                        ? await provider.service.resolveMangaId(activeTitle, [], malId)
                        : await provider.service.resolveMangaId(provider.name, activeTitle, []);
                    
                    if (providerId) {
                        console.log(`MangaOrchestrator: Resolved ${provider.name}_id = "${providerId}" dynamically!`);
                        const updates = {};
                        updates[`${provider.name}_id`] = providerId;
                        updates[`${provider.name}_verified`] = true;
                        updates[`${provider.name}_last_check`] = new Date();
                        
                        // Save in database if connected
                        if (isDBConnected()) {
                            try {
                                await MangaMapping.updateOne({ mal_id: malId }, { $set: updates }, { upsert: true });
                            } catch (saveErr) {
                                console.warn('[getChapters] DB mapping save failed:', saveErr.message);
                            }
                        }
                        // Update local mapping for fallback try or subsequent requests
                        mapping[`${provider.name}_id`] = providerId;
                    }
                } catch (resolveErr) {
                    console.warn(`MangaOrchestrator: Dynamic resolution failed for ${provider.name}: ${resolveErr.message}`);
                }
            }

            if (!providerId) continue;

            try {
                const chapters = provider.type === 'direct'
                    ? await provider.service.getChapters(providerId, language)
                    : await provider.service.getChapters(provider.name, providerId, language);

                if (chapters && chapters.length > 0) {
                    return { provider: provider.name, mangaId: providerId, chapters };
                }
            } catch (error) {
                console.warn(`MangaOrchestrator: ${provider.name} failed: ${error.message}`);
            }
        }
        throw new Error('Could not fetch chapters from any provider');
    }

    async getPages(providerName, chapterId, mangaId = null) {
        const provider = this.availableProviders.find(p => p.name === providerName);
        if (!provider) throw new Error(`Invalid provider: ${providerName}`);
        
        return provider.type === 'direct'
            ? await provider.service.getPages(chapterId, mangaId)
            : await provider.service.getPages(provider.name, chapterId, mangaId);
    }

    getProviders(preferredProvider) {
        if (preferredProvider) {
            const index = this.availableProviders.findIndex(p => p.name === preferredProvider);
            if (index > -1) {
                const p = this.availableProviders[index];
                const others = this.availableProviders.filter(x => x.name !== preferredProvider);
                return [p, ...others];
            }
        }
        return [...this.availableProviders];
    }

    isLogicalFailure(error) {
        if (!error || !error.message) return false;
        const msg = error.message.toLowerCase();
        const status = error.response?.status;
        return status === 404 || msg.includes('not found') || msg.includes('no results') || msg.includes('invalid id');
    }
}

module.exports = new MangaOrchestrator();