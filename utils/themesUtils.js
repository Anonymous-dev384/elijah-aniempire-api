const axios = require('axios');
const axiosRetry = require('axios-retry').default || require('axios-retry');
const NodeCache = require('node-cache');
const Bottleneck = require('bottleneck');

// Configure axios-retry
axiosRetry(axios, { 
    retries: 3, 
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.response?.status === 429;
    }
});

// Set axios defaults for themes utility
axios.defaults.timeout = 15000;
axios.defaults.headers.common['User-Agent'] = 'AniEmpire/1.0 (https://github.com/ElijahCodes12345/aniempire)';
axios.defaults.headers.common['Accept'] = 'application/json';

// Cache settings: default TTL is 3600 seconds (1 hour)
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

// AnimeThemes.moe is generally generous but we'll apply a moderate limit.
const limiter = new Bottleneck({
    minTime: 500, // 2 requests per second
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

const THEMES_ENDPOINT = 'https://api.animethemes.moe';

const themesUtils = {
    // Helper to format theme data from AnimeThemes JSON:API structure
    formatThemeData(animeData, themeItem = null) {
        if (!animeData && !themeItem) return null;

        // If themeItem is provided directly (e.g. from a direct /animetheme/:id fetch)
        // we use it. Otherwise we expect it to be in animeData.animethemes.
        const themesSource = themeItem ? [themeItem] : (animeData?.animethemes || []);

        const themes = themesSource.map(theme => {
            const entry = theme.animethemeentries?.[0];
            const video = entry?.videos?.[0];
            
            return {
                id: theme.id,
                type: theme.type, // OP, ED
                sequence: theme.sequence,
                song: {
                    title: theme.song?.title,
                    artists: theme.song?.artists?.map(a => ({
                        id: a.id,
                        name: a.name,
                        slug: a.slug
                    })) || []
                },
                video: video ? {
                    link: video.link,
                    resolution: video.resolution,
                    nc: video.nc,
                    subbed: video.subbed
                } : null,
                audio: video?.audio ? {
                    link: video.audio.link
                } : null
            };
        });

        // Extract cover image from anime.images (AnimeThemes CDN)
        const animeImages = animeData?.images || themeItem?.anime?.images || [];
        const largeCover = animeImages.find(img => img.facet === 'Large Cover')?.link;
        const smallCover = animeImages.find(img => img.facet === 'Small Cover')?.link;

        return {
            name: animeData?.name || themeItem?.anime?.name || 'Unknown Anime',
            slug: animeData?.slug || themeItem?.anime?.slug,
            year: animeData?.year || themeItem?.anime?.year || null,
            season: animeData?.season || themeItem?.anime?.season || null,
            synopsis: animeData?.synopsis || themeItem?.anime?.synopsis || null,
            coverImage: largeCover || smallCover || null,
            images: animeImages,
            mal_id: animeData?.resources?.find(r => r.site === 'MyAnimeList')?.external_id || 
                    themeItem?.anime?.resources?.find(r => r.site === 'MyAnimeList')?.external_id,
            resources: animeData?.resources || themeItem?.anime?.resources || [],
            themes: themes
        };
    },

    async fetchThemesByAnimeSlug(slug) {
        const results = await this.fetchThemesBySlugs([slug]);
        return results[0] || null;
    },

    async fetchThemesBySlugs(slugs, lean = false) {
        if (!slugs || slugs.length === 0) return [];
        
        // Remove duplicates and empty slugs
        const uniqueSlugs = [...new Set(slugs.filter(Boolean))];
        const cacheKey = `themes_batch_${lean ? 'lean_' : ''}${uniqueSlugs.sort().join(',')}`;
        
        // Try to get from cache first
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const include = lean ? 'resources,images' : 'animethemes.animethemeentries.videos.audio,animethemes.song.artists,resources,images';
        const url = `${THEMES_ENDPOINT}/anime?filter[slug]=${uniqueSlugs.join(',')}&include=${include}`;

        return await withCacheAndLimit(cacheKey, async () => {
            try {
                const response = await axios.get(url, { timeout: 15000 });
                const animeList = response.data?.anime || [];
                return animeList.map(anime => this.formatThemeData(anime)).filter(Boolean);
            } catch (error) {
                console.error(`ThemesUtils: Error fetching themes for batch slugs:`, error.message);
                return [];
            }
        });
    },

    async fetchThemesByMalId(malId) {
        const url = `${THEMES_ENDPOINT}/anime?filter[has]=resources&filter[site]=MyAnimeList&filter[external_id]=${malId}&include=animethemes.animethemeentries.videos.audio,animethemes.song.artists,resources,images`;
        const cacheKey = `themes_mal_${malId}`;

        return withCacheAndLimit(cacheKey, async () => {
            try {
                const response = await axios.get(url, { timeout: 8000 });
                const animeData = response.data?.anime?.[0];
                return this.formatThemeData(animeData);
            } catch (error) {
                console.error(`ThemesUtils: Error fetching themes for MAL ID ${malId}:`, error.message);
                return null;
            }
        });
    },

    async fetchFeaturedTheme() {
        const url = `${THEMES_ENDPOINT}/featuredtheme?page[size]=1&sort=-id&include=animetheme.anime`;
        const cacheKey = 'themes_featured';

        return withCacheAndLimit(cacheKey, async () => {
            try {
                const response = await axios.get(url);
                const featured = response.data?.featuredthemes?.[0];
                if (!featured || !featured.animetheme?.anime) return null;

                const animeSlug = featured.animetheme.anime.slug;
                // Fetch full details including resources using the working /anime endpoint with slug filter
                const fullAnime = await this.fetchThemesByAnimeSlug(animeSlug);
                
                if (!fullAnime) return null;

                return {
                    ...fullAnime,
                    featured_info: {
                        start_at: featured.start_at,
                        end_at: featured.end_at
                    }
                };
            } catch (error) {
                return null;
            }
        });
    },

    async fetchNewThemes(limit = 10) {
        const url = `${THEMES_ENDPOINT}/animetheme?page[size]=${limit}&sort=-created_at&include=animethemeentries.videos.audio,song.artists,anime`;
        const cacheKey = `themes_new_${limit}`;

        // Manual cache check to avoid nested limiter.schedule
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        try {
            const response = await limiter.schedule(() => axios.get(url, { timeout: 10000 }));
            const themeList = response.data?.animethemes || [];

            // Extract unique slugs
            const slugs = [...new Set(themeList.map(t => t.anime?.slug).filter(Boolean))];
            
            // Lean batch fetch anime metadata (resources, images)
            const animeMeta = await this.fetchThemesBySlugs(slugs, true);
            
            const result = themeList.map(rawTheme => {
                const meta = animeMeta.find(a => a.slug === rawTheme.anime?.slug);
                if (!meta) return null;
                
                // Manually format this specific theme and merge with anime metadata
                const formattedTheme = this.formatThemeData(null, rawTheme).themes[0];
                if (!formattedTheme) return null;

                return {
                    ...meta,
                    themes: [formattedTheme]
                };
            }).filter(Boolean);

            cache.set(cacheKey, result);
            return result;
        } catch (error) {
            if (error.response?.data) {
                console.error('AnimeThemes Error Detail:', JSON.stringify(error.response.data, null, 2));
            }
            console.error('ThemesUtils: Error fetching new themes:', error.message);
            return [];
        }
    },


    async fetchSeasonalThemes(year, season) {
        const url = `${THEMES_ENDPOINT}/anime?filter[year]=${year}&filter[season]=${season}&include=animethemes.animethemeentries.videos.audio,animethemes.song.artists,resources,images`;
        const cacheKey = `themes_seasonal_${year}_${season}`;

        return withCacheAndLimit(cacheKey, async () => {
            try {
                const response = await axios.get(url);
                const animeList = response.data?.anime || [];
                return animeList.map(anime => this.formatThemeData(anime)).filter(Boolean);
            } catch (error) {
                console.error(`ThemesUtils: Error fetching seasonal themes (${season} ${year}):`, error.message);
                return [];
            }
        });
    },

    async searchThemes(query, limit = 10) {
        const searchUrl = `${THEMES_ENDPOINT}/search?q=${encodeURIComponent(query)}&fields[search]=animethemes`;
        const cacheKey = `themes_search_${query}_${limit}`;

        // Manual cache check to avoid nested limiter.schedule
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        try {
            // 1. Get IDs from search endpoint (Shallow results)
            const searchResponse = await limiter.schedule(() => axios.get(searchUrl, { timeout: 8000 }));
            const themesBrief = searchResponse.data?.search?.animethemes || [];
            if (themesBrief.length === 0) return [];

            // 2. Fetch full detail for each top result (needed to get anime slugs)
            const topResults = themesBrief.slice(0, limit);
            const detailedThemes = await Promise.all(topResults.map(async (t) => {
                return await limiter.schedule(async () => {
                    try {
                        const url = `${THEMES_ENDPOINT}/animetheme/${t.id}?include=anime,animethemeentries.videos.audio,song.artists`;
                        const resp = await axios.get(url, { timeout: 5000 });
                        return resp.data?.animetheme || null;
                    } catch (err) {
                        return null;
                    }
                });
            }));

            const themesWithAnime = detailedThemes.filter(t => t?.anime?.slug);
            const slugs = [...new Set(themesWithAnime.map(t => t.anime.slug))];
            
            // 3. Lean batch fetch anime metadata (resources and images)
            const animeMeta = await this.fetchThemesBySlugs(slugs, true);

            // 4. Map back and apply relevance check
            const finalResults = themesWithAnime.map(rawTheme => {
                const meta = animeMeta.find(a => a.slug === rawTheme.anime.slug);
                if (!meta) return null;

                const formattedTheme = this.formatThemeData(null, rawTheme).themes[0];
                if (!formattedTheme) return null;

                // Relevance Check
                const q = query.toLowerCase();
                const animeName = (meta.name || '').toLowerCase();
                const songTitle = (formattedTheme.song?.title || '').toLowerCase();
                const queryWords = q.split(/\s+/).filter(w => w.length > 2);
                const isMatch = queryWords.length === 0 || 
                            queryWords.some(word => animeName.includes(word) || songTitle.includes(word));

                if (!isMatch && queryWords.length > 0) return null;

                return {
                    ...meta,
                    themes: [formattedTheme]
                };
            }).filter(Boolean);

            cache.set(cacheKey, finalResults);
            return finalResults;
        } catch (error) {
            console.error('ThemesUtils: Error searching themes:', error.message);
            return [];
        }
    },

    async fetchArtistByMalId(malId) {
        console.log(`[ThemesUtils] Attempting to resolve artist for MAL ID or internal ID: ${malId}`);
        const cacheKey = `themes_artist_mal_res_${malId}`;

        return withCacheAndLimit(cacheKey, async () => {
            try {
                // 1. Try treating it as a direct AnimeThemes internal artist ID first!
                console.log(`[ThemesUtils] Trying direct AnimeThemes ID filter for: ${malId}`);
                const directUrl = `${THEMES_ENDPOINT}/artist?filter[id]=${malId}&include=images`;
                const directRes = await axios.get(directUrl, { timeout: 8000 });
                const directArtist = directRes.data?.artists?.[0] || null;
                
                if (directArtist) {
                    console.log(`[ThemesUtils] ✓ Direct AnimeThemes ID filter successful for: ${directArtist.name}`);
                    return await this.fetchArtistInfo(directArtist.slug);
                }

                // 2. Fallback to resource site lookup for MyAnimeList ID
                const url = `${THEMES_ENDPOINT}/resource?filter[site]=MyAnimeList&filter[external_id]=${malId}&include=artist`;
                console.log(`[ThemesUtils] Fetching from resource endpoint: ${url}`);
                const response = await axios.get(url, { timeout: 8000 });
                const resources = response.data?.resources || (response.data?.resource ? [response.data.resource] : []);
                
                if (resources.length > 0 && resources[0].artist) {
                    const artistSlug = resources[0].artist.slug;
                    console.log(`[ThemesUtils] Successfully resolved MAL ID ${malId} to artist slug: ${artistSlug}`);
                    return await this.fetchArtistInfo(artistSlug);
                }
                
                console.warn(`[ThemesUtils] No artist found for MAL ID ${malId} via resource endpoint`);
                
                // Fallback: If MAL lookup failed, try to treat it as a direct AnimeThemes internal artist ID via filter
                try {
                    console.log(`[ThemesUtils] MAL lookup failed, trying direct AnimeThemes ID filter lookup for: ${malId}`);
                    const directFilterUrl = `${THEMES_ENDPOINT}/artist?filter[id]=${malId}&include=images`;
                    const directFilterRes = await axios.get(directFilterUrl, { timeout: 10000 });
                    const directFilterArtist = directFilterRes.data?.artists?.[0] || null;
                    if (directFilterArtist) {
                        console.log(`[ThemesUtils] ✓ Direct AnimeThemes ID filter fetch successful for artist: ${directFilterArtist.name}`);
                        return await this.fetchArtistInfo(directFilterArtist.slug);
                    }
                } catch (eDirect) {
                    console.log(`[ThemesUtils] Direct ID filter lookup failed, moving to next fallback...`);
                }

                // Fallback: Try the direct artist filter just in case
                const altUrl = `${THEMES_ENDPOINT}/artist?filter[site]=MyAnimeList&filter[external_id]=${malId}&include=images`;
                console.log(`[ThemesUtils] Trying fallback artist filter: ${altUrl}`);
                const altRes = await axios.get(altUrl, { timeout: 5000 });
                const artists = altRes.data?.artists || [];
                if (artists.length > 0) {
                    console.log(`[ThemesUtils] Fallback successful: Found artist ${artists[0].name}`);
                    return await this.fetchArtistInfo(artists[0].slug);
                }

                return null;
            } catch (error) {
                console.error(`[ThemesUtils] Error resolving artist for MAL ID ${malId}:`, error.message);
                if (error.response) console.error(`[ThemesUtils] API Response:`, error.response.status, error.response.data);
                return null;
            }
        });
    },

    async fetchArtistInfo(slugOrId) {
        console.log(`[ThemesUtils] fetchArtistInfo called for: "${slugOrId}"`);
        const isNumeric = !isNaN(slugOrId) && String(slugOrId).trim() !== '';
        
        if (isNumeric) {
            return await this.fetchArtistByMalId(slugOrId);
        }

        const slug = String(slugOrId).trim().toLowerCase();
        const cacheKey = `themes_artist_${slug}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        // Fetch using the direct artist endpoint with layered includes (without the invalid resources relationship)
        const includesTiers = [
            'images,songs.animethemes.anime.images,songs.animethemes.animethemeentries.videos,songs.animethemes.animethemeentries.videos.audio',
            'images,songs.animethemes.anime.images,songs.animethemes.animethemeentries.videos',
            'images,songs.animethemes.anime.images'
        ];

        for (const includes of includesTiers) {
            try {
                const url = `${THEMES_ENDPOINT}/artist/${encodeURIComponent(slug)}?include=${includes}`;
                console.log(`[ThemesUtils] Fetching artist detail: ${url}`);
                const res = await limiter.schedule(() => axios.get(url, { timeout: 12000 }));
                const data = res.data?.artist || null;
                
                if (data) {
                    cache.set(cacheKey, data, 3600);
                    console.log(`[ThemesUtils] ✓ Found artist: ${data.name || data.slug} with ${data.songs?.length || 0} songs`);
                    return data;
                }
            } catch (e) {
                if (e.response?.status === 422) {
                    console.log(`[ThemesUtils] 422 for includes tier: ${includes.substring(0, 40)}..., trying lighter...`);
                    continue; 
                }
                if (e.response?.status === 404) {
                    console.warn(`[ThemesUtils] Artist "${slug}" genuinely not found (404)`);
                    return null;
                }
                throw e; // Rethrow network/server errors
            }
        }

        return null;
    }
}
;

module.exports = themesUtils;
