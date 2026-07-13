const animepahe = require('animepahe-api'); // Trigger reload reverted
const FuzzyMatcher = require('../../utils/fuzzyMatcher');



class AnimePahe {
    constructor() {
        this.name = 'animepahe';
        this.initPromise = this._initLibrary();
    }

    async _initLibrary() {
        try {
            const proxyService = require('../proxyService');
            const proxies = proxyService.getAllProxies();
            if (proxies && proxies.length > 0) {
                animepahe.Config.updateProxies(proxies);
                animepahe.Config.proxyEnabled = true;
                console.log(`[AnimePahe] Library initialized with ${proxies.length} proxy configs.`);
            }
            // Also initialize cookies if needed
            await animepahe.initialize().catch(() => {});
            return true;
        } catch (e) {
            console.error('[AnimePahe] Library init failed:', e.message);
            return false;
        }
    }

    async executeProviderRequestWithRetry(requestFn, providerName = 'animepahe', retries = 3) {
        await this.initPromise; // Ensure library is ready
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                return await requestFn();
            } catch (error) {
                if (this.isLogicalFailure(error)) throw error;
                if (attempt === retries) throw error;
                const totalDelay = (2000 * Math.pow(1.5, attempt)) + (Math.random() * 1000);
                await this.delay(totalDelay);
            }
        }
    }

    isLogicalFailure(error) {
        if (!error || !error.message) return false;
        const msg = error.message.toLowerCase();
        const status = error.response?.status;
        return status === 404 || msg.includes('not found') || msg.includes('does not exist') || msg.includes('no search results found');
    }

    delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    async search(title, page = 1) {
        try {
            const results = await this.executeProviderRequestWithRetry(() => animepahe.search(title));
            return { results: results.data || results };
        } catch (error) {
            console.error('AnimePahe search error:', error.message);
            return { results: [] };
        }
    }

    async resolveAnimeId(title, altTitles = [], malId, anilistId) {
        const isJapanese = (str) => /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/.test(str);
        const allTitles = [title, ...altTitles].filter(Boolean);
        
        // Reorder search queries: prioritize English/Romaji over Japanese characters to avoid wasting search budget
        const nonJpTitles = allTitles.filter(t => !isJapanese(t));
        const jpTitles = allTitles.filter(t => isJapanese(t));
        const sortedTitles = [...new Set([...nonJpTitles, ...jpTitles])];
        
        const titlesToTry = sortedTitles.slice(0, 4); // Limit title search attempts to 4 to prevent API timeouts
        const totalStart = Date.now();
        const TOTAL_BUDGET_MS = 60000; // 60s total budget for ALL title attempts
        const PER_SEARCH_TIMEOUT = 25000; // 25s per individual search
        
        for (const searchTitle of titlesToTry) {
            // Check if we've exceeded our total budget
            const elapsed = Date.now() - totalStart;
            if (elapsed >= TOTAL_BUDGET_MS) {
                console.log(`[AnimePahe] Total timeout budget (${TOTAL_BUDGET_MS}ms) exceeded after ${elapsed}ms. Giving up.`);
                break;
            }
            
            const remainingBudget = TOTAL_BUDGET_MS - elapsed;
            const searchTimeout = Math.min(PER_SEARCH_TIMEOUT, remainingBudget);
            
            try {
                // Use a tight timeout per search — if AnimePahe's DDoS-Guard is slow, move to the next title
                const searchResults = await Promise.race([
                    this.executeProviderRequestWithRetry(() => animepahe.search(searchTitle), 'animepahe', 1), // Only 1 retry
                    new Promise((_, reject) => setTimeout(() => reject(new Error('search timeout')), searchTimeout))
                ]);
                const results = searchResults.data || searchResults;
                const rCount = results?.length || 0;
                console.log(`[AnimePahe] Search for "${searchTitle}" returned ${rCount} results.`);

                if (!results || results.length === 0) continue;
                
                const candidates = results.map(r => ({
                    id: r.session || r.id,
                    name: r.title || r.name || 'Unknown',
                    type: r.type,
                    status: r.status
                }));

                console.log(`[AnimePahe] Candidates: ${candidates.map(c => c.name).join(', ')}`);

                let bestMatch = null;
                let bestScore = 0;

                // Compare candidates against ALL alternative titles (not just the sliced titlesToTry)
                // to allow matches on English titles that were excluded from the search attempt list.
                for (const candidate of candidates) {
                    for (const t of allTitles) {
                        const score = FuzzyMatcher.getSimilarity(t, candidate.name);
                        if (score > bestScore) {
                            bestScore = score;
                            bestMatch = candidate;
                        }
                    }
                }
                
                console.log(`[AnimePahe] Best match for search "${searchTitle}": "${bestMatch?.name}" (Score: ${bestScore})`);
                
                if (bestMatch && bestScore > 0.6) {
                    return bestMatch.id;
                }
            } catch (error) {
                // Don't log timeout errors, they're expected
                if (!error.message?.includes('timeout')) {
                    console.warn(`[AnimePahe] Search error for "${searchTitle}": ${error.message}`);
                }
            }
        }
        return null;
    }

    async getAnimeById(animeId, targetEpNum = null) {
        const info = await this.executeProviderRequestWithRetry(() => animepahe.getInfo(animeId));
        
        let page = 1;
        if (targetEpNum) {
            page = Math.ceil(parseInt(targetEpNum) / 30);
            if (page < 1) page = 1;
        }

        const episodesResp = await this.executeProviderRequestWithRetry(() => animepahe.getReleases(animeId, 'episode_asc', page));
        let data = episodesResp.data || [];
        const paginationInfo = episodesResp.paginationInfo || { lastPage: 1 };

        // Self-heal: if target episode isn't in this page, check adjacent pages
        if (targetEpNum && data.length > 0) {
            const hasTarget = data.some(ep => parseInt(ep.episode) === parseInt(targetEpNum));
            if (!hasTarget) {
                const firstInPage = parseInt(data[0].episode);
                const lastInPage = parseInt(data[data.length - 1].episode);
                if (parseInt(targetEpNum) < firstInPage && page > 1) {
                    const prevResp = await this.executeProviderRequestWithRetry(() => animepahe.getReleases(animeId, 'episode_asc', page - 1));
                    data = [...(prevResp.data || []), ...data];
                } else if (parseInt(targetEpNum) > lastInPage && paginationInfo.lastPage > page) {
                    const nextResp = await this.executeProviderRequestWithRetry(() => animepahe.getReleases(animeId, 'episode_asc', page + 1));
                    data = [...data, ...(nextResp.data || [])];
                }
            }
        }

        const episodes = data.map(ep => ({
            id: ep.session,
            number: ep.episode,
            title: `Episode ${ep.episode}`
        }));

        console.log(`[AnimePahe] Found ${episodes.length} episodes. Range: ${episodes[0]?.number} - ${episodes[episodes.length - 1]?.number}`);

        return {
            id: animeId,
            title: info?.title || 'Unknown',
            episodes: episodes,
            totalEpisodes: episodesResp.paginationInfo?.total || (episodes.length > 0 ? episodes[episodes.length - 1].number : 0)
        };
    }

    async getEpisodeServers(episodeId, title = null) {
        // AnimePahe sources usually contain both sub and dub within the same episode ID.
        // We return both 'sub' and 'dub' servers so the frontend displays both options
        // when switching back to this provider.
        return [
            { name: 'kwik', id: episodeId, cat: 'sub' },
            { name: 'kwik', id: episodeId, cat: 'dub' }
        ];
    }

    async getEpisodeSources(episodeId, serverId, category = 'sub', animeId = null, title = null, targetEpNum = null) {
        // AnimePahe needs animeSession (animeId) and episodeSession (episodeId)
        // Pass null for category to force resolving ALL download links (both sub and dub)
        let streamingData = await this.executeProviderRequestWithRetry(() => animepahe.getStreamingLinks(animeId, episodeId, true, null));
        
        const mapSources = (data) => (data.sources || []).map(src => {
            const resolution = (src.resolution || '').toLowerCase();
            const audio = (src.audio || '').toLowerCase();
            const isDub = src.isDub || resolution.includes('dub') || audio === 'eng' || audio === 'english';
            return {
                url: src.url,
                quality: src.resolution,
                isM3U8: src.isM3U8 || src.url?.includes('.m3u8'),
                isDub: isDub,
                embed: src.embed || null
            };
        });

        let allSources = mapSources(streamingData);
        let sources = allSources.filter(src => category === 'dub' ? src.isDub === true : src.isDub !== true);

        // SELF-HEAL: If Dub was requested but no Dub sources found, try to resolve a dedicated (Dub) version of the show
        if (category === 'dub' && sources.length === 0 && title && targetEpNum) {
            console.log(`[AnimePahe] No Dub sources in primary ID. Searching for "${title} (Dub)"...`);
            const dubAnimeId = await this.resolveAnimeId(`${title} (Dub)`, [], null, null);
            if (dubAnimeId && dubAnimeId !== animeId) {
                try {
                    const dubInfo = await this.getAnimeById(dubAnimeId, targetEpNum);
                    const dubEp = dubInfo.episodes.find(ep => parseInt(ep.number) === parseInt(targetEpNum));
                    if (dubEp) {
                        console.log(`[AnimePahe] Found Dub session ID: ${dubEp.id}`);
                        // Pass null for category to force resolving ALL download links
                        const dubStreamingData = await this.executeProviderRequestWithRetry(() => animepahe.getStreamingLinks(dubAnimeId, dubEp.id, true, null));
                        const dubSources = mapSources(dubStreamingData);
                        if (dubSources.length > 0) {
                            allSources = dubSources;
                            sources = dubSources;
                            streamingData = dubStreamingData;
                        }
                    }
                } catch (e) {
                    console.error(`[AnimePahe] Failed to fetch Dub sources from dedicated ID: ${e.message}`);
                }
            }
        }

        if (sources.length === 0) {
            console.log(`[AnimePahe] No sources found for category ${category}, falling back to all available sources.`);
            sources = allSources;
        }
        
        // Build downloads array from the streaming data
        const downloads = (streamingData.downloads || []).map(dl => ({
            quality: dl.quality || `${dl.resolution}p`,
            resolution: dl.resolution,
            url: dl.download || dl.pahe || null,
            downloadPage: dl.downloadPage || null,
            filename: dl.filename || null,
            pahe: dl.pahe || null,
            fansub: dl.fansub || null,
            filesize: dl.filesize || null,
            isDub: dl.isDub || false
        }));

        return { 
            sources, 
            downloads,
            hasDub: allSources.some(s => s.isDub === true),
            hasSub: allSources.some(s => s.isDub !== true)
        };
    }
}

module.exports = new AnimePahe();
