const animepahe = require('./anime/animepahe');
const consumet = require('./anime/consumet');
const megaplay = require('./anime/megaplay');
const animeMappingService = require('./animeMappingService');
const { isDBConnected } = require('../config/db');
const NodeCache = require('node-cache');

const episodeCache = new NodeCache({ stdTTL: 3600 * 24 }); // Cache episodes for 24 hours

class AnimeOrchestrator {
    constructor() {
        this.availableProviders = [
            { name: 'animepahe', service: animepahe, type: 'direct' },
            { name: 'animeunity', service: consumet, type: 'consumet' },
            { name: 'animesaturn', service: consumet, type: 'consumet' },
        ];
        this.providerHealth = {}; // { name: { failures: 0, openUntil: null } }
    }

    isProviderHealthy(name) {
        const h = this.providerHealth[name];
        if (!h || h.failures < 3) return true;
        if (h.openUntil && Date.now() < h.openUntil) return false;
        return true; // Cooldown expired
    }

    recordFailure(name) {
        if (!this.providerHealth[name]) this.providerHealth[name] = { failures: 0 };
        this.providerHealth[name].failures++;
        if (this.providerHealth[name].failures >= 3) {
            console.log(`[Orchestrator] Opening circuit for ${name} due to repeated failures`);
            this.providerHealth[name].openUntil = Date.now() + 60000; // 1 min cooldown
        }
    }

    recordSuccess(name) {
        this.providerHealth[name] = { failures: 0, openUntil: null };
    }

    getProviders(preferredProvider) {
        let providers = [...this.availableProviders];
        let providerName = preferredProvider;

        if (providerName) {
            const index = providers.findIndex(p => p.name === providerName);
            if (index > -1) {
                const p = providers[index];
                const others = providers.filter(x => x.name !== providerName);
                return [p, ...others];
            }
        }
        return providers;
    }

    async fetchAndSaveProviderIds(animeData) {
        const { title, malId, anilistId, altTitles = [], preferredProvider = 'animepahe' } = animeData;
        const currentMapping = await animeMappingService.getMappingByMalId(malId);
        let updates = {};

        // Collect all titles to try for better matching
        const searchTitles = [...new Set([
            title,
            currentMapping?.title_english,
            currentMapping?.title_romaji,
            ...altTitles,
            ...(currentMapping?.title_synonyms || [])
        ])].filter(Boolean);
        
        console.log(`[Orchestrator] Attempting to resolve IDs for MAL ${malId} using titles:`, searchTitles);
        
        return new Promise((resolve) => {
            let earlyResolved = false;
            let completedCount = 0;
            const totalProviders = this.availableProviders.length;

            let graceTimer = null;

            const tryResolve = (reason) => {
                if (earlyResolved) return;
                earlyResolved = true;
                if (graceTimer) clearTimeout(graceTimer);
                console.log(`[Orchestrator] ID resolution resolved: ${reason}`);
                resolve(updates);
            };

            const checkEarlyResolve = () => {
                completedCount++;
                
                // Resolve when PREFERRED provider is found
                if (updates[`${preferredProvider}_id`]) {
                    tryResolve(`Preferred provider (${preferredProvider}) found`);
                    return;
                }
                
                // Resolve when ANY provider ID is found (don't block on preferred)
                const hasAnyId = Object.keys(updates).some(k => k.endsWith('_id'));
                if (!earlyResolved && hasAnyId && !graceTimer) {
                    console.log(`[Orchestrator] First provider ID found. Waiting up to 3000ms for preferred provider ID.`);
                    graceTimer = setTimeout(() => {
                        tryResolve(`Provider found (${Object.keys(updates).filter(k => k.endsWith('_id')).join(', ')}) after grace period`);
                    }, 3000);
                    return;
                }
                
                // Resolve when all providers have completed
                if (!earlyResolved && completedCount === totalProviders) {
                    tryResolve('All providers completed');
                }
            };

            this.availableProviders.forEach(async (provider) => {
                let id = null;
                try {
                    if (currentMapping && currentMapping[`${provider.name}_id`] && currentMapping[`${provider.name}_verified`] === true) {
                        updates[`${provider.name}_id`] = currentMapping[`${provider.name}_id`];
                        checkEarlyResolve();
                        return;
                    }

                    if (searchTitles && searchTitles.length > 0) {
                        const mainTitle = searchTitles[0];
                        const additionalTitles = searchTitles.slice(1);
                        
                        if (provider.type === 'consumet') {
                            id = await provider.service.resolveAnimeId(provider.name, mainTitle, additionalTitles, malId);
                        } else {
                            id = await provider.service.resolveAnimeId(mainTitle, additionalTitles, malId, anilistId);
                        }
                    }

                    if (id) {
                        updates[`${provider.name}_id`] = id;
                        updates[`${provider.name}_verified`] = true; 
                        updates[`${provider.name}_last_check`] = new Date();
                    }
                } catch (error) {
                    console.warn(`[Orchestrator] Error resolving ID for ${provider.name}: ${error.message}`);
                } finally {
                    checkEarlyResolve();
                    
                    // Background update mechanism for the ones that finish late
                    if (earlyResolved && id) {
                        const backgroundUpdate = {
                            [`${provider.name}_id`]: id,
                            [`${provider.name}_verified`]: true,
                            [`${provider.name}_last_check`]: new Date()
                        };
                        animeMappingService.updateMapping(malId, backgroundUpdate).catch(() => {});
                    }
                }
            });
            
            // Absolute safety timeout — never hang forever
            setTimeout(() => tryResolve('Safety timeout (65s)'), 65000);
        }).then((resolvedUpdates) => {
            if (Object.keys(resolvedUpdates).length > 0) {
                console.log(`[Orchestrator] Saving initial batch of IDs for MAL ${malId}:`, Object.keys(resolvedUpdates));
                try {
                    animeMappingService.updateMapping(malId, resolvedUpdates);
                    if (!isDBConnected()) {
                        console.log(`[Orchestrator] DB disconnected. Kept IDs in memory.`);
                    }
                } catch (dbError) {
                    console.warn(`[Orchestrator] Failed to save IDs: ${dbError.message}. Proceeding.`);
                }
            }
            return resolvedUpdates;
        });
    }

    async getEpisodes(title, malId, mapping, preferredProvider, targetEpNum = null, category = 'sub', altTitles = []) {
        const providersToTry = this.getProviders(preferredProvider);
        const startTime = Date.now();

        // Run ALL providers in parallel for maximum speed
        const providerPromises = providersToTry.map(async (provider) => {
            if (!this.isProviderHealthy(provider.name)) {
                console.log(`[Orchestrator] Skipping ${provider.name} - circuit open`);
                return null;
            }

            let providerId = mapping[`${provider.name}_id`];
            
            if (!providerId) {
                try {
                    if (provider.type === 'consumet') {
                        providerId = await provider.service.resolveAnimeId(provider.name, title, altTitles, malId);
                    } else {
                        providerId = await provider.service.resolveAnimeId(title, altTitles, malId, mapping.anilist_id);
                    }
                    if (providerId) {
                        animeMappingService.updateMapping(malId, { [`${provider.name}_id`]: providerId, [`${provider.name}_verified`]: true }).catch(err => {});
                    }
                } catch (e) {}
            }

            if (!providerId) return null;

            // Cache Strategy: Check "all" first, then "page"
            const cacheKeyAll = `eps_${provider.name}_${providerId}_all`;
            const cacheKeyPage = `eps_${provider.name}_${providerId}_${targetEpNum ? Math.ceil(targetEpNum / 30) : 'all'}`;
            
            let cachedInfo = episodeCache.get(cacheKeyAll);
            if (!cachedInfo) cachedInfo = episodeCache.get(cacheKeyPage);

            if (cachedInfo) {
                this.recordSuccess(provider.name);
                return { provider: provider.name, episodes: cachedInfo.episodes, animeId: cachedInfo.id };
            }

            const timeoutMs = (provider.name === 'animepahe' || provider.name === 'animeunity') ? 30000 : 10000;
            try {
                const info = await Promise.race([
                    provider.type === 'consumet' 
                        ? provider.service.getAnimeById(provider.name, providerId, targetEpNum)
                        : provider.service.getAnimeById(providerId, targetEpNum),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
                ]);

                if (info && info.episodes && info.episodes.length > 0) {
                    if (info.episodes.length > 50 || !targetEpNum) {
                        episodeCache.set(cacheKeyAll, info);
                    } else {
                        episodeCache.set(cacheKeyPage, info);
                    }
                    
                    console.log(`[Orchestrator] ${provider.name} found ${info.episodes.length} episodes.`);
                    this.recordSuccess(provider.name);
                    return { provider: provider.name, episodes: info.episodes, animeId: info.id };
                } else {
                    console.log(`[Orchestrator] ${provider.name} returned no episodes.`);
                }
            } catch (error) {
                const errorMsg = error.message === 'timeout' ? `Request timed out (${timeoutMs / 1000}s)` : error.message;
                console.warn(`[Orchestrator] ${provider.name} failed: ${errorMsg}`);
                this.recordFailure(provider.name);
            }
            return null;
        });

        let successfulResults = [];
        let completedCount = 0;
        
        // FAST-RETURN strategy: resolve as soon as the FIRST provider returns,
        // with a short grace period for others to arrive.
        await new Promise((resolve) => {
            let graceTimer = null;
            let resolved = false;
            
            const tryResolve = () => {
                if (resolved) return;
                resolved = true;
                if (graceTimer) clearTimeout(graceTimer);
                resolve();
            };

            providerPromises.forEach(p => {
                p.then(res => {
                    completedCount++;
                    if (res) {
                        successfulResults.push(res);
                        
                        const hasPreferred = successfulResults.some(r => r.provider === preferredProvider);
                        
                        // If we got the preferred provider, resolve almost instantly (short grace for stragglers)
                        if (hasPreferred) {
                            if (graceTimer) clearTimeout(graceTimer);
                            console.log(`[Orchestrator] Preferred provider (${preferredProvider}) found in ${Date.now() - startTime}ms. Resolving in 300ms.`);
                            graceTimer = setTimeout(tryResolve, 300);
                        }
                        // If we got any result, wait a bit longer to give the preferred provider a chance
                        else if (successfulResults.length === 1 && !graceTimer) {
                            console.log(`[Orchestrator] First provider (${res.provider}) found in ${Date.now() - startTime}ms. Waiting up to 3000ms for preferred.`);
                            graceTimer = setTimeout(tryResolve, 3000);
                        }
                    }
                    
                    // All done
                    if (completedCount === providerPromises.length) {
                        tryResolve();
                    }
                }).catch(() => {
                    completedCount++;
                    if (completedCount === providerPromises.length) {
                        tryResolve();
                    }
                });
            });
            
            // Absolute max wait time (60s) to prevent hanging
            setTimeout(tryResolve, 60000);
        });

        console.log(`[Orchestrator] Parallel fetch completed in ${Date.now() - startTime}ms. Found ${successfulResults.length}/${providersToTry.length} providers successfully.`);
        
        if (successfulResults.length < providersToTry.length) {
            const failed = providersToTry.filter(p => !successfulResults.find(r => r.provider === p.name)).map(p => p.name);
            console.log(`[Orchestrator] Missing providers: ${failed.join(', ')}`);
        }

        const isFullyResolved = completedCount === providersToTry.length;
        const preferredOrder = ['animepahe', 'animeunity', 'animesaturn'];
        
        const sortedResults = successfulResults.sort((a, b) => {
            let finalOrder = [...preferredOrder];
            if (category === 'dub') {
                finalOrder = ['animepahe', 'animeunity', 'animesaturn'];
            }
            if (preferredProvider && finalOrder.includes(preferredProvider)) {
                finalOrder = [preferredProvider, ...finalOrder.filter(p => p !== preferredProvider)];
            }
            const idxA = finalOrder.indexOf(a.provider);
            const idxB = finalOrder.indexOf(b.provider);
            return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
        });

        return {
            results: sortedResults,
            isFullyResolved
        };
    }

    async getServers(providerName, episodeId, title = null) {
        if (providerName === 'megaplay') return await megaplay.getServers(episodeId);
        
        const provider = this.availableProviders.find(p => p.name === providerName);
        if (!provider) throw new Error(`Invalid provider: ${providerName}`);

        if (provider.type === 'consumet') {
            return await provider.service.getEpisodeServers(provider.name, episodeId);
        } else {
            return await provider.service.getEpisodeServers(episodeId, title);
        }
    }

    async getSources(title, providerName, episodeId, serverId, category = 'sub', animeId = null, targetEpNum = null) {
        if (providerName === 'megaplay') return await megaplay.getSources(episodeId, serverId, category, animeId, targetEpNum);
        
        const provider = this.availableProviders.find(p => p.name === providerName);
        if (!provider) throw new Error(`Invalid provider: ${providerName}`);

        let targetServerId = serverId;



        if (provider.type === 'consumet') {
            return await provider.service.getEpisodeSources(provider.name, episodeId, targetServerId);
        } else if (provider.name === 'animepahe') {
            return await provider.service.getEpisodeSources(episodeId, targetServerId, category, animeId);
        } else {
            return await provider.service.getEpisodeSources(episodeId, targetServerId, category);
        }
    }
}

module.exports = new AnimeOrchestrator();
