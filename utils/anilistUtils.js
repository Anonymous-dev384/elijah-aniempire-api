const axios = require('axios');
const NodeCache = require('node-cache');
const Bottleneck = require('bottleneck');

// Cache settings: default TTL is 3600 seconds (1 hour)
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

// AniList allows ~90 requests per minute, we'll be conservative.
const limiter = new Bottleneck({
    minTime: 667, // ~1.5 requests per second
    maxConcurrent: 1
});

const withCacheAndLimit = async (cacheKey, fn) => {
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    return await limiter.schedule(async () => {
        const doubleCheck = cache.get(cacheKey);
        if (doubleCheck) return doubleCheck;

        const result = await fn();
        cache.set(cacheKey, result);
        return result;
    });
};

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';

const anilistUtils = {
    async fetchDetailsByMalId(malId, mediaType = 'ANIME') {
        const query = `
            query ($id: Int, $type: MediaType) {
                Media (idMal: $id, type: $type) {
                    id
                    status
                    episodes
                    chapters
                    bannerImage
                    description
                    coverImage {
                        extraLarge
                        large
                    }
                    nextAiringEpisode {
                        airingAt
                        timeUntilAiring
                        episode
                    }
                    externalLinks {
                        id
                        site
                        url
                        type
                    }
                    streamingEpisodes {
                        title
                        thumbnail
                        url
                        site
                    }
                }
            }
        `;

        const cacheKey = `anilist_mal_${malId}_${mediaType}`;
        
        return withCacheAndLimit(cacheKey, async () => {
            try {
                const response = await axios.post(ANILIST_ENDPOINT, {
                    query,
                    variables: { id: parseInt(malId), type: mediaType }
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                    },
                    timeout: 5000 // 5s timeout for AniList specifically
                });

                return response.data?.data?.Media || null;
            } catch (error) {
                console.error(`AnilistUtils: Error fetching MAL ID ${malId}:`, error.message);
                if (error.response && error.response.status === 404) return null;
                throw error;
            }
        });
    },
    async fetchRecentEpisodes(limit = 40) {
        const query = `
            query ($airingAt_lesser: Int) {
                Page(page: 1, perPage: ${limit}) {
                    airingSchedules(airingAt_lesser: $airingAt_lesser, sort: [TIME_DESC]) {
                        episode
                        media {
                            id
                            idMal
                            title {
                                romaji
                                english
                            }
                            coverImage {
                                large
                            }
                            bannerImage
                            genres
                            averageScore
                            episodes
                            status
                        }
                    }
                }
            }
        `;

        const timestamp = Math.floor(Date.now() / 1000);
        const roundedTimestamp = Math.floor(timestamp / 300) * 300;
        const cacheKey = `anilist_recent_episodes_${roundedTimestamp}_${limit}`;

        return withCacheAndLimit(cacheKey, async () => {
            try {
                const response = await axios.post(ANILIST_ENDPOINT, {
                    query,
                    variables: { airingAt_lesser: timestamp }
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                    },
                    timeout: 10000
                });

                return response.data?.data?.Page?.airingSchedules || [];
            } catch (error) {
                console.error(`AnilistUtils: Error fetching recent episodes:`, error.message);
                return [];
            }
        });
    }
};

module.exports = anilistUtils;
