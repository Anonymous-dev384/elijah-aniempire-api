const axios = require('axios');
const NodeCache = require('node-cache');
const Bottleneck = require('bottleneck');

const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
const limiter = new Bottleneck({
    minTime: 200, // 5 requests per second
    maxConcurrent: 5
});

const withCacheAndLimit = async (cacheKey, fn) => {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    return await limiter.schedule(async () => {
        const doubleCheck = cache.get(cacheKey);
        if (doubleCheck) return doubleCheck;
        const result = await fn();
        if (result) cache.set(cacheKey, result);
        return result;
    });
};

const KITSU_BASE = 'https://kitsu.io/api/edge';

const fetchKitsu = async (endpoint) => {
    try {
        const res = await axios.get(`${KITSU_BASE}${endpoint}`, {
            headers: {
                'Accept': 'application/vnd.api+json',
                'Content-Type': 'application/vnd.api+json'
            },
            timeout: 8000
        });
        return res.data;
    } catch (error) {
        console.error(`Kitsu API error for ${endpoint}:`, error.message);
        throw error;
    }
};

const resolveKitsuId = async (mal_id, type = 'manga') => {
    const cacheKey = `kitsu_mapping_${type}_${mal_id}`;
    return withCacheAndLimit(cacheKey, async () => {
        const data = await fetchKitsu(`/mappings?filter[externalSite]=myanimelist/${type}&filter[externalId]=${mal_id}&include=item`);
        if (data && data.data && data.data.length > 0) {
            // relationship item id is the kitsu id
            return data.data[0].relationships?.item?.data?.id;
        }
        return null;
    });
};

const mapKitsuToJikan = (kitsuItem, type = 'manga') => {
    const attr = kitsuItem.attributes;
    return {
        mal_id: parseInt(kitsuItem.id), 
        kitsu_id: parseInt(kitsuItem.id),
        title: attr.canonicalTitle || attr.en || attr.en_jp,
        title_english: attr.en || attr.canonicalTitle,
        synopsis: attr.synopsis,
        chapters: attr.chapterCount || null,
        volumes: attr.volumeCount || null,
        episodes: attr.episodeCount || null,
        status: attr.status === 'current' ? 'Publishing' : (attr.status === 'finished' ? 'Finished' : attr.status),
        images: {
            jpg: {
                image_url: attr.posterImage?.medium || attr.posterImage?.original || '',
                small_image_url: attr.posterImage?.tiny || '',
                large_image_url: attr.posterImage?.large || ''
            },
            webp: {
                image_url: attr.posterImage?.medium || attr.posterImage?.original || '',
                small_image_url: attr.posterImage?.tiny || '',
                large_image_url: attr.posterImage?.large || ''
            }
        },
        score: attr.averageRating ? parseFloat(attr.averageRating) / 10 : null,
        publishing: attr.status === 'current',
        airing: attr.status === 'current',
        type: attr.subtype || type
    };
};

const kitsuUtils = {
    async resolveKitsuId(mal_id, type = 'manga') {
        return resolveKitsuId(mal_id, type);
    },
    
    async getMalIdFromKitsuId(kitsu_id, type = 'manga') {
        const cacheKey = `mal_mapping_${type}_${kitsu_id}`;
        return withCacheAndLimit(cacheKey, async () => {
            const data = await fetchKitsu(`/${type}/${kitsu_id}/mappings`);
            if (data && data.data && data.data.length > 0) {
                const malMapping = data.data.find(m => m.attributes?.externalSite === `myanimelist/${type}`);
                if (malMapping) return parseInt(malMapping.attributes.externalId);
            }
            return kitsu_id; // fallback
        });
    },

    async search(type, query, limit = 20, parameters = {}) {
        let endpoint = `/${type}?page[limit]=${limit}`;
        if (query) {
            endpoint += `&filter[text]=${encodeURIComponent(query)}`;
        }
        
        // Handle genres mappings (MAL genre IDs to Kitsu slugs)
        const genreMap = {
            1: 'action', 2: 'adventure', 4: 'comedy', 8: 'drama', 10: 'fantasy', 22: 'romance', 24: 'sci-fi', 36: 'slice-of-life',
            7: 'mystery', 14: 'horror', 26: 'girls-love', 28: 'boys-love', 30: 'sports'
        };
        
        if (parameters.genres) {
            const genreSlugs = parameters.genres.split(',').map(g => genreMap[g]).filter(Boolean);
            if (genreSlugs.length > 0) {
                endpoint += `&filter[categories]=${genreSlugs.join(',')}`;
            }
        }
        
        if (parameters.order_by === 'score' && parameters.sort === 'desc') {
            endpoint += `&sort=-averageRating`;
        } else if (parameters.order_by === 'members' && parameters.sort === 'desc') {
            endpoint += `&sort=-userCount`;
        }

        const data = await fetchKitsu(endpoint);
        const results = data.data.map(item => mapKitsuToJikan(item, type));
        
        // Try to fetch MAL IDs where possible
        await Promise.all(results.map(async (res, i) => {
            try {
                const malId = await this.getMalIdFromKitsuId(data.data[i].id, type);
                if (malId && malId !== parseInt(data.data[i].id)) {
                    res.mal_id = malId;
                }
            } catch (e) {}
        }));

        return {
            data: results,
            pagination: {
                has_next_page: !!data.links?.next,
                current_page: parameters.page || 1,
                items: { count: results.length, total: data.meta?.count || results.length }
            }
        };
    },

    async loadFull(type, mal_id) {
        const kitsu_id = await resolveKitsuId(mal_id, type);
        if (!kitsu_id) throw new Error(`Kitsu mapping not found for MAL ID ${mal_id}`);
        
        const data = await fetchKitsu(`/${type}/${kitsu_id}`);
        return {
            data: {
                mal_id: parseInt(mal_id),
                ...mapKitsuToJikan(data.data, type)
            }
        };
    },

    async loadCharacters(type, mal_id) {
        const kitsu_id = await resolveKitsuId(mal_id, type);
        if (!kitsu_id) return { data: [] };
        
        const data = await fetchKitsu(`/${type}/${kitsu_id}/characters?include=character&page[limit]=20`);
        const characters = [];
        
        if (data.included) {
            data.included.forEach(char => {
                if (char.type === 'characters') {
                    const rel = data.data.find(d => d.relationships?.character?.data?.id === char.id);
                    const role = rel?.attributes?.role === 'main' ? 'Main' : 'Supporting';
                    
                    characters.push({
                        character: {
                            mal_id: parseInt(char.id),
                            name: char.attributes?.canonicalName,
                            images: {
                                jpg: {
                                    image_url: char.attributes?.image?.original || char.attributes?.image?.medium || ''
                                }
                            }
                        },
                        role: role
                    });
                }
            });
        }
        
        return { data: characters };
    },

    async loadRecommendations(type, mal_id) {
        const kitsu_id = await resolveKitsuId(mal_id, type);
        if (!kitsu_id) return { data: [] };
        
        const data = await fetchKitsu(`/${type}/${kitsu_id}/media-relationships?include=destination&page[limit]=20`);
        const recommendations = [];
        
        if (data.included) {
            for (const dest of data.included) {
                let destMalId = parseInt(dest.id);
                try {
                    const mappedMalId = await this.getMalIdFromKitsuId(dest.id, type);
                    if (mappedMalId) destMalId = mappedMalId;
                } catch(e) {}
                
                recommendations.push({
                    entry: {
                        mal_id: destMalId,
                        title: dest.attributes?.canonicalTitle || dest.attributes?.titles?.en || dest.attributes?.titles?.en_jp,
                        images: {
                            jpg: {
                                image_url: dest.attributes?.posterImage?.original || dest.attributes?.posterImage?.medium || '',
                                small_image_url: dest.attributes?.posterImage?.tiny || '',
                                large_image_url: dest.attributes?.posterImage?.large || ''
                            },
                            webp: {
                                image_url: dest.attributes?.posterImage?.original || dest.attributes?.posterImage?.medium || '',
                                small_image_url: dest.attributes?.posterImage?.tiny || '',
                                large_image_url: dest.attributes?.posterImage?.large || ''
                            }
                        }
                    },
                    votes: 1
                });
            }
        }
        
        return { data: recommendations };
    },

    async loadPictures(type, mal_id) {
        const kitsu_id = await resolveKitsuId(mal_id, type);
        if (!kitsu_id) return { data: [] };
        
        const data = await fetchKitsu(`/${type}/${kitsu_id}`);
        const attr = data.data?.attributes;
        const pictures = [];
        
        if (attr?.posterImage?.original) pictures.push({ jpg: { image_url: attr.posterImage.original } });
        if (attr?.coverImage?.original) pictures.push({ jpg: { image_url: attr.coverImage.original } });
        
        return { data: pictures };
    },

    async loadTop(type, parameters = {}) {
        const pageNum = parameters.page ? parseInt(parameters.page) : 1;
        const limitNum = parameters.limit ? parseInt(parameters.limit) : 20;
        const offset = (pageNum - 1) * limitNum;
        
        let endpoint = `/${type}?page[limit]=${limitNum}&page[offset]=${offset}`;
        
        const filter = parameters.filter;
        if (filter === 'bypopularity' || filter === 'favorite') {
            endpoint += `&sort=-userCount`;
        } else {
            endpoint += `&sort=-averageRating`;
        }
        
        const data = await fetchKitsu(endpoint);
        const results = data.data.map(item => mapKitsuToJikan(item, type));
        
        await Promise.all(results.map(async (res, i) => {
            try {
                const malId = await this.getMalIdFromKitsuId(data.data[i].id, type);
                if (malId && malId !== parseInt(data.data[i].id)) {
                    res.mal_id = malId;
                }
            } catch (e) {}
        }));
        
        return {
            data: results,
            pagination: {
                has_next_page: !!data.links?.next,
                current_page: pageNum,
                items: { count: results.length, total: data.meta?.count || results.length }
            }
        };
    },

    async loadSeason(year, season, parameters = {}) {
        const pageNum = parameters.page ? parseInt(parameters.page) : 1;
        const limitNum = parameters.limit ? parseInt(parameters.limit) : 20;
        const offset = (pageNum - 1) * limitNum;
        
        const kitsuSeason = String(season).toLowerCase();
        let endpoint = `/anime?filter[season]=${kitsuSeason}&filter[seasonYear]=${year}&page[limit]=${limitNum}&page[offset]=${offset}&sort=-userCount`;
        
        const data = await fetchKitsu(endpoint);
        const results = data.data.map(item => mapKitsuToJikan(item, 'anime'));
        
        await Promise.all(results.map(async (res, i) => {
            try {
                const malId = await this.getMalIdFromKitsuId(data.data[i].id, 'anime');
                if (malId && malId !== parseInt(data.data[i].id)) {
                    res.mal_id = malId;
                }
            } catch (e) {}
        }));
        
        return {
            data: results,
            pagination: {
                has_next_page: !!data.links?.next,
                current_page: pageNum,
                items: { count: results.length, total: data.meta?.count || results.length }
            }
        };
    },

    async loadCurrentSeason(parameters = {}) {
        const page = (typeof parameters === 'object') ? parameters.page : parameters;
        const limit = (typeof parameters === 'object') ? parameters.limit : 20;
        
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        let season;
        if (month >= 12 || month <= 2) season = 'winter';
        else if (month >= 3 && month <= 5) season = 'spring';
        else if (month >= 6 && month <= 8) season = 'summer';
        else season = 'fall';
        
        return await this.loadSeason(year, season, { page, limit });
    },

    async loadUpcomingSeason(parameters = {}) {
        const page = (typeof parameters === 'object') ? parameters.page : parameters;
        const limit = (typeof parameters === 'object') ? parameters.limit : 20;
        
        const now = new Date();
        let year = now.getFullYear();
        const month = now.getMonth() + 1;
        let season;
        if (month >= 12 || month <= 2) {
            season = 'spring';
        } else if (month >= 3 && month <= 5) {
            season = 'summer';
        } else if (month >= 6 && month <= 8) {
            season = 'fall';
        } else {
            season = 'winter';
            year += 1;
        }
        
        return await this.loadSeason(year, season, { page, limit });
    }
};

module.exports = kitsuUtils;
