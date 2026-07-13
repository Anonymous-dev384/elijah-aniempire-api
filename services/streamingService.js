const animeService = require('./animeService');
const animeMappingService = require('./animeMappingService');
const { addToQueue } = require('./queueService');
const connectDB = require('../config/db');
const isDBConnected = connectDB.isDBConnected;

class StreamingService {
    
    /**
     * Get or fetch streaming provider IDs
     * Replaces old getStreamingIds/getZoroId logic
     */
    async getStreamingIds(title, malId, anilistId, altTitles = []) {
        try {
            console.log(`StreamingService: Getting IDs for: ${title} (MAL: ${malId})`);
            
            // 1. Check existing mapping
            const existingMapping = await animeMappingService.getMappingByMalId(malId);
            
            // 2. If we have a working provider, return it
            if (existingMapping && (existingMapping.zoro_id || existingMapping.animepahe_id || existingMapping.animesaturn_id)) {
                console.log('StreamingService: Found existing mapping');
                
                // Optional: Background check to verify if still valid or add missing providers
                if (!existingMapping.zoro_id) {
                    // Use existing DB titles if the passed title is not available
                    const titleToUse = title || existingMapping.title_romaji ||
                                     existingMapping.title_english ||
                                     existingMapping.title_native;

                    // Combine altTitles with any titles from the existing mapping
                    const allAltTitles = [
                        ...altTitles,
                        existingMapping.title_english,
                        existingMapping.title_romaji,
                        existingMapping.title_native,
                        ...(existingMapping.title_synonyms || [])
                    ].filter(Boolean);

                    // Deduplicate altTitles
                    const uniqueAltTitles = [...new Set(allAltTitles)];

                    addToQueue(titleToUse, malId, anilistId, uniqueAltTitles).catch(console.error);
                }

                return animeMappingService.formatMapping(existingMapping, title);
            }

            // 3. If no mapping or missing major IDs, fetch from orchestrator
            console.log('StreamingService: Fetching fresh IDs via Orchestrator');
            const updates = await animeService.fetchAndSaveProviderIds({ title, malId, anilistId, altTitles });
            
            // 4. Return updated mapping
            const updatedMapping = await animeMappingService.getMappingByMalId(malId);
            return animeMappingService.formatMapping(updatedMapping, title);

        } catch (error) {
            console.error('StreamingService Error getting IDs:', error);
            // Return whatever we have
             const fallback = await animeMappingService.getMappingByMalId(malId);
             return animeMappingService.formatMapping(fallback, title);
        }
    }

    /**
     * Get episodes from providers
     */
    async getEpisodeIds(title, malId, anilistId, episodeNumber, preferredProvider, category, altTitles = []) {
        try {
            console.log(`StreamingService.getEpisodeIds: ${title} (MAL: ${malId}, CAT: ${category})`);
            
            // 1. Get raw mapping from DB or Memory Cache
            let rawMapping = await animeMappingService.getMappingByMalId(malId);
            
            // 2. Check if we have any provider IDs
            const hasActiveIds = rawMapping && (rawMapping.animepahe_id || rawMapping.animesaturn_id || rawMapping.animeunity_id);
            const hasAnyIds = hasActiveIds;
            
            // 3. If no IDs at all, fetch synchronously (with concurrent deduplication)
            if (!hasAnyIds) {
                console.log('StreamingService: Resolving provider IDs dynamically...');
                
                // Deduplicate concurrent requests for the same anime
                const fetchKey = `fetch_ids_${malId}`;
                if (!this.activeFetches) this.activeFetches = new Map();
                
                let fetchPromise = this.activeFetches.get(fetchKey);
                if (!fetchPromise) {
                    fetchPromise = animeService.fetchAndSaveProviderIds({ title, malId, anilistId, altTitles, preferredProvider });
                    this.activeFetches.set(fetchKey, fetchPromise);
                    // Clear the promise when done
                    fetchPromise.finally(() => this.activeFetches.delete(fetchKey));
                }
                
                const updates = await fetchPromise;
                
                // Merge these updates manually into our local object
                if (!rawMapping) {
                    rawMapping = { mal_id: malId, anilist_id: anilistId, title: title, ...updates };
                } else {
                    Object.assign(rawMapping, updates);
                }
                
                // Quick re-read from memory cache in case background providers finished during fetchAndSaveProviderIds
                const refreshedMapping = await animeMappingService.getMappingByMalId(malId);
                if (refreshedMapping) {
                    Object.assign(rawMapping, refreshedMapping);
                }
            } 
            // 4. If we have some IDs but missing active ones, trigger background update (if DB up)
            else if (!hasActiveIds && isDBConnected()) {
                console.log('StreamingService: Active provider IDs missing, triggering background update...');
                const dbAltTitles = rawMapping ? [
                    rawMapping.title_english,
                    rawMapping.title_romaji,
                    rawMapping.title_native,
                    ...(rawMapping.title_synonyms || [])
                ].filter(Boolean) : [];

                addToQueue(title, malId, anilistId, dbAltTitles).catch(console.error);
            }

            if (!rawMapping) {
                rawMapping = { mal_id: malId, anilist_id: anilistId, title: title };
            }

            // 4. Pass RAW mapping (not formatted) to getEpisodes
            const targetEpNum = !isNaN(parseInt(episodeNumber)) ? parseInt(episodeNumber) : null;
            const orchestratorResponse = await animeService.getEpisodes(title, malId, rawMapping, preferredProvider, targetEpNum, category, altTitles);
            
            const successfulResults = orchestratorResponse.results || [];

            // Helper to find episode by number (direct) or offset (Season 2+)
            const findEpisodeByNumber = (epList, num) => {
                if (!epList || epList.length === 0) return null;
                const target = parseInt(num);
                
                // 1. Try direct match
                let found = epList.find(e => parseInt(e.number) === target);
                if (found) return found;

                // 2. Try offset match (detect if provider starts at episode X > 1)
                const sorted = [...epList].sort((a,b) => parseInt(a.number) - parseInt(b.number));
                const firstNum = parseInt(sorted[0].number);
                if (firstNum > 1) {
                    const offset = firstNum - 1;
                    found = sorted.find(e => parseInt(e.number) === (target + offset));
                }
                return found;
            };
            
            // We always want to return MegaPlay as a fallback
            const availableProviders = successfulResults.map(r => {
                const ep = findEpisodeByNumber(r.episodes, targetEpNum);
                return {
                    provider: r.provider,
                    episode_id: ep?.id || ep?.episodeId || null,
                    anime_id: r.animeId
                };
            });

            availableProviders.push({
                provider: 'megaplay',
                episode_id: malId,
                anime_id: malId,
                is_embed: true
            });

            if (successfulResults.length === 0) {
                // Try to get altTitles from the DB mapping
                const dbAltTitles = rawMapping ? [
                    rawMapping.title_english,
                    rawMapping.title_romaji,
                    rawMapping.title_native,
                    ...(rawMapping.title_synonyms || [])
                ].filter(Boolean) : [];

                await addToQueue(title, malId, anilistId, dbAltTitles);
                
                // Return MegaPlay as the only provider
                return {
                    provider: 'megaplay',
                    episode_id: malId,
                    anime_id: malId,
                    episodes: [{ id: malId, number: targetEpNum || 1, title: 'Episode ' + (targetEpNum || 1) }],
                    totalEpisodes: 1,
                    is_resolving: true,
                    available_providers: availableProviders
                };
            }

            const bestResult = successfulResults[0];
            const bestEp = findEpisodeByNumber(bestResult.episodes, targetEpNum);

            // Determine if background resolutions are likely still running
            const activeCount = [rawMapping.animepahe_id, rawMapping.animesaturn_id, rawMapping.animeunity_id].filter(Boolean).length;
            
            // isResolving is true if we haven't tried all providers yet, OR if we have very few results
            const isResolving = !orchestratorResponse.isFullyResolved || successfulResults.length < 2; 

            console.log(`StreamingService.getEpisodeIds: Found ${availableProviders.length} providers for ep ${targetEpNum}. isResolving: ${isResolving}`);

            return {
                provider: bestResult.provider,
                episode_id: bestEp?.id || bestEp?.episodeId || null,
                anime_id: bestResult.animeId,
                episodes: bestResult.episodes,
                totalEpisodes: bestResult.totalEpisodes,
                is_resolving: isResolving,
                available_providers: availableProviders
            };

        } catch (error) {
            console.error('StreamingService Error getting episodes:', error);
            return { error: error.message };
        }
    }

    /**
     * Get servers for an episode
     */
    async getServers(provider, episodeId, title = null) {
        return await animeService.getServers(provider, episodeId, title);
    }

    /**
     * Get sources for a server
     */
    async getSources(title, provider, episodeId, serverId, category, animeId, episodeNumber) {
        return await animeService.getSources(title, provider, episodeId, serverId, category, animeId, episodeNumber);
    }
}

module.exports = new StreamingService();