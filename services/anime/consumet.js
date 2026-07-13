const { ANIME } = require('@consumet/extensions');
const FuzzyMatcher = require('../../utils/fuzzyMatcher');

class Consumet {
    constructor() {
        this.providers = {
            'animesaturn': (() => {
                const as = new ANIME.AnimeSaturn();
                as.baseUrl = 'https://www.animesaturn.cx/';
                return as;
            })(),
            'animeunity': new ANIME.AnimeUnity(),
        };
        this.name = 'consumet';
        this.initPromise = this._initProxies();
    }

    async _initProxies() {
        try {
            // Consumet's setProxy expects a CORS relay URL (it prepends the proxy URL to the target URL).
            // This is NOT an HTTP forward proxy like Oxylabs — it needs a URL like:
            //   https://your-cors-proxy.com/api/proxy?url=
            // So that requests become: https://your-cors-proxy.com/api/proxy?url=https://animeunity.to/...
            const corsProxyUrl = process.env.CORS_PROXY_URL;
            if (corsProxyUrl) {
                Object.values(this.providers).forEach(provider => {
                    if (typeof provider.setProxy === 'function') {
                        provider.setProxy({ url: corsProxyUrl });
                    }
                });
                console.log('[Consumet] Providers initialized with CORS proxy:', corsProxyUrl.substring(0, 40) + '...');
            } else {
                console.warn('[Consumet] No CORS_PROXY_URL set. Consumet providers will make direct requests (may be blocked).');
            }
        } catch (e) {
            console.error('[Consumet] Proxy init failed:', e.message);
        }
    }

    getProvider(name) {
        const p = this.providers[name.toLowerCase()];
        if (!p) throw new Error(`Consumet provider ${name} not found`);
        return p;
    }

    async executeProviderRequestWithRetry(requestFn, providerName, retries = 1) {
        await this.initPromise;
        const isUnity = providerName?.toLowerCase() === 'animeunity';
        const timeoutMs = isUnity ? 30000 : 15000;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                // Add a timeout to prevent infinite hangs (30s for animeunity, 15s for others)
                return await Promise.race([
                    requestFn(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Provider request timed out')), timeoutMs))
                ]);
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
        const status = error.response?.status || (msg.match(/status code (\d+)/) ? parseInt(msg.match(/status code (\d+)/)[1]) : 0);
        // 404 = not found, 405 = method not allowed — both are non-retryable
        return [404, 405].includes(status) || msg.includes('not found') || msg.includes('does not exist');
    }

    delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    async search(providerName, title, page = 1) {
        const provider = this.getProvider(providerName);
        return await this.executeProviderRequestWithRetry(() => provider.search(title, page), providerName);
    }

    async getAnimeById(providerName, animeId) {
        const provider = this.getProvider(providerName);
        const info = await this.executeProviderRequestWithRetry(() => provider.fetchAnimeInfo(animeId), providerName);
        
        // Ensure totalEpisodes is available and correctly named
        if (info && !info.totalEpisodes && info.episodes?.length > 0) {
            info.totalEpisodes = Math.max(...info.episodes.map(e => parseInt(e.number) || 0));
        }

        return info;
    }

    async getEpisodeServers(providerName, episodeId) {
        const provider = this.getProvider(providerName);
        try {
            if (provider.fetchEpisodeServers) {
                const servers = await this.executeProviderRequestWithRetry(() => provider.fetchEpisodeServers(episodeId), providerName);
                if (servers && servers.length > 0) return servers;
            }
        } catch (err) {
            if (!err.message?.includes('not implemented')) {
                console.warn(`[Consumet] ${providerName} getEpisodeServers failed: ${err.message}`);
            }
        }
        // Fallback for providers that don't implement fetchEpisodeServers (like AnimeUnity sometimes)
        return [{ name: providerName === 'animeunity' ? 'AnimeUnity' : 'Default', id: episodeId }];
    }

    async getEpisodeSources(providerName, episodeId, serverId) {
        const provider = this.getProvider(providerName);
        try {
            const results = await this.executeProviderRequestWithRetry(() => provider.fetchEpisodeSources(episodeId, serverId), providerName);
            
            // Fix VixCloud (AnimeUnity) blocking requests without Referer on Vercel
            if (providerName === 'animeunity' && results && results.sources) {
                results.sources = results.sources.map(s => ({
                    ...s,
                    embed: s.embed || 'https://www.animeunity.to/'
                }));
            }
            
            return results;
        } catch (error) {
            // 405 = the provider's API endpoint doesn't support this method (common for AnimeUnity on certain episodes)
            const statusMatch = error.message?.match(/status code (\d+)/);
            const status = statusMatch ? parseInt(statusMatch[1]) : 0;
            if (status === 405) {
                console.warn(`[Consumet] ${providerName} returned 405 for episode ${episodeId} — source unavailable`);
                return null;
            }
            throw error;
        }
    }

    async resolveAnimeId(providerName, title, altTitles = [], malId = null) {
        // Deduplicate and limit to 6 unique titles
        const seen = new Set();
        const titlesToTry = [title, ...altTitles].filter(t => {
            if (!t) return false;
            const norm = t.toLowerCase().trim();
            if (seen.has(norm)) return false;
            seen.add(norm);
            return true;
        }).slice(0, 6);

        for (const searchTitle of titlesToTry) {
            let handled = false;
            try {
                const searchPromise = this.search(providerName, searchTitle);

                // Background handler for late resolutions
                if (malId) {
                    searchPromise.then(results => {
                        if (handled) return; // Main loop already handled this result
                        
                        if (!results || !results.results || results.results.length === 0) return;
                        
                        const candidates = results.results.map(r => ({ id: r.id, title: r.title, name: r.title || r.id, type: r.type }));
                        let bestMatch = null;
                        let bestScore = 0;
                        for (const candidate of candidates) {
                            for (const t of titlesToTry) {
                                const score = FuzzyMatcher.getSimilarity(t, candidate.name);
                                if (score > bestScore) {
                                    bestScore = score;
                                    bestMatch = candidate;
                                }
                            }
                        }
                        
                        if (bestMatch && bestScore > 0.45) {
                            console.log(`[Consumet] Background search found late ID for ${providerName}: ${bestMatch.id}`);
                            const animeMappingService = require('../animeMappingService');
                            animeMappingService.updateMapping(malId, {
                                [`${providerName}_id`]: bestMatch.id,
                                [`${providerName}_verified`]: true
                            }).catch(() => {});
                        }
                    }).catch(() => {}); // ignore background errors
                }

                const searchTimeout = providerName === 'animeunity' ? 20000 : 5000;
                // Use a tight per-search timeout - if it hasn't responded, the title probably doesn't exist on this provider
                const results = await Promise.race([
                    searchPromise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('search timeout')), searchTimeout))
                ]);
                
                handled = true; // Mark as handled so the background `.then()` skips it

                const rCount = results.results?.length || 0;
                console.log(`[Consumet] ${providerName} search for "${searchTitle}" returned ${rCount} results.`);
                
                if (!results.results || results.results.length === 0) continue;
                
                const candidates = results.results.map(r => ({ id: r.id, title: r.title, name: r.title || r.id, type: r.type }));
                
                let bestMatch = null;
                let bestScore = 0;

                for (const candidate of candidates) {
                    for (const t of titlesToTry) {
                        const score = FuzzyMatcher.getSimilarity(t, candidate.name);
                        if (score > bestScore) {
                            bestScore = score;
                            bestMatch = candidate;
                        }
                    }
                }
                
                console.log(`[Consumet] ${providerName} best match for search "${searchTitle}": "${bestMatch?.name}" (Score: ${bestScore})`);
                
                // For providers with localized titles (AnimeSaturn = Italian), accept weaker matches
                // when there's only 1 result — the provider's search already filtered for us
                const isLocalizedProvider = providerName === 'animesaturn';
                const threshold = (isLocalizedProvider && candidates.length === 1) ? 0.2 : 0.45;
                
                if (bestMatch && bestScore > threshold) {
                    if (isLocalizedProvider && bestScore < 0.45) {
                        console.log(`[Consumet] ${providerName}: Accepting weak match (${bestScore}) for localized title "${bestMatch.name}" (single result)`);
                    }
                    return bestMatch.id;
                } else if (bestMatch) {
                    console.log(`[Consumet] Match too weak for "${searchTitle}": "${bestMatch.name}" (Score: ${bestScore}, threshold: ${threshold})`);
                }
            } catch (error) {
                // Don't log timeout errors, they're expected for non-matching titles
                if (!error.message?.includes('timeout')) {
                    console.warn(`[Consumet] ${providerName} search error for "${searchTitle}": ${error.message}`);
                }
            }
        }
        return null;
    }
}

module.exports = new Consumet();
