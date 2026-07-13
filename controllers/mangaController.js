const { jikanFunctions } = require('../utils/jikanUtils');
const mangaService = require('../services/mangaService');
const mangaMappingService = require('../services/mangaMappingService');
const { isDBConnected } = require('../config/db');
const { addMangaToQueue } = require('../services/queueService');
const { getMangaMappingsForMalId } = require('../utils/mappingUtils');
const https = require('https');

const search = async (req, res, next) => {
    const { query, page, limit, provider, ...filters } = req.query;

    try {
        // If a provider is specified, search directly via that provider
        if (provider) {
            const normalizedProvider = provider.toLowerCase();
            const providerMap = {
                mangafire: () => require('../services/manga/yomu').search('mangafire', query, page),
                mangadex: () => require('../services/manga/consumet').search('mangadex', query, page),
                mangapill: () => require('../services/manga/yomu').search('mangapill', query),
                flamecomics: () => require('../services/manga/yomu').search('flamecomics', query),
                mangapark: () => require('../services/manga/yomu').search('mangapark', query),
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

        // Default: search via Jikan (MAL metadata)
        const searchResults = await jikanFunctions.search('manga', query, limit, { page, ...filters });

        // Enhance with external IDs if DB is connected
        let mappingsMap = {};
        if (isDBConnected() && searchResults.data) {
            try {
                const malIds = searchResults.data.map(manga => manga.mal_id);
                mappingsMap = await mangaMappingService.getMappingsByMalIds(malIds);

                // Queue missing mappings or low-confidence ones in background
                searchResults.data.forEach(manga => {
                    const mapping = mappingsMap[manga.mal_id];
                    if (!mapping?.mangafire_id) {
                        const altTitles = [manga.title_english, ...(manga.title_synonyms || [])].filter(Boolean);
                        addMangaToQueue(manga.title, manga.mal_id, mapping?.anilist_id, altTitles).catch(err => 
                            console.error(`Post-manga-search queue error for ${manga.title}:`, err.message)
                        );
                    }
                });
            } catch (dbErr) {
                console.warn('MangaController: DB error during search mappings. Skipping enhancement.', dbErr.message);
            }
        }

        // Format results (immediate response)
        const enhancedResults = searchResults.data.map(manga => ({
            ...manga,
            external_ids: mangaMappingService.formatMapping(
                mappingsMap[manga.mal_id], 
                manga.title
            )
        }));

        res.json({
            ...searchResults,
            data: enhancedResults
        });
    } catch (error) {
        console.error(error);
        next(error);
    }
}

const getManga = async (req, res, next) => {
    const { id } = req.params;
    let mangaData = null;

    try {
        // Use direct API call to avoid the problematic library code, wrapped in our cache & rate limiter
        mangaData = await jikanFunctions.rawFetch(`https://api.jikan.moe/v4/manga/${id}`);
    } catch (error) {
        console.warn(`Jikan failed for manga ${id}, trying Kitsu fallback:`, error.message);
        try {
            const kitsuUtils = require('../utils/kitsuUtils');
            mangaData = await kitsuUtils.loadFull('manga', id);
        } catch (kitsuError) {
            console.error(`Kitsu fallback also failed for manga ${id}:`, kitsuError.message);
            mangaData = null;
        }
    }

    try {
        // Fetch mappings (handles background sync if missing)
        const mappings = await getMangaMappingsForMalId(mangaData?.data?.title || null, id);

        if (!mangaData && !mappings) {
            return res.status(404).json({ 
                error: 'Not Found', 
                message: 'Manga not found in Jikan or database' 
            });
        }

        // Combine the data
        const enhancedData = mangaData ? {
            ...mangaData,
            external_ids: mappings || { mal_id: id }
        } : {
            data: { mal_id: id, title: mappings?.title || 'Unknown Title' },
            external_ids: mappings || { mal_id: id },
            fallback: true,
            warning: 'Title and details may be incomplete because the metadata provider (Jikan) is currently unreachable.'
        };

        res.json(enhancedData);
    } catch (error) {
        console.error('getManga error:', error);
        next(error);
    }
};

const getMangaFull = async (req, res, next) => {
    const { id } = req.params;
    let mangaData = null;

    try {
        mangaData = await jikanFunctions.rawFetch(`https://api.jikan.moe/v4/manga/${id}/full`);
    } catch (error) {
        console.warn(`Jikan failed for full manga ${id}, trying Kitsu fallback:`, error.message);
        try {
            const kitsuUtils = require('../utils/kitsuUtils');
            mangaData = await kitsuUtils.loadFull('manga', id);
        } catch (kitsuError) {
            console.error(`Kitsu fallback also failed for full manga ${id}:`, kitsuError.message);
            mangaData = null;
        }
    }

    try {
        const mappings = await getMangaMappingsForMalId(mangaData?.data?.title || null, id);

        if (!mangaData && !mappings) {
            return res.status(404).json({ 
                error: 'Not Found', 
                message: 'Manga not found in Jikan or database' 
            });
        }

        const enhancedData = mangaData ? {
            ...mangaData,
            external_ids: mappings || { mal_id: id }
        } : {
            data: { mal_id: id, title: mappings?.title || 'Unknown Title' },
            external_ids: mappings || { mal_id: id },
            fallback: true,
            warning: 'Title and details may be incomplete because the metadata provider (Jikan) is currently unreachable.'
        };

        res.json(enhancedData);
    } catch (error) {
        console.error('getMangaFull error:', error);
        next(error);
    }
};


const getMangaGenres = async (req, res, next) => {
    const { filter } = req.query;

    try {
        if (filter) {
            const genres = await jikanFunctions.loadGenres('manga', filter);
            return res.json(genres);
        }

        const genres = await jikanFunctions.loadGenres('manga');
        res.json(genres);
    } catch (error) {
        console.error(error);
        next(error);
    }
};

const getMangaCharacter = async (req, res, next) => {
    const { id } = req.params;
    try {
        const characters = await jikanFunctions.loadManga(id, 'characters');
        res.json(characters);
    } catch (error) {
        console.error(error);
        next(error);
    }
};

const getMangaPerson = async (req, res, next) => {
    const { id } = req.params;
    try {
        const personData = await jikanFunctions.loadPerson(id, 'manga');
        res.json(personData); 
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch person data' });
    }
};

const getMangaReviews = async (req, res, next) => {
    const { page } = req.query;
    const { id } = req.params;
    try {
        const reviews = await jikanFunctions.loadManga(id, 'reviews', { page });
        res.json(reviews);
    } catch (error) {
        console.error(error);
        next(error);
    }
};

const getRecentMangaReviews = async (req, res, next) => {
    const { page, preliminary, spoiler } = req.query; 

    try {
        const reviews = await jikanFunctions.loadReviews('manga', page, preliminary, spoiler);
        res.json(reviews);  
    } catch (error) {
        console.error(error);
        next(error);
    }
};

const getMangaRecommendations = async (req, res, next) => {
    const { page } = req.query;
    const { id } = req.params;

    try {
        if (id) {
            const recommendations = await jikanFunctions.loadManga(id, 'recommendations', { page });
            res.json(recommendations);
        } else {
            const recommendations = await jikanFunctions.loadRecommendations('manga', page);
            res.json(recommendations);
        }
    } catch (error) {
        console.error(error);
        next(error);
    }
};

const getMangaPictures = async (req, res, next) => {
    const { id } = req.params;
    try {
        const pictures = await jikanFunctions.loadManga(id, 'pictures');
        res.json(pictures);
    } catch (error) {
        console.error(error);
        next(error);
    }
};

const getMangaNews = async (req, res, next) => {
    const { page } = req.query;
    const { id } = req.params;
    try {
        const news = await jikanFunctions.loadManga(id, 'news', { page });
        res.json(news);
    } catch (error) {
        console.error(error);
        next(error);
    }
};

const getMangaForum = async (req, res, next) => {
    const { id } = req.params;
    try {
        const forum = await jikanFunctions.loadManga(id, 'forum');
        res.json(forum);
    } catch (error) {
        console.error(error);
        next(error);
    }
};

const getMangaMoreinfo = async (req, res, next) => {     
    const { id } = req.params;

    try {
        const moreInfo = await jikanFunctions.loadManga(id, 'moreinfo');
        res.json(moreInfo);
    } catch (error) {
        console.error(error);
        next(error);
    }
};

const getMangaUserupdates = async (req, res, next) => {
    const { page } = req.query;
    const { id } = req.params;

    try {
        const userUpdates = await jikanFunctions.loadManga(id, 'userupdates', { page });
        res.json(userUpdates);
    } catch (error) {
        console.error(error);
        next(error);
    }
};

const getMangaRelations = async (req, res, next) => {
    const { id } = req.params;

    try {
        const relations = await jikanFunctions.loadManga(id, 'relations');
        res.json(relations);
    } catch (error) {
        console.error(error);
        next(error);
    }
};

const getTopManga = async (req, res, next) => {
    const { page, type, subtype, filter, limit, rating, sfw } = req.query;

    try {
        const topManga = await jikanFunctions.loadTop('manga', { 
            page, 
            type: type || subtype, 
            filter, 
            limit,
            rating,
            sfw
        });
        res.json(topManga);
    } catch (error) {
        console.error(error);
        next(error);
    }
}

const getMangaChapters = async (req, res, next) => {
    const { id } = req.params;
    const { provider, language } = req.query;

    try {
        // Normalize provider name to handle common typos
        let normalizedProvider = provider ? provider.toLowerCase() : null;
        if (normalizedProvider === 'mangdex') {
            normalizedProvider = 'mangadex'; // Correct common typo
        }
        
        // Skip mangapark if it's unavailable
        if (normalizedProvider === 'mangapark') {
            return res.status(503).json({ 
                error: 'MangaPark is currently unavailable', 
                message: 'MangaPark provider is temporarily disabled due to service unavailability' 
            });
        }
        
        // Resilience: Try to get manga title from metadata as fallback for dynamic search
        let mangaTitle = null;
        try {
            const metaData = await jikanFunctions.rawFetch(`https://api.jikan.moe/v4/manga/${id}`);
            mangaTitle = metaData.data?.title || metaData.data?.title_english || metaData.data?.title_romaji;
        } catch (metaErr) {
            console.warn(`Jikan metadata fetch failed for manga ${id}:`, metaErr.message);
        }

        const chapters = await mangaService.getChapters(id, normalizedProvider, language, mangaTitle);
        res.json(chapters);
    } catch (error) {
        console.warn('Controller Warn (getMangaChapters):', error.message);
        res.json({ provider: provider || 'none', chapters: [] });
    }
};

const getMangaChapterPages = async (req, res, next) => {
    const { chapterId } = req.params;
    const { provider, mangaId } = req.query;

    if (!provider) {
        return res.status(400).json({ error: 'Provider is required' });
    }

    // Normalize provider name to handle common typos
    let normalizedProvider = provider.toLowerCase();
    if (normalizedProvider === 'mangdex') {
        normalizedProvider = 'mangadex'; // Correct common typo
    }
    
    // Skip mangapark if it's unavailable
    if (normalizedProvider === 'mangapark') {
        return res.status(503).json({ 
            error: 'MangaPark is currently unavailable', 
            message: 'MangaPark provider is temporarily disabled due to service unavailability' 
        });
    }
    
    try {
        const pages = await mangaService.getPages(normalizedProvider, chapterId, mangaId);
        res.json(pages);
    } catch (error) {
        console.error('Controller Error (getMangaChapterPages):', error.message);
        
        // Handle specific mangapark errors
        if (error.message && error.message.toLowerCase().includes('mangapark')) {
            return res.status(503).json({ 
                error: 'MangaPark is currently unavailable', 
                message: 'MangaPark provider is temporarily disabled due to service unavailability' 
            });
        }
        
        res.status(500).json({ error: error.message });
    }
};

const getMangaExternal = async (req, res, next) => {
    const { id } = req.params;

    try {
        const external = await jikanFunctions.loadManga(id, 'external');
        res.json(external);
    } catch (error) {
        console.error(error);
        next(error);
    }
};

// There are no manga episodes

const getMangaEpisodes = async (req, res, next) => {
    const { id } = req.params;
    try {
        const episodes = await jikanFunctions.loadManga(id, 'episodes');
        res.json(episodes);
    } catch (error) {
        console.error(error);
        next(error);
    }
};

const getRandomManga = async (req, res, next) => {
    try {
        const randomManga = await jikanFunctions.loadRandom('manga');
        res.json(randomManga);
    } catch (error) {
        console.error(error);
        next(error);
    }
}

const getMangaStatistics = async (req, res, next) => {
    const { id } = req.params;

    try {
        const stats = await jikanFunctions.loadManga(id,'statistics');
        res.json(stats);
    } catch (error) {
        console.error(error);
        next(error);
    }   
};

const getAniListDetails = async (req, res, next) => {
    const { id } = req.params;
    try {
        const anilistUtils = require('../utils/anilistUtils');
        const details = await anilistUtils.fetchDetailsByMalId(id, 'MANGA');
        if (!details) return res.status(404).json({ error: 'AniList entry not found' });
        res.json(details);
    } catch (error) {
        console.error('getAniListDetails error:', error);
        next(error);
    }
};

module.exports = {
    search,
    getManga,
    getMangaFull,
    getAniListDetails,
    getMangaGenres,
    getMangaCharacter,
    getMangaPerson,
    getMangaReviews,
    getRecentMangaReviews,
    getMangaRecommendations,
    getMangaPictures, 
    getMangaEpisodes, 
    getRandomManga,
    getMangaStatistics,
    getMangaNews,
    getMangaForum,
    getMangaMoreinfo,
    getMangaUserupdates,
    getMangaRelations,
    getTopManga,
    getMangaExternal,
    getMangaChapters,
    getMangaChapterPages
};
