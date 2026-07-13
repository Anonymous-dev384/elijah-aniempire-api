const jikanjs = require('@mateoaranda/jikanjs');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');

// Patch mateoaranda library to avoid forcing default page parameter on manga sub-resources.
// This is critical because endpoints like /manga/{id}/characters and /manga/{id}/recommendations
// do not support the 'page' parameter in Jikan v4. Sending page=1 bypasses Cloudflare's CDN cache,
// causing requests to hit Jikan's broken backend and return 504.
jikanjs.loadManga = function(id, request, page) {
    const params = {};
    let rawPage = page;
    if (page && typeof page === 'object' && 'page' in page) {
        rawPage = page.page;
    }
    if (rawPage !== undefined && rawPage !== null && rawPage !== '') {
        params.page = rawPage;
    }
    return this.request.send(['manga', id, request], params);
};

/**
 * Build axios proxy agents from a proxy URL string.
 * Returns { httpsAgent, httpAgent } or {} if no proxy.
 */
function buildProxyAgents(proxyUrl) {
    if (!proxyUrl) return {};
    try {
        return {
            httpsAgent: new HttpsProxyAgent(proxyUrl),
            httpAgent: new HttpProxyAgent(proxyUrl)
        };
    } catch (e) {
        console.warn('[Jikan] Could not build proxy agent:', e.message);
        return {};
    }
}

/**
 * Make a proxied HTTP GET request with axios. Falls back to direct if proxy unavailable.
 * Rotates through proxyService on each call.
 */
async function proxiedGet(url, headers = {}) {
    const proxyService = require('../services/proxyService');
    const proxy = await proxyService.getNextProxy();
    const agents = proxy ? buildProxyAgents(proxy.url) : {};

    const resp = await axios.get(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            ...headers
        },
        ...agents,
        timeout: 12000,
        validateStatus: () => true // Handle status codes ourselves
    });
    return resp;
}

// Patch mateoaranda library's request.send to route through our proxy service using axios.
// This fixes ConnectTimeoutError when the server can't reach api.jikan.moe directly.
jikanjs.request.send = async function(args, parameter, mal = false) {
    const url = this.urlBuilder(args, parameter, mal);
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        attempts++;
        try {
            const extraHeaders = mal ? { 'X-MAL-CLIENT-ID': '6114d00ca681b7701d1e15fe11a4987e' } : {};
            const response = await proxiedGet(url, extraHeaders);

            // Handle rate limit
            if (response.status === 429) {
                if (attempts < maxAttempts) {
                    const delay = attempts * 1500;
                    console.warn(`Jikan API 429 rate limit on ${url}. Retrying in ${delay}ms (Attempt ${attempts}/${maxAttempts})...`);
                    await new Promise((res) => setTimeout(res, delay));
                    continue;
                }
                throw new Error('You are being rate-limited. Please follow Rate Limiting guidelines: https://docs.api.jikan.moe/#section/Information/Rate-Limiting');
            }

            const data = response.data;
            if (response.status < 200 || response.status >= 300) {
                const errorMsg = (data && (data.message || data.error)) || `HTTP error ${response.status}`;
                throw new Error(errorMsg);
            }
            return data;
        } catch (error) {
            const isRetryable = error.message.includes('rate-limit') || 
                                error.message.includes('429') || 
                                error.message.includes('rate-limited') ||
                                error.code === 'ECONNABORTED' ||
                                error.code === 'ETIMEDOUT' ||
                                error.code === 'ECONNRESET' ||
                                (error.message && error.message.toLowerCase().includes('timeout'));
            if (attempts < maxAttempts && isRetryable) {
                const delay = attempts * 1500;
                console.warn(`Jikan request failed (${error.code || error.message}). Retrying in ${delay}ms (Attempt ${attempts}/${maxAttempts})...`);
                await new Promise((res) => setTimeout(res, delay));
                continue;
            }
            throw error;
        }
    }
};
const NodeCache = require('node-cache');
const Bottleneck = require('bottleneck');

const jikanBaseURL = 'https://api.jikan.moe/v4'; // Base URL for Jikan API

// Cache settings: default TTL is 3600 seconds (1 hour)
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

// Jikan API allows 3 requests per second (1 request per ~333ms)
// We use 334ms to be safe off the boundary.
const limiter = new Bottleneck({
    minTime: 334,
    maxConcurrent: 1
});

const withCacheAndLimit = async (cacheKey, fn) => {
    // 1. Check cache first to avoid queueing unnecessarily
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    // 2. Queue logic
    return await limiter.schedule(async () => {
        // Double-check cache in case another queued request just cached it
        const doubleCheck = cache.get(cacheKey);
        if (doubleCheck) return doubleCheck;

        // Run actual fn
        const result = await fn();
        
        // Save to cache
        cache.set(cacheKey, result);
        return result;
    });
};

const safeStringify = (obj) => {
    try {
        return obj ? JSON.stringify(obj) : '';
    } catch {
        return '';
    }
};

const jikanFunctions = {
    async rawFetch(url) {
        const cacheKey = `rawFetch_${url}`;
        return withCacheAndLimit(cacheKey, async () => {
            let attempts = 0;
            const maxAttempts = 3;
            while (attempts < maxAttempts) {
                attempts++;
                try {
                    const response = await proxiedGet(url);
                    if (response.status === 429 && attempts < maxAttempts) {
                        const delay = attempts * 1500;
                        console.warn(`Jikan rawFetch 429 rate limit on ${url}. Retrying in ${delay}ms (Attempt ${attempts}/${maxAttempts})...`);
                        await new Promise((res) => setTimeout(res, delay));
                        continue;
                    }
                    if (response.status < 200 || response.status >= 300) {
                        throw new Error(`Failed to map raw fetch for ${url} - Status: ${response.status}`);
                    }
                    return response.data;
                } catch (error) {
                    const isRetryable = error.message.includes('429') || 
                                        error.message.includes('rate-limit') || 
                                        error.message.includes('rate-limited') ||
                                        error.code === 'ECONNABORTED' ||
                                        error.code === 'ETIMEDOUT' ||
                                        error.code === 'ECONNRESET' ||
                                        (error.message && error.message.toLowerCase().includes('timeout'));
                    if (attempts < maxAttempts && isRetryable) {
                        const delay = attempts * 1500;
                        console.warn(`Jikan rawFetch failed (${error.code || error.message}). Retrying in ${delay}ms (Attempt ${attempts}/${maxAttempts})...`);
                        await new Promise((res) => setTimeout(res, delay));
                        continue;
                    }
                    throw error;
                }
            }
        });
    },

    async loadAnime(id, request, parameters) {
        const cacheKey = `anime_${id}_${request}_${safeStringify(parameters)}`;
        return withCacheAndLimit(cacheKey, async () => {
            try {
                return await jikanjs.loadAnime(id, request, parameters);
            } catch (error) {
                console.warn(`Jikan failed for anime ${id} ${request}, trying Kitsu fallback...`);
                try {
                    const kitsuUtils = require('./kitsuUtils');
                    if (!request || request === 'full') return await kitsuUtils.loadFull('anime', id);
                    if (request === 'characters') return await kitsuUtils.loadCharacters('anime', id);
                    if (request === 'recommendations') return await kitsuUtils.loadRecommendations('anime', id);
                    if (request === 'pictures') return await kitsuUtils.loadPictures('anime', id);
                } catch (kitsuError) {
                    console.error(`Kitsu fallback also failed for anime ${id} ${request}:`, kitsuError.message);
                }

                if (error && (error.message === 'null' || !error.message)) {
                    throw new Error(`Failed to load anime with ID: ${id}`);
                }
                throw error;
            }
        });
    },
    
    async loadCharacter(id, request) {
        const cacheKey = `character_${id}_${request}`;
        return withCacheAndLimit(cacheKey, async () => {
            try {
                return await jikanjs.loadCharacter(id, request);
            } catch (error) {
                if (error && (error.message === 'null' || !error.message)) {
                    throw new Error(`Failed to load character with ID: ${id}`);
                }
                throw error;
            }
        });
    },
    
    async loadClub(id, request, page) {
        const cacheKey = `club_${id}_${request}_${page}`;
        return withCacheAndLimit(cacheKey, async () => {
            try {
                return await jikanjs.loadClub(id, request, page);
            } catch (error) {
                if (error && (error.message === 'null' || !error.message)) {
                    throw new Error(`Failed to load club with ID: ${id}`);
                }
                throw error;
            }
        });
    },
    
    async loadGenres(type, page, limit, filter) {
        const cacheKey = `genres_${type}_${page}_${limit}_${filter}`;
        return withCacheAndLimit(cacheKey, async () => {
            try {
                return await jikanjs.loadGenres(type, page, limit, filter);
            } catch (error) {
                if (error && (error.message === 'null' || !error.message)) {
                    throw new Error(`Failed to load genres for type: ${type}`);
                }
                throw error;
            }
        });
    },
    
    async loadMagazines(page) {
        const cacheKey = `magazines_${page}`;
        return withCacheAndLimit(cacheKey, async () => {
            try {
                return await jikanjs.loadMagazines(page);
            } catch (error) {
                if (error && (error.message === 'null' || !error.message)) {
                    throw new Error('Failed to load magazines');
                }
                throw error;
            }
        });
    },
    
    async loadManga(id, request, page) {
        const cacheKey = `manga_${id}_${request}_${page}`;
        return withCacheAndLimit(cacheKey, async () => {
            try {
                return await jikanjs.loadManga(id, request, page);
            } catch (error) {
                console.warn(`Jikan failed for manga ${id} ${request}, trying Kitsu fallback...`);
                try {
                    const kitsuUtils = require('./kitsuUtils');
                    if (!request || request === 'full') return await kitsuUtils.loadFull('manga', id);
                    if (request === 'characters') return await kitsuUtils.loadCharacters('manga', id);
                    if (request === 'recommendations') return await kitsuUtils.loadRecommendations('manga', id);
                    if (request === 'pictures') return await kitsuUtils.loadPictures('manga', id);
                } catch (kitsuError) {
                    console.error(`Kitsu fallback also failed for manga ${id} ${request}:`, kitsuError.message);
                }

                if (error && (error.message === 'null' || !error.message)) {
                    throw new Error(`Failed to load manga with ID: ${id}`);
                }
                throw error;
            }
        });
    },
    
    async loadPerson(id, request) {
        const cacheKey = `person_${id}_${request}`;
        return withCacheAndLimit(cacheKey, async () => {
            try {
                return await jikanjs.loadPerson(id, request);
            } catch (error) {
                if (error && (error.message === 'null' || !error.message)) {
                    throw new Error(`Failed to load person with ID: ${id}`);
                }
                throw error;
            }
        });
    },
    
    async loadProducers(page) {
        const cacheKey = `producers_${page}`;
        return withCacheAndLimit(cacheKey, async () => {
            try {
                return await jikanjs.loadProducers(page);
            } catch (error) {
                if (error && (error.message === 'null' || !error.message)) {
                    throw new Error('Failed to load producers');
                }
                throw error;
            }
        });
    },
    
    async loadRandom(type) {
        // Probably shouldn't fully cache random requests for a whole hour, 
        // since random implies a fresh result. But since I requested caching and 
        // rate limit prevention, caching for say 1 second or running it directly might be better.
        // I will use limiting but no long cache. so here's a 5 second cache out of safety.
        const cacheKey = `random_${type}_${Math.floor(Date.now() / 5000)}`;
        return withCacheAndLimit(cacheKey, async () => {
            try {
                return await jikanjs.loadRandom(type);
            } catch (error) {
                if (error && (error.message === 'null' || !error.message)) {
                    throw new Error(`Failed to load random ${type}`);
                }
                throw error;
            }
        });
    },
    
    async loadRecommendations(type, page) {
        const cacheKey = `recommendations_${type}_${page}`;
        return withCacheAndLimit(cacheKey, async () => {
            try {
                return await jikanjs.loadRecommendations(type, page);
            } catch (error) {
                if (error && (error.message === 'null' || !error.message)) {
                    throw new Error(`Failed to load recommendations for ${type}`);
                }
                throw error;
            }
        });
    },
    
    async loadReviews(type, page) {
        const cacheKey = `reviews_${type}_${page}`;
        return withCacheAndLimit(cacheKey, async () => {
            try {
                return await jikanjs.loadReviews(type, page);
            } catch (error) {
                if (error && (error.message === 'null' || !error.message)) {
                    throw new Error(`Failed to load reviews for ${type}`);
                }
                throw error;
            }
        });
    },
    
    async loadSchedule(day, page, limit) {
        const cacheKey = `schedule_${day}_${page}_${limit}`;
        return withCacheAndLimit(cacheKey, async () => {
            try {
                return await jikanjs.loadSchedule(day, page, limit);
            } catch (error) {
                if (error && (error.message === 'null' || !error.message)) {
                    throw new Error(`Failed to load schedule for day: ${day}`);
                }
                throw error;
            }
        });
    },
    
    async loadUser(username, request, page) {
        const cacheKey = `user_${username}_${request}_${page}`;
        return withCacheAndLimit(cacheKey, async () => {
            try {
                return await jikanjs.loadUser(username, request, page);
            } catch (error) {
                if (error && (error.message === 'null' || !error.message)) {
                    throw new Error(`Failed to load user: ${username}`);
                }
                throw error;
            }
        });
    },
    
    async loadAnimelist(username, limit, offset) {
        const cacheKey = `animelist_${username}_${limit}_${offset}`;
        return withCacheAndLimit(cacheKey, async () => {
            try {
                return await jikanjs.loadAnimelist(username, limit, offset);
            } catch (error) {
                if (error && (error.message === 'null' || !error.message)) {
                    throw new Error(`Failed to load animelist for user: ${username}`);
                }
                throw error;
            }
        });
    },
    
    async loadMangalist(username, limit, offset) {
        const cacheKey = `mangalist_${username}_${limit}_${offset}`;
        return withCacheAndLimit(cacheKey, async () => {
            try {
                return await jikanjs.loadMangalist(username, limit, offset);
            } catch (error) {
                if (error && (error.message === 'null' || !error.message)) {
                    throw new Error(`Failed to load mangalist for user: ${username}`);
                }
                throw error;
            }
        });
    },
    
    async loadSeason(year, season, page) {
        const cacheKey = `season_${year}_${season}_${page}`;
        return withCacheAndLimit(cacheKey, async () => {
            try {
                return await jikanjs.loadSeason(year, season, page);
            } catch (error) {
                console.warn(`Jikan failed for season ${season} ${year}, trying Kitsu fallback...`);
                try {
                    const kitsuUtils = require('./kitsuUtils');
                    const pageNum = typeof page === 'object' ? page.page : page;
                    const limitNum = typeof page === 'object' ? page.limit : 20;
                    return await kitsuUtils.loadSeason(year, season, { page: pageNum, limit: limitNum });
                } catch (kitsuError) {
                    console.error(`Kitsu fallback also failed for season ${season} ${year}:`, kitsuError.message);
                }

                if (error && (error.message === 'null' || !error.message)) {
                    throw new Error(`Failed to load season: ${season} ${year}`);
                }
                throw error;
            }
        });
    },
    
    async loadSeasonArchive() {
        const cacheKey = `season_archive`;
        return withCacheAndLimit(cacheKey, async () => {
            try {
                return await jikanjs.loadSeasonArchive();
            } catch (error) {
                if (error && (error.message === 'null' || !error.message)) {
                    throw new Error('Failed to load season archive');
                }
                throw error;
            }
        });
    },
    
    async loadCurrentSeason(page) {
        const cacheKey = `current_season_${page}`;
        return withCacheAndLimit(cacheKey, async () => {
            try {
                return await jikanjs.loadCurrentSeason(page);
            } catch (error) {
                console.warn(`Jikan failed for current season, trying Kitsu fallback...`);
                try {
                    const kitsuUtils = require('./kitsuUtils');
                    const pageNum = typeof page === 'object' ? page.page : page;
                    const limitNum = typeof page === 'object' ? page.limit : 20;
                    return await kitsuUtils.loadCurrentSeason({ page: pageNum, limit: limitNum });
                } catch (kitsuError) {
                    console.error(`Kitsu fallback also failed for current season:`, kitsuError.message);
                }

                if (error && (error.message === 'null' || !error.message)) {
                    throw new Error('Failed to load current season');
                }
                throw error;
            }
        });
    },
    
    async loadUpcomingSeason(page) {
        const cacheKey = `upcoming_season_${page}`;
        return withCacheAndLimit(cacheKey, async () => {
            try {
                return await jikanjs.loadUpcomingSeason(page);
            } catch (error) {
                console.warn(`Jikan failed for upcoming season, trying Kitsu fallback...`);
                try {
                    const kitsuUtils = require('./kitsuUtils');
                    const pageNum = typeof page === 'object' ? page.page : page;
                    const limitNum = typeof page === 'object' ? page.limit : 20;
                    return await kitsuUtils.loadUpcomingSeason({ page: pageNum, limit: limitNum });
                } catch (kitsuError) {
                    console.error(`Kitsu fallback also failed for upcoming season:`, kitsuError.message);
                }

                if (error && (error.message === 'null' || !error.message)) {
                    throw new Error('Failed to load upcoming season');
                }
                throw error;
            }
        });
    },
    
    async loadTop(type, pageOrParams, subtype, filter, extraParams = {}) {
        let params = {};
        if (typeof pageOrParams === 'object' && pageOrParams !== null) {
            params = { ...pageOrParams };
        } else {
            // Backward compatibility for positional arguments: page, subtype, filter
            params = { page: pageOrParams, type: subtype, filter, ...extraParams };
        }

        // Standardize: Jikan API expects 'type', but wrapper used 'subtype'
        if (params.subtype && !params.type) {
            params.type = params.subtype;
            delete params.subtype;
        }

        const cacheKey = `top_${type}_${safeStringify(params)}`;
        return withCacheAndLimit(cacheKey, async () => {
            try {
                // Use jikanjs.raw to bypass wrapper method limits and send all parameters
                return await jikanjs.raw(['top', type], params);
            } catch (error) {
                console.warn(`Jikan failed for top ${type}, trying Kitsu fallback...`);
                try {
                    const kitsuUtils = require('./kitsuUtils');
                    return await kitsuUtils.loadTop(type, params);
                } catch (kitsuError) {
                    console.error(`Kitsu fallback also failed for top ${type}:`, kitsuError.message);
                }

                if (error && (error.message === 'null' || !error.message)) {
                    throw new Error(`Failed to load top ${type}`);
                }
                throw error;
            }
        });
    },
    
    async loadWatch(type, page, limit, popular) {
        const cacheKey = `watch_${type}_${page}_${limit}_${popular}`;
        return withCacheAndLimit(cacheKey, async () => {
            try {
                return await jikanjs.loadWatch(type, page, limit, popular);
            } catch (error) {
                if (error && (error.message === 'null' || !error.message)) {
                    throw new Error(`Failed to load watch for ${type}`);
                }
                throw error;
            }
        });
    },
    
    async search(type, query, limit, parameters = {}) {
        // Standardize: Jikan API expects 'type', but some parts of our app might use 'subtype'
        if (parameters.subtype && !parameters.type) {
            parameters.type = parameters.subtype;
            delete parameters.subtype;
        }

        const cacheKey = `search_${type}_${query || ''}_${limit || ''}_${safeStringify(parameters)}`;
        return withCacheAndLimit(cacheKey, async () => {
            try {
                return await jikanjs.search(type, query, limit, parameters);
            } catch (error) {
                console.warn(`Jikan failed for search ${type} "${query || ''}", trying Kitsu fallback...`);
                try {
                    const kitsuUtils = require('./kitsuUtils');
                    return await kitsuUtils.search(type, query, limit, parameters);
                } catch (kitsuError) {
                    console.error(`Kitsu search fallback also failed:`, kitsuError.message);
                }

                const queryStr = query ? `: "${query}"` : '';
                const baseMsg = `Failed to search for ${type}${queryStr}`;
                if (error && (error.message === 'null' || !error.message)) {
                    throw new Error(`${baseMsg} (Metadata provider Jikan/MyAnimeList is temporarily down or refuses to connect)`);
                }
                throw new Error(`${baseMsg} (${error.message})`);
            }
        });
    },
    
    async raw(urlParts, queryParameters, mal) {
        const cacheKey = `raw_${safeStringify(urlParts)}_${safeStringify(queryParameters)}_${mal}`;
        return withCacheAndLimit(cacheKey, async () => {
            try {
                return await jikanjs.raw(urlParts, queryParameters, mal);
            } catch (error) {
                if (error && (error.message === 'null' || !error.message)) {
                    throw new Error('Failed to make raw API request');
                }
                throw error;
            }
        });
    },
};

module.exports = {
    jikanBaseURL,
    jikanFunctions
}
