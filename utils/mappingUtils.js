const animeMappingService = require('../services/animeMappingService');
const mangaMappingService = require('../services/mangaMappingService');
const streamingService = require('../services/streamingService');
const mangaService = require('../services/mangaService');
const { isDBConnected } = require('../config/db');

// Removed: zoroService dependency
// Removed: fetchAndSaveZoroId (Logic moved to streamingService/orchestrator)

const getMappingsForMalId = async (title, malId, altTitles = []) => {
    try {
        // If DB is disconnected, return null immediately (fall back to Jikan only)
        if (!isDBConnected()) {
            return null;
        }

        let mapping = await animeMappingService.getMappingByMalId(malId);
        
        // If no mapping exists or critical IDs missing, trigger fetch via service
        // We just call getStreamingIds which handles the orchestration and saving
        if (!mapping || (!mapping.zoro_id && !mapping.animepahe_id)) {
             try {
                const result = await streamingService.getStreamingIds(title, malId, mapping?.anilist_id, altTitles);
                // result is already formatted mapping
                return result;
             } catch (e) {
                console.warn('Failed to auto-fetch IDs in getMappingsForMalId', e);
             }
        }

        return animeMappingService.formatMapping(mapping, title);
    } catch (error) {
        console.error('Error fetching mappings:', error);
        return null;
    }
};

const getMappingsForAllEpisodes = async (title, malId, totalEpisodes, preferredProvider) => {
    try {
        if (!isDBConnected()) return null;

        let mapping = await getMappingsForMalId(title, malId); // Ensures IDs are fetched
        if (!mapping) return null;

        // Note: For "All Episodes", fetching episode-specific IDs for EVERY episode 
        // upfront is expensive with the new multi-provider system if not already cached.
        // Zoro/Consumet usually give us a full list of episodes with IDs in one go.
        
        const eps = await streamingService.getEpisodeIds(title, malId, mapping.anilist_id, null, preferredProvider);
        if (eps.error || !eps.episodes) return {};

        const episodeMappings = {};
        
        // 1. Check if there's a numbering offset (e.g., AnimePahe starts at 13)
        // We compare the provider's first available episode with 1
        const providerEpisodes = [...eps.episodes].sort((a, b) => a.number - b.number);
        const firstEpNum = providerEpisodes.length > 0 ? parseInt(providerEpisodes[0].number) : 1;
        const offset = firstEpNum > 1 ? firstEpNum - 1 : 0;

        if (offset > 0) {
            console.log(`MappingUtils: Detected episode offset of ${offset} for provider ${eps.provider}`);
        }

        // 2. Map episodes
        providerEpisodes.forEach(ep => {
            const num = parseInt(ep.number);
            
            // Map by its actual number
            episodeMappings[num] = {
                episode_id: ep.id || ep.episodeId,
                anime_id: eps.anime_id,
                title: ep.title,
                number: num,
                provider: eps.provider 
            };

            // If there's an offset and this maps to a "Season 1" episode number
            if (offset > 0 && num > offset) {
                const adjustedNum = num - offset;
                // Only provide fallback if the direct mapping for that number doesn't exist
                if (!episodeMappings[adjustedNum]) {
                    episodeMappings[adjustedNum] = {
                        episode_id: ep.id || ep.episodeId,
                        anime_id: eps.anime_id,
                        title: ep.title,
                        number: adjustedNum,
                        provider: eps.provider,
                        original_number: num // Keep track of the real number
                    };
                }
            }
        });

        return episodeMappings;
    } catch (error) {
        console.error('Error fetching all episode mappings:', error);
        return null;
    }
};

const getMappingsForEpisode = async (title, malId, episode, preferredProvider, category, altTitles = []) => {
    try {
        // Fetch base mapping context if DB is available
        // If DB is disconnected, baseMapping will just be null, which is fine
        const baseMapping = isDBConnected() ? await getMappingsForMalId(title, malId) : null;

        const allAltTitles = [
            ...altTitles,
            ...(baseMapping?.title_synonyms || []),
            baseMapping?.title_english
        ].filter(Boolean);

        const episodeData = await streamingService.getEpisodeIds(
            title,
            malId,
            baseMapping?.anilist_id || null, 
            episode,
            preferredProvider,
            category,
            [...new Set(allAltTitles)]
        );

        if (episodeData.error) return null;

        // Calculate total episodes based on the provider's metadata or list
        const providerEpisodes = episodeData.episodes || [];
        const totalFromProvider = episodeData.totalEpisodes || (providerEpisodes.length > 0 
            ? Math.max(...providerEpisodes.map(e => parseInt(e.number) || 0))
            : 0);

        return {
            provider: episodeData.provider,
            episode_id: episodeData.episode_id,
            anime_id: episodeData.anime_id,
            total_episodes: parseInt(totalFromProvider) || 0,
            is_resolving: episodeData.is_resolving,
            available_providers: episodeData.available_providers
        };
    } catch (error) {
        console.error('Error fetching episode mappings:', error);
        return null;
    }
};

const getMangaMappingsForMalId = async (title, malId) => {
    try {
        if (!isDBConnected()) return null;

        let mapping = await mangaMappingService.getMappingByMalId(malId);
        
        // If no mapping exists or mangafire_id is missing, try to resolve IDs
        if (!mapping || !mapping.mangafire_id) {
            try {
                // mangaService.fetchAndSaveProviderIds handles the lookup and saving
                await mangaService.fetchAndSaveProviderIds({ title, malId });
                mapping = await mangaMappingService.getMappingByMalId(malId);
            } catch (e) {
                console.warn('Failed to auto-fetch manga IDs in getMangaMappingsForMalId', e);
            }
        }

        return mangaMappingService.formatMapping(mapping, title);
    } catch (error) {
        console.error('Error fetching manga mappings:', error);
        return null;
    }
};

module.exports = {
    getMappingsForAllEpisodes,
    getMappingsForEpisode,
    getMappingsForMalId,
    getMangaMappingsForMalId
};