const { jikanFunctions } = require('../utils/jikanUtils');
const anilistUtils = require('../utils/anilistUtils');
const themesUtils = require('../utils/themesUtils');
const aniScheduleUtils = require('../utils/aniScheduleUtils');
const syncService = require('../services/syncService');
const animeMappingService = require('../services/animeMappingService');
const streamingService = require('../services/streamingService');
const { getMappingsForMalId, getMappingsForAllEpisodes, getMappingsForEpisode } = require('../utils/mappingUtils');
const { addToQueue } = require('../services/queueService');
const { isDBConnected } = require('../config/db');
const { DIRECT_CDN_DOMAINS } = require('../utils/fetchUtils');
const aniSkipUtils = require('../utils/aniSkipUtils');
const NodeCache = require('node-cache');

const episodeIdCache = new NodeCache({ stdTTL: 86400 }); // Episode IDs are stable, 24hr
const serverCache = new NodeCache({ stdTTL: 300 });       // Servers, 5 min
const sourceCache = new NodeCache({ stdTTL: 180 });       // Sources/URLs, 3 min max
const watchCache = new NodeCache({ stdTTL: 3600 });       // Legacy/General, 1hr

const search = async (req, res, next) => {
    const { query, page, limit, provider, ...filters } = req.query;

    try {
        // If a provider is specified, search directly via that provider
        if (provider) {
            const normalizedProvider = provider.toLowerCase();
            const providerMap = {
                animepahe: () => require('../services/anime/animepahe').search(query, page),
                animesaturn: () => require('../services/anime/consumet').search('animesaturn', query, page),
                animeunity: () => require('../services/anime/consumet').search('animeunity', query, page),
            };

            const searchFn = providerMap[normalizedProvider];
            if (!searchFn) {
                return res.status(400).json({
                    error: 'Invalid provider',
                    message: `Provider "${provider}" not found. Available: ${Object.keys(providerMap).join(', ')}`
                });
            }

            try {
                const results = await searchFn();
                return res.json({
                    provider: normalizedProvider,
                    data: results?.results || results || []
                });
            } catch (providerErr) {
                return res.status(502).json({
                    error: `Provider "${normalizedProvider}" search failed`,
                    message: providerErr.message
                });
            }
        }

        // Handle flags like ?unapproved
        if (filters.unapproved === '' || filters.unapproved === 'true') filters.unapproved = true;
        if (filters.sfw === '' || filters.sfw === 'true') filters.sfw = true;

        // Default: Jikan search with optional DB enhancement
        const searchResults = await jikanFunctions.search('anime', query, limit, { page, ...filters });
        const malIds = searchResults.data.map(anime => anime.mal_id);
        
        // Get existing mappings from DB (fast)
        let mappingsMap = {};
        if (isDBConnected()) {
            try {
                mappingsMap = await animeMappingService.getMappingsByMalIds(malIds);
                
                // Queue missing IDs for background processing (non-blocking)
                searchResults.data.forEach(anime => {
                    const mapping = mappingsMap[anime.mal_id];
                    // Queue if no provider IDs exist
                    if (!mapping?.animepahe_id) {
                        const altTitles = [anime.title_english, ...(anime.title_synonyms || [])].filter(Boolean);
                        addToQueue(anime.title, anime.mal_id, mapping?.anilist_id, altTitles).catch(err => 
                            console.error(`Post-search queue error for ${anime.title}:`, err.message)
                        );
                    }
                });
            } catch (dbErr) {
                console.warn('AnimeController: DB error during search mappings. Skipping enhancement.', dbErr.message);
            }
        }

        // Format results with whatever we have (immediate response)
        const enhancedResults = searchResults.data.map(anime => ({
            ...anime,
            external_ids: animeMappingService.formatMapping(
                mappingsMap[anime.mal_id], 
                anime.title
            )
        }));

        res.json({
            ...searchResults,
            data: enhancedResults
        });

    } catch (error) {
        console.error('Search error:', error.message);
        if (error.message.includes('Service Unavailable') || error.message.includes('maintenance')) {
            return res.status(503).json({
                error: 'Service Unavailable',
                message: 'The metadata provider (Jikan) is currently down for maintenance.'
            });
        }
        next(error);
    }
};
const getAnime = async (req, res, next) => {
    const { id } = req.params;
    let animeData = null;
    let altTitles = [];

    try {
        animeData = await jikanFunctions.loadAnime(id);
        altTitles = [
            animeData?.data?.title_english, 
            ...(animeData?.data?.title_synonyms || [])
        ].filter(Boolean);
    } catch (jikanError) {
        console.warn(`Jikan failed for anime ${id}, falling back to database mappings:`, jikanError.message);
    }

    try {
        const mappings = await getMappingsForMalId(animeData?.data?.title || null, id, altTitles);

        if (!animeData && (!mappings || mappings.error)) {
            return res.status(404).json({ 
                error: 'Not Found', 
                message: 'Anime not found in Jikan or database' 
                // Removed redundant jikan downtime message here as it's handled in catch block if it actually failed
            });
        }

        // Combine the data
        const enhancedData = animeData ? {
            ...animeData,
            external_ids: mappings || { mal_id: id }
        } : {
            data: { mal_id: id, title: mappings?.title || 'Unknown Title' },
            external_ids: mappings || { mal_id: id },
            fallback: true,
            warning: 'Title and details may be incomplete because the metadata provider (Jikan) is currently unreachable.'
        };

        res.json(enhancedData);
    } catch (error) {
        console.error('getAnime error:', error.message);
        if (error.message.includes('Service Unavailable') || error.message.includes('maintenance') || error.message.includes('Failed to load anime')) {
            return res.status(503).json({
                error: 'Service Unavailable',
                message: 'The metadata provider (Jikan) is currently down for maintenance. Please try again later.'
            });
        }
        next(error);
    }
};



const getAnimeFull = async (req, res, next) => {
    const { id } = req.params;
    let animeData = null;
    let altTitles = [];

    // 1. Fetch Jikan Full (Primary Data)
    try {
        animeData = await jikanFunctions.loadAnime(id, 'full');
        altTitles = [
            animeData?.data?.title_english, 
            ...(animeData?.data?.title_synonyms || [])
        ].filter(Boolean);
    } catch (jikanError) {
        console.warn(`Jikan failed for full anime ${id}, falling back to database mappings:`, jikanError.message);
    }

    try {
        // Find internal mappings for IDs
        const mappings = await getMappingsForMalId(animeData?.data?.title || null, id, altTitles);

        if (!animeData && !mappings) {
            return res.status(404).json({ 
                error: 'Not Found', 
                message: 'Anime not found in Jikan or database' 
            });
        }

        // 2. Enrichment Orchestration with Timeout (1.5s)
        const timeoutMs = 8000;
        const withTimeout = (promise, ms, name) => {
            return Promise.race([
                promise,
                new Promise(resolve => setTimeout(() => {
                    console.warn(`Enrichment: ${name} timed out after ${ms}ms`);
                    resolve({ __timeout: true });
                }, ms))
            ]);
        };

        // Fire extra sources in parallel, ensuring a crash in one doesn't break the whole request
        const [anilist, themes] = await Promise.all([
            withTimeout(anilistUtils.fetchDetailsByMalId(id), timeoutMs, 'AniList').catch(err => {
                console.warn('AniList Enrichment failed:', err.message);
                return null;
            }),
            withTimeout(themesUtils.fetchThemesByMalId(id), timeoutMs, 'AnimeThemes').catch(err => {
                console.warn('AnimeThemes Enrichment failed:', err.message);
                return null;
            })
        ]);

        // 3. Combine the data
        const enrichment = {
            anilist: anilist?.__timeout ? null : anilist,
            themes: themes?.__timeout ? null : themes,
            meta: {
                anilist_timeout: !!anilist?.__timeout,
                themes_timeout: !!themes?.__timeout
            }
        };

        const enhancedData = animeData ? {
            ...animeData,
            external_ids: mappings || { mal_id: id },
            enrichment
        } : {
            data: { mal_id: id, title: mappings?.title || 'Unknown Title' },
            external_ids: mappings || { mal_id: id },
            enrichment,
            fallback: true,
            warning: 'Title and details may be incomplete because the metadata provider (Jikan) is currently unreachable.'
        };

        res.json(enhancedData);
    } catch (error) {
        console.error('getAnimeFull error:', error);
        next(error);
    }
};

const getAnimeEpisode = async (req, res, next) => {
    const { id, episode } = req.params;

    if (episode && isNaN(episode) && episode !== 'episodes') {
        return res.status(400).json({ error: 'Invalid episode number' });
    }

    let animeInfo = null;
    let episodesData = null;

    try {
        const { page } = req.query;
        // Get anime info and episodes in parallel
        [animeInfo, episodesData] = await Promise.all([
            jikanFunctions.loadAnime(id),
            jikanFunctions.loadAnime(id, 'episodes', episode && episode !== 'episodes' ? parseInt(episode) : { page })
        ]);
    } catch (jikanError) {
        console.warn(`Jikan failed for anime ${id}, falling back to available mappings:`, jikanError.message);
    }

    try {
        if (episode && episode !== 'episodes') {
            // Single episode case
            const episodeMappings = await getMappingsForEpisode(
                animeInfo?.data?.title || null,
                id,
                episode,
                req.query.provider // Pass provider preference
            );

            const enhancedData = episodesData ? {
                ...episodesData,
                episode_mappings: episodeMappings || {}
            } : {
                data: { mal_id: id, number: parseInt(episode) },
                episode_mappings: episodeMappings || {},
                fallback: true,
                warning: 'Metadata for this episode is sparse because Jikan is currently unreachable.'
            };

            res.json(enhancedData);
        } else {
            // All episodes case
            const totalEpisodes = episodesData?.data?.length || 0;
            const episodeMappings = await getMappingsForAllEpisodes(
                animeInfo?.data?.title || null,
                id,
                totalEpisodes,
                req.query.provider // Propagate provider preference
            );

            if (episodesData) {
                const enhancedEpisodes = episodesData.data.map(episode => ({
                    ...episode,
                    episode_mappings: episodeMappings?.[episode.mal_id] || {}
                }));

                res.json({
                    ...episodesData,
                    data: enhancedEpisodes
                });
            } else if (episodeMappings) {
                // If Jikan failed but we have episode mappings, return what we have
                res.json({
                    data: Object.values(episodeMappings).map(m => ({
                        mal_id: m.number,
                        number: m.number,
                        title: m.title
                    })),
                    episode_mappings: episodeMappings,
                    fallback: true
                });
            } else {
                throw new Error('Could not fetch episode data from Jikan or internal mappings');
            }
        }
    } catch (error) {
        console.error('getAnimeEpisode error:', error);
        next(error);
    }
};

// Not worth it. At least for now.
// const getStreamingLinks = async (req, res, next) => {
//     const { malId, episode } = req.query; // Expecting malId and optional episode to be passed in the query

//     try {
//         // Fetch mappings for the provided malId
//         const mappings = await getMappingsForMalId(null, malId); // Title is not needed here

//         // Extract Gogo and Zoro IDs from mappings
//         const gogoId = mappings?.gogo_id;
//         const zoroId = mappings?.zoro_id;

//         let gogoLinks, zoroLinks;

//         if (episode) {
//             // Fetch episode-specific mappings
//             const episodeMappings = await getMappingsForEpisode(mappings?.title, malId, episode);
//             gogoLinks = await fetchStreamingLinks("gogo", episodeMappings?.gogo_episode_id);
//             zoroLinks = await fetchStreamingLinks("zoro", episodeMappings?.zoro_episode_id);
//         } else {
//             // Fetch streaming links for the entire anime
//             gogoLinks = await fetchStreamingLinks("gogo", gogoId);
//             zoroLinks = await fetchStreamingLinks("zoro", zoroId);
//         }

//         // Combine the results
//         const combinedLinks = {
//             gogo: gogoLinks,
//             zoro: zoroLinks
//         };

//         res.json(combinedLinks);
//     } catch (error) {
//         console.error(error);
//         next(error);
//     }
// };

const getStreamingServers = async (req, res, next) => {
    const { episodeId, provider } = req.query;
    try {
        const servers = await streamingService.getServers(provider || 'animepahe', episodeId);
        res.json(servers);
    } catch (error) {
        console.error(error);
        next(error);
    }
};

const getStreamingSources = async (req, res, next) => {
    const { episodeId, server, category, provider, animeId, title, episode } = req.query;
    try {
        const sources = await streamingService.getSources(title, provider || 'animepahe', episodeId, server, category, animeId, episode);
        res.json(sources);
    } catch (error) {
        console.error(error);
        next(error);
    }
};

const getEpisodeWatchData = async (req, res, next) => {
    const { id, episode } = req.params;
    const { provider, category = 'sub' } = req.query;

    const idCacheKey = `epid_${id}_${episode}_${provider || 'auto'}`;
    const serverCacheKey = `srv_${id}_${episode}_${provider || 'auto'}`;
    const sourceCacheKey = `src_${id}_${episode}_${provider || 'auto'}_${category}`;

    // 1. Try Source Cache First (Short TTL for expiring URLs)
    const cachedSource = sourceCache.get(sourceCacheKey);
    if (cachedSource) {
        console.log(`[getEpisodeWatchData] Serving cached sources for ${sourceCacheKey}`);
        return res.json(cachedSource);
    }

    try {
        // 2. Metadata Lookups (Sequential for Jikan to avoid redundant DB+Jikan calls)
        let dbMapping = isDBConnected() ? await animeMappingService.getMappingByMalId(id).catch(() => null) : null;
        let jikanInfo = null;

        if (!dbMapping || (!dbMapping.title_english && !dbMapping.title_romaji)) {
             // Request 'full' to precisely match the cache key of the frontend's getAnimeDetail call
             jikanInfo = await jikanFunctions.loadAnime(id, 'full').catch(() => null);
        }

        // Accept title from frontend query as an absolute last resort
        const fallbackTitle = req.query.title ? req.query.title.replace(/-/g, ' ') : null;
        let title = dbMapping?.title_romaji || dbMapping?.title_english || dbMapping?.title || jikanInfo?.data?.title || fallbackTitle;
        
        // Collect ALL possible titles for the orchestrator to maximize hit rate
        const allTitles = new Set([
            title,
            dbMapping?.title_english,
            dbMapping?.title_romaji,
            dbMapping?.title_native,
            jikanInfo?.data?.title,
            jikanInfo?.data?.title_english,
            jikanInfo?.data?.title_japanese,
            ...(dbMapping?.title_synonyms || []),
            ...(jikanInfo?.data?.title_synonyms || []),
            ...(jikanInfo?.data?.titles?.map(t => t.title) || [])
        ]);
        
        let altTitles = Array.from(allTitles).filter(Boolean);
        
        // 2b. Generate "Clean Numbered" variations for picky providers (e.g. "Title 4" instead of "Title Season 4")
        const numberedVariations = [];
        altTitles.forEach(t => {
            const clean = t.replace(/(?:\s+(?:Season\s+\d+|\d+(?:st|nd|rd|th)\s+Season|\d+\s+Season|Season))/i, match => {
                const num = match.match(/\d+/);
                return num ? ' ' + num[0] : '';
            }).trim();
            
            if (clean !== t) {
                numberedVariations.push(clean);
                // Also add a variant without the number if it was just "Season"
                if (!clean.match(/\d/)) numberedVariations.push(clean);
            }
        });
        altTitles = [...new Set([...numberedVariations, ...altTitles])];
        console.log(`[Normalizer Debug] Final altTitles for MAL ${id}:`, altTitles);

        // 3. Resolve Episode Mapping (Check Cache First)
        let episodeMappings = episodeIdCache.get(idCacheKey);
        if (!episodeMappings) {
            episodeMappings = await getMappingsForEpisode(
                title,
                id,
                episode,
                provider,
                category,
                altTitles
            );
             if (episodeMappings) {
                const providerCount = episodeMappings.available_providers?.length || 0;
                const isResolving = episodeMappings.is_resolving;
                // Cache for 24h if we have at least 2 providers and not resolving.
                // Otherwise, short TTL to allow finding more.
                const ttl = (!isResolving && providerCount >= 2) ? 86400 : (isResolving ? 2 : 60);
                episodeIdCache.set(idCacheKey, episodeMappings, ttl);
                console.log(`[getEpisodeWatchData] Mappings for ${id} ep ${episode}: Found ${providerCount} providers. isResolving: ${isResolving}, TTL: ${ttl}`);
            }
        }

        if (!episodeMappings) {
            return res.status(404).json({ error: 'Episode not found or no mappings available' });
        }
        
        if (req.query.poll === 'true') {
             return res.json({
                 title: title,
                 episode_mappings: episodeMappings,
                 servers: null,
                 sources: null
             });
        }

        const availableProviders = episodeMappings.available_providers || [];
        const initialBestProvider = episodeMappings.provider;
        
        // Reorder providers to try the preferred/best one first
        const providersToTry = [
            availableProviders.find(p => p.provider === initialBestProvider),
            ...availableProviders.filter(p => p.provider !== initialBestProvider)
        ].filter(Boolean);

        let finalServers = null;
        let finalSources = null;
        let usedProvider = null;

        for (const provData of providersToTry) {
            const currentProvider = provData.provider;
            const currentEpisodeId = provData.episode_id;
            const currentAnimeId = provData.anime_id;
            
            if (!currentEpisodeId) continue;

            console.log(`[getEpisodeWatchData] Attempting provider: ${currentProvider}`);

            // 4. Get Servers (Check Cache First)
            const provServerCacheKey = `servers_${currentProvider}_${currentEpisodeId}`;
            let servers = serverCache.get(provServerCacheKey);
            if (!servers) {
                servers = await streamingService.getServers(currentProvider, currentEpisodeId, title).catch(() => null);
                if (servers) {
                    serverCache.set(provServerCacheKey, servers);
                }
            }

            if (!servers) {
                console.warn(`[getEpisodeWatchData] Provider ${currentProvider} returned no servers, trying next...`);
                continue;
            }

            // 5. Get Sources
            let sources = null;
            let serverList = [];
            if (Array.isArray(servers)) {
                serverList = servers;
            } else {
                serverList = category === 'dub' ? (servers.dub || []) : (servers.sub || []);
                if (serverList.length === 0) {
                    serverList = category === 'dub' ? (servers.sub || []) : (servers.dub || []);
                }
            }

            if (serverList.length > 0) {
                const bestServer = serverList.find(s => s.name?.toLowerCase() === 'hd-1' || s.name?.toLowerCase() === 'kwik') || serverList[0];
                const sId = bestServer.serverId || bestServer.id || bestServer.name;
                
                try {
                    sources = await streamingService.getSources(title, currentProvider, currentEpisodeId, sId, category, currentAnimeId, episode);
                    if (sources && (sources.sources?.length > 0 || sources.isEmbed)) {
                        sources = { ...sources };
                        sources.activeServer = bestServer;
                        
                        // Success!
                        finalSources = sources;
                        usedProvider = currentProvider;

                        // Create a safe copy of servers to modify
                        let serversToReturn = JSON.parse(JSON.stringify(servers));
                        
                        // Dynamic Sub/Dub pill discovery
                        // If sources indicate presence of a category but it's missing from servers list, inject it
                        if (Array.isArray(serversToReturn)) {
                            const hasSub = serversToReturn.some(s => s.cat === 'sub');
                            const hasDub = serversToReturn.some(s => s.cat === 'dub');
                            if (sources.hasSub && !hasSub) serversToReturn.push({ ...bestServer, cat: 'sub' });
                            if (sources.hasDub && !hasDub) serversToReturn.push({ ...bestServer, cat: 'dub' });
                        } else if (serversToReturn && typeof serversToReturn === 'object') {
                            if (sources.hasSub && (!serversToReturn.sub || serversToReturn.sub.length === 0)) {
                                serversToReturn.sub = [bestServer];
                            }
                            if (sources.hasDub && (!serversToReturn.dub || serversToReturn.dub.length === 0)) {
                                serversToReturn.dub = [bestServer];
                            }
                        }
                        finalServers = serversToReturn;
                        
                        // Update mapping's default provider to this one if it wasn't the first
                        if (usedProvider !== initialBestProvider) {
                            console.log(`[getEpisodeWatchData] Fallback successful! Switched to ${usedProvider}`);
                            episodeMappings.provider = usedProvider;
                            episodeMappings.episode_id = currentEpisodeId;
                            episodeMappings.anime_id = currentAnimeId;
                        }
                        break; 
                    }
                } catch (sourceErr) {
                    console.warn(`[getEpisodeWatchData] Provider ${currentProvider} source fetch failed: ${sourceErr.message}`);
                }
            }
            
            if (!finalSources) {
                console.warn(`[getEpisodeWatchData] Provider ${currentProvider} failed to yield sources, trying next...`);
            }
        }

        const responseData = {
            title: title,
            episode_mappings: episodeMappings,
            servers: finalServers,
            sources: finalSources
        };

        // Normalize and proxy download links for consistent behavior
        if (responseData.sources?.downloads) {
            const KATALYST_BASE = `${req.protocol}://${req.get('host')}/api/stream/segment`;
            const host = req.get('host');
            const cleanedDownloads = responseData.sources.downloads.map(dl => {
                // Prioritize direct URL over shortener
                let rawUrl = dl.url || dl.pahe;
                if (!rawUrl) return null;

                // ULTRA-STRICT: Prevent double-proxying at all costs
                const isAlreadyProxied = rawUrl.includes('/api/stream/segment') || 
                                         rawUrl.includes(host);
                
                if (isAlreadyProxied) {
                    dl.url = rawUrl;
                    if (dl.pahe && rawUrl.includes('url=')) dl.pahe = null;
                    return dl;
                }

                // Identify direct CDN links that require proxying for CORS/Referrer
                const isDirectCDN = DIRECT_CDN_DOMAINS.some(domain => rawUrl.includes(domain));

                if (isDirectCDN) {
                    const encodedUrl = encodeURIComponent(rawUrl);
                    const filename = encodeURIComponent(dl.filename || `${title}_Ep${episode}.mp4`);
                    dl.url = `${KATALYST_BASE}?url=${encodedUrl}&download=true&filename=${filename}`;
                    if (dl.pahe) dl.pahe = null;
                    return dl;
                } 

                // If it's a pahe.win shortener and we couldn't resolve a direct link, DROP IT.
                // We do not want to serve sketchy ad-links to users.
                if (rawUrl.includes('pahe.win')) {
                    return null;
                }

                // If it's some other safe link, let it through
                dl.url = rawUrl;
                return dl;
            }).filter(Boolean); // Remove null entries

            responseData.sources.downloads = cleanedDownloads;
        }

        // Cache the result in Source Cache (Short TTL)
        if (finalSources || finalServers) {
            const isResolving = responseData.episode_mappings?.is_resolving;
            const provCount = responseData.episode_mappings?.available_providers?.length || 0;
            // If we have sources and at least 2 providers, we can cache longer.
            const srcTtl = isResolving ? 2 : (provCount >= 2 ? 300 : 30);
            sourceCache.set(sourceCacheKey, responseData, srcTtl);
            console.log(`[getEpisodeWatchData] Sources for ${id} ep ${episode}: Provider ${usedProvider || initialBestProvider}, Sources: ${finalSources?.sources?.length || 0}, TTL: ${srcTtl}`);
        }

        res.json(responseData);
    } catch (error) {
        console.error('getEpisodeWatchData error:', error);
        next(error);
    }
};

// Legacy support - Map to new services
const getZoroServers = async (req, res, next) => {
    req.query.provider = 'animepahe';
    await getStreamingServers(req, res, next);
};

const getZoroStreamingLinks = async (req, res, next) => {
    req.query.provider = 'animepahe';
    await getStreamingSources(req, res, next);
};

const loadWatch = async (req, res, next) => {
    const { type } = req.params; 
    const { page, limit, popular } = req.query;

    // Validate page and limit
    if (page && isNaN(page) || page < 1) {
        return res.status(400).json({ error: 'Invalid page number' });
    }
    if (limit && isNaN(limit) || limit < 1) {
        return res.status(400).json({ error: 'Invalid limit number' });
    }

    try {
        const watchData = await jikanFunctions.loadWatch(type, popular, { page, limit }); 
        res.json(watchData); 
    } catch (error) {
        console.error(error);
       next(error); 
    }
};

const getAnimeRecommendations = async (req, res, next) => {
    const { page } = req.query;
    const { id } = req.params;

    try {
        if (id) {
            const recommendations = await jikanFunctions.loadAnime(id, 'recommendations', { page });
            res.json(recommendations);
        } else {
            const recommendations = await jikanFunctions.loadRecommendations('anime', page);
            res.json(recommendations);
        }
    } catch (error) {
        console.error(error);
       next(error);
    }
};

const getAnimeRelations = async (req, res, next) => {
    const { id } = req.params;

    try {
        const relations = await jikanFunctions.loadAnime(id, 'relations');
        res.json(relations);
    } catch (error) {
        console.error(error);
       next(error);
    }
};

const getAnimeThemes = async (req, res, next) => {
    const { id } = req.params;

    try {
        const themes = await themesUtils.fetchThemesByMalId(id);
        if (!themes) {
            // Fallback to Jikan themes if our enhanced service doesn't have it
            const fallback = await jikanFunctions.loadAnime(id, 'themes');
            return res.json(fallback);
        }
        res.json(themes);
    } catch (error) {
        console.error('getAnimeThemes error:', error.message);
        if (error.message.includes('Service Unavailable') || error.message.includes('maintenance')) {
            return res.status(503).json({
                error: 'Service Unavailable',
                message: 'The metadata provider (Jikan) is currently down for maintenance. Detailed themes are currently unavailable.'
            });
        }
        next(error);
    }
};

const getFeaturedTheme = async (req, res, next) => {
    try {
        let featured = await themesUtils.fetchFeaturedTheme();
        
        // Fallback: If the official featured theme endpoint is failing or empty, 
        // use the most recently added theme as it often corresponds to the current featured theme.
        if (!featured) {
            console.log('AnimeController: Featured theme endpoint failed or empty, using latest New theme as fallback.');
            const newThemes = await themesUtils.fetchNewThemes(1);
            if (newThemes && newThemes.length > 0) {
                featured = newThemes[0];
            }
        }

        if (!featured) return res.status(404).json({ error: 'Featured theme not found' });
        res.json(featured);
    } catch (error) {
        console.error('getFeaturedTheme error:', error.message);
        if (error.message.includes('Service Unavailable') || error.message.includes('maintenance')) {
            return res.status(503).json({
                error: 'Service Unavailable',
                message: 'The metadata provider (Jikan) is down for maintenance.'
            });
        }
        next(error);
    }
};

const getPopularThemes = async (req, res, next) => {
    try {
        const { limit = 10, page = 1 } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = parseInt(limit);
        // 1. Get top anime from Jikan with page support
        const topAnime = await jikanFunctions.loadTop('anime', { limit: limitNum, page: pageNum, filter: 'bypopularity' });
        
        // 2. Fetch themes for each top anime
        const themesResults = await Promise.all(
            topAnime.data.map(async (anime) => {
                try {
                    return await themesUtils.fetchThemesByMalId(anime.mal_id);
                } catch (err) {
                    return null;
                }
            })
        );

        const filtered = themesResults.filter(Boolean);
        res.json({
            data: filtered,
            pagination: {
                current_page: pageNum,
                has_next_page: topAnime.pagination?.has_next_page || false,
                last_visible_page: topAnime.pagination?.last_visible_page || 1
            },
            meta: {
                count: filtered.length,
                limit: limitNum
            }
        });
    } catch (error) {
        console.error('getPopularThemes error:', error.message);
        if (error.message.includes('Service Unavailable') || error.message.includes('maintenance') || error.message.includes('Failed to load top')) {
            return res.status(503).json({
                error: 'Service Unavailable',
                message: 'The metadata provider (Jikan) is currently down for maintenance. Popularity data is currently unavailable.'
            });
        }
        next(error);
    }
};

const getNewThemes = async (req, res, next) => {
    try {
        const { limit = 10, page = 1 } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = parseInt(limit);
        // Fetch a larger batch and paginate locally since AnimeThemes API doesn't have native page param for new themes
        const totalNeeded = pageNum * limitNum;
        const allThemes = await themesUtils.fetchNewThemes(totalNeeded);
        const start = (pageNum - 1) * limitNum;
        const pageData = allThemes.slice(start, start + limitNum);
        res.json({
            data: pageData,
            pagination: {
                current_page: pageNum,
                has_next_page: allThemes.length >= totalNeeded,
                last_visible_page: Math.max(1, Math.ceil(allThemes.length / limitNum))
            },
            meta: {
                count: pageData.length,
                limit: limitNum
            }
        });
    } catch (error) {
        console.error('getNewThemes error:', error);
        next(error);
    }
};

const searchThemes = async (req, res, next) => {
    try {
        const { q, query, limit = 20, page = 1 } = req.query;
        const searchTerm = q || query;
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = parseInt(limit);

        if (!searchTerm) {
            return res.status(400).json({ error: 'Search query (q) is required' });
        }

        const totalNeeded = pageNum * limitNum;
        const results = await themesUtils.searchThemes(searchTerm, totalNeeded);
        const start = (pageNum - 1) * limitNum;
        const pageData = results.slice(start, start + limitNum);
        
        res.json({
            data: pageData,
            pagination: {
                current_page: pageNum,
                has_next_page: results.length >= totalNeeded,
                last_visible_page: Math.max(1, Math.ceil(results.length / limitNum))
            },
            meta: {
                count: pageData.length,
                query: searchTerm,
                limit: limitNum
            }
        });
    } catch (error) {
        console.error('searchThemes error:', error.message);
        next(error);
    }
};

const getArtistThemes = async (req, res, next) => {
    try {
        const { slug } = req.params;
        const artistInfo = await themesUtils.fetchArtistInfo(slug);
        
        if (!artistInfo) {
            return res.status(404).json({ error: 'Artist not found or Animethemes API failed' });
        }
        res.json(artistInfo);
    } catch (error) {
        console.error('getArtistThemes error:', error.message);
        next(error);
    }
};

const getBatchThemes = async (req, res, next) => {
    try {
        const { slugs } = req.query;
        if (!slugs) {
            return res.json([]);
        }
        const slugList = String(slugs).split(',').filter(Boolean);
        const themes = await themesUtils.fetchThemesBySlugs(slugList, true);
        res.json(themes);
    } catch (error) {
        console.error('getBatchThemes error:', error.message);
        next(error);
    }
};

const getSeasonalThemes = async (req, res, next) => {
    try {
        const { year, season, page = 1, limit = 24 } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = parseInt(limit);
        
        // Default to current year and season if not provided
        const now = new Date();
        const y = year || now.getFullYear();
        let s = season;
        
        if (!s) {
            const month = now.getMonth() + 1; // 1-indexed
            if (month >= 1 && month <= 3) s = 'winter';
            else if (month >= 4 && month <= 6) s = 'spring';
            else if (month >= 7 && month <= 9) s = 'summer';
            else s = 'fall';
        }

        const themes = await themesUtils.fetchSeasonalThemes(y, s);
        const start = (pageNum - 1) * limitNum;
        const pageData = themes.slice(start, start + limitNum);
        res.json({
            year: y,
            season: s,
            data: pageData,
            pagination: {
                current_page: pageNum,
                has_next_page: start + limitNum < themes.length,
                last_visible_page: Math.max(1, Math.ceil(themes.length / limitNum))
            }
        });
    } catch (error) {
        console.error('getSeasonalThemes error:', error);
        next(error);
    }
};

const getAniListDetails = async (req, res, next) => {
    const { id } = req.params;
    try {
        const details = await anilistUtils.fetchDetailsByMalId(id);
        if (!details) return res.status(404).json({ error: 'AniList entry not found' });
        res.json(details);
    } catch (error) {
        console.error('getAniListDetails error:', error);
        next(error);
    }
};

const getAnimeNews = async (req, res, next) => {
    const { id } = req.params;

    try {
        const { page } = req.query;
        const news = await jikanFunctions.loadAnime(id, 'news', { page });
        res.json(news);
    } catch (error) {
        console.error(error);
       next(error);
    }
};

const getAnimeForum = async (req, res, next) => {
    const { id } = req.params;

    try {
        const forum = await jikanFunctions.loadAnime(id, 'forum');
        res.json(forum);
    } catch (error) {
        console.error(error);
       next(error);
    }
};

const getAnimeVideos = async (req, res, next) => {
    const { id } = req.params;

    try {
        const videos = await jikanFunctions.loadAnime(id, 'videos');
        res.json(videos);
    } catch (error) {
        console.error(error);
       next(error);
    }
};

const getAnimeVideosepisodes = async (req, res, next) => {
    const { id } = req.params;

    try {
        const videos = await jikanFunctions.loadAnime(id, 'videosepisodes');
        res.json(videos);
    } catch (error) {
        console.error(error);
       next(error);
    }
};

const getAnimeMoreinfo = async (req, res, next) => {
    const { id } = req.params;

    try {
        const moreInfo = await jikanFunctions.loadAnime(id, 'moreinfo');
        res.json(moreInfo);
    } catch (error) {
        console.error(error);
       next(error);
    }  
};  

const getAnimeUserupdates = async (req, res, next) => {
    const { id } = req.params;

    try {
        const { page } = req.query;
        const userUpdates = await jikanFunctions.loadAnime(id, 'userupdates', { page });
        res.json(userUpdates);
    } catch (error) {
        console.error(error);
       next(error);
    }
};

const getAnimeExternal = async (req, res, next) => {
    const { id } = req.params;

    try {
        const external = await jikanFunctions.loadAnime(id, 'external');
        res.json(external);
    } catch (error) {
        console.error(error);
       next(error);
    }
};

const getAnimePictures = async (req, res, next) => {
    const { id } = req.params;
    try {
        const pictures = await jikanFunctions.loadAnime(id, 'pictures');
        res.json(pictures);
    } catch (error) {
        console.error(error);
       next(error);
    }
};

const getAnimeGenres = async (req, res, next) => {
    try {
        const { filter } = req.query;
        if (filter) {
            const genres = await jikanFunctions.loadGenres('anime', filter);
            return res.json(genres);
        }

        const genres = await jikanFunctions.loadGenres('anime');
        res.json(genres);
    } catch (error) {
        console.error(error);
       next(error);
    }
};

const getAnimeCharacter = async (req, res, next) => {
    const { id } = req.params;
    try {
        const characters = await jikanFunctions.loadAnime(id, 'characters');
        res.json(characters);
    } catch (error) {
        console.error(error);
       next(error);
    }
};

const getAnimeStaff = async (req, res, next) => {
    const { id } = req.params;
    try {
        const personData = await jikanFunctions.loadAnime(id, 'staff');
        res.json(personData); 
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch person data' });
    }
};

const getAnimeReviews = async (req, res, next) => {
    const { id } = req.params;
    try {
        const { page } = req.query;
        const reviews = await jikanFunctions.loadAnime(id, 'reviews', { page });
        res.json(reviews);
    } catch (error) {
        console.error(error);
       next(error);
    }
};

const getRecentAnimeReviews = async (req, res, next) => {
    const { page, preliminary, spoiler } = req.query; 

    try {
        const reviews = await jikanFunctions.loadReviews('anime', page, preliminary, spoiler);
        res.json(reviews);
    } catch (error) {
        console.error(error);
       next(error);
    }
};

const getAnimeSchedule = async (req, res, next) => {
    const { page, limit, kids, sfw, unapproved } = req.query;
    const { day } = req.params;
    try {
        // Trigger background sync for airing list (lightweight, once every 12h)
        syncService.syncAiringAnime();

        let schedule = null;
        
        // 1. Try AniSchedule first (Lightweight, no rate limits, better timestamps)
        try {
            schedule = await aniScheduleUtils.getScheduleByDay(day);
        } catch (err) {
            console.warn('AniSchedule failed, falling back to Jikan:', err.message);
        }

        // 2. Fallback to Jikan if AniSchedule failed or returned nothing
        if (!schedule || !schedule.data || schedule.data.length === 0) {
            schedule = await jikanFunctions.loadSchedule(day, page, limit, kids, sfw, unapproved);
        }
        
        // Enhance with mappings
        const enhancedResults = await Promise.all(
            schedule.data.map(async (anime) => {
                const mappings = await getMappingsForMalId(anime.title, anime.mal_id);
                return {
                    ...anime,
                    external_ids: mappings || { mal_id: anime.mal_id }
                };
            })
        );

        res.json({
            ...schedule,
            data: enhancedResults,
            source: schedule.source || (schedule.data.length > 0 && schedule.data[0].airing_info ? 'AniSchedule' : 'Jikan')
        });
    } catch (error) {
        console.error('getAnimeSchedule error:', error);
        next(error);
    }
};

const getRandomAnime = async (req, res, next) => {
    try {
        const randomAnime = await jikanFunctions.loadRandom('anime');
        const mappings = await getMappingsForMalId(randomAnime.data.title, randomAnime.data.mal_id);
        
        const enhancedData = {
            ...randomAnime,
            data: {
                ...randomAnime.data,
                external_ids: mappings || { mal_id: randomAnime.data.mal_id }
            }
        };
        
        res.json(enhancedData);
    } catch (error) {
        console.error(error);
       next(error);
    }
}

const getTopAnime = async (req, res, next) => {
    const { page, type, subtype, filter, limit, rating, sfw } = req.query;
    try {
        const topAnime = await jikanFunctions.loadTop('anime', { page, type: type || subtype, filter, limit, rating, sfw });
        
        const enhancedResults = await Promise.all(
            topAnime.data.map(async (anime) => {
                const mappings = await getMappingsForMalId(anime.title, anime.mal_id);
                return {
                    ...anime,
                    external_ids: mappings || { mal_id: anime.mal_id }
                };
            })
        );
        
        res.json({
            ...topAnime,
            data: enhancedResults
        });
    } catch (error) {
        console.error('getTopAnime error:', error.message);
        if (error.message.includes('Service Unavailable') || error.message.includes('maintenance') || error.message.includes('Failed to load top')) {
            return res.status(503).json({
                error: 'Service Unavailable',
                message: 'The metadata provider (Jikan) is currently down for maintenance. Please try again later.'
            });
        }
        next(error);
    }
}

const getSeason = async (req, res, next) => {
    const { year, season, page } = req.query;
    
    try {
        if (!year && !season) {
            const currentSeason = await jikanFunctions.loadCurrentSeason(page);
            return res.json(currentSeason);
        }

        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        
        // Determine season based on current month if not provided
        let currentSeason;
        const month = currentDate.getMonth() + 1;
        if (month >= 12 || month <= 2)currentSeason = 'winter';
        else if (month >= 3 && month <= 5) currentSeason = 'spring';
        else if (month >= 6 && month <= 8) currentSeason = 'summer';
        else currentSeason = 'fall';

        const seasonToUse = season ? season.toLowerCase() : currentSeason;
        const yearToUse = year ? parseInt(year) : currentYear;

        const seasonData = await jikanFunctions.loadSeason(yearToUse, seasonToUse, page);
        
        // Enhance with mappings
        const enhancedResults = await Promise.all(
            seasonData.data.map(async (anime) => {
                const mappings = await getMappingsForMalId(anime.title, anime.mal_id);
                return {
                    ...anime,
                    external_ids: mappings || { mal_id: anime.mal_id }
                };
            })
        );

        res.json({
            ...seasonData,
            data: enhancedResults
        });
    } catch (error) {
        console.error(error);
       next(error);
    }
};

const getUpcomingSeason = async (req, res, next) => {
    const { page } = req.query;
    try {
        const upcomingSeason = await jikanFunctions.loadUpcomingSeason(page);
        res.json(upcomingSeason);
    } catch (error) {
        console.error(error);
       next(error);
    }
};

const getSeasonArchive = async (req, res, next) => {
    try {
        const seasonArchive = await jikanFunctions.loadSeasonArchive();
        res.json(seasonArchive);
    } catch (error) {
        console.error(error);
       next(error);
    }
};

const getAnimeStatitics = async (req, res, next) => {
    const { id } = req.params;
    try {
        const animeStatistics = await jikanFunctions.loadAnime(id, 'statistics');
        res.json(animeStatistics);
    } catch (error) {
        console.error(error);
       next(error);
    }
}

// ─── AniSkip: Community-sourced intro/outro skip times ──────────────────────
const getAniskipTimes = async (req, res, next) => {
    const { id, episode } = req.params;
    const { episodeLength = 0 } = req.query;

    if (!id || !episode) {
        return res.status(400).json({ error: 'Missing anime id or episode number' });
    }

    try {
        const result = await aniSkipUtils.getSkipTimes(id, episode, episodeLength);
        res.json(result);
    } catch (err) {
        console.warn(`[AniSkip Controller] Failed for MAL ${id} Ep ${episode}:`, err.message);
        res.json({ found: false, intro: null, outro: null });
    }
};

const getRecentEpisodes = async (req, res, next) => {
    try {
        const limit = parseInt(req.query.limit) || 40;
        const schedules = await anilistUtils.fetchRecentEpisodes(limit);
        
        const items = [];
        const seenIds = new Set();
        
        schedules.forEach(schedule => {
            if (!schedule.media) return;
            const mediaId = schedule.media.idMal || schedule.media.id;
            if (!mediaId || seenIds.has(mediaId)) return;
            seenIds.add(mediaId);
            
            items.push({
                mal_id: mediaId,
                title: schedule.media.title.romaji || schedule.media.title.english,
                title_english: schedule.media.title.english || schedule.media.title.romaji,
                coverImage: schedule.media.coverImage?.large || '',
                images: {
                    webp: { large_image_url: schedule.media.coverImage?.large || '' },
                    jpg: { large_image_url: schedule.media.coverImage?.large || '' }
                },
                score: schedule.media.averageScore ? (schedule.media.averageScore / 10).toFixed(1) : 'N/A',
                episodes: schedule.media.episodes || '?',
                status: schedule.media.status,
                airing: true,
                isNew: true,
                isNewEpisode: true,
                episodeTitle: `EP ${schedule.episode}`,
                anilistBanner: schedule.media.bannerImage || null,
                genres: (schedule.media.genres || []).map(g => ({ name: g }))
            });
        });

        res.json({ data: items });
    } catch (error) {
        console.error('getRecentEpisodes error:', error.message);
        res.status(500).json({ error: 'Failed to fetch recent episodes from AniList' });
    }
};

module.exports = {
    search,
    getAnime,
    getAnimeFull,
    getAnimeThemes,
    getFeaturedTheme,
    getPopularThemes,
    getNewThemes,
    searchThemes,
    getArtistThemes,
    getBatchThemes,
    getSeasonalThemes,
    getAniListDetails,
    getAnimeEpisode,
    loadWatch,
    getAnimeRecommendations,
    getAnimeGenres,
    getAnimeCharacter,
    getAnimeStaff,
    getAnimeReviews,
    getRecentAnimeReviews,
    getAnimeSchedule,
    getRandomAnime,
    getTopAnime,
    getAnimePictures,
    getSeason,
    getUpcomingSeason,
    getSeasonArchive,
    getAnimeStatitics,
    getAnimeRelations,
    getAnimeThemes,
    getAnimeNews,
    getAnimeForum,
    getAnimeVideos,
    getAnimeVideosepisodes,
    getAnimeMoreinfo,
    getAnimeUserupdates,
    getAnimeExternal,
    getZoroServers, // Legacy
    getZoroStreamingLinks, // Legacy
    getStreamingServers, // New generic
    getStreamingSources, // New generic
    getEpisodeWatchData,
    getAniskipTimes,
    getRecentEpisodes
};
