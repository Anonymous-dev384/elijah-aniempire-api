const { Hianime } = require("hianime");
const FuzzyMatcher = require('../../utils/fuzzyMatcher');

class HiAnime {
    constructor() {
        this.hianime = new Hianime();
        this.name = 'zoro'; // Keeping internal name as zoro for mapping consistency
    }

    async executeProviderRequestWithRetry(requestFn, providerName = 'zoro', retries = 3) {
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
        return status === 404 || msg.includes('not found') || msg.includes('does not exist');
    }

    delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    async search(title, page = 1) {
        try {
            const results = await this.executeProviderRequestWithRetry(() => this.hianime.search(title, page));
            return results;
        } catch (error) {
            console.error('HiAnime search error:', error.message);
            throw error;
        }
    }

    async getAnimeById(animeId) {
        const episodes = await this.executeProviderRequestWithRetry(() => this.hianime.getEpisodes(animeId));
        return {
            id: animeId,
            episodes: Array.isArray(episodes) ? episodes : (episodes.episodes || [])
        };
    }

    async getEpisodeServers(episodeId) {
        return await this.executeProviderRequestWithRetry(() => this.hianime.getEpisodeServers(episodeId));
    }

    async getEpisodeSources(episodeId, serverId, category = 'sub') {
        return await this.executeProviderRequestWithRetry(() => this.hianime.getEpisodeSources(serverId, category));
    }

    async resolveAnimeId(title, altTitles = [], malId, anilistId) {
        try {
            const searchResults = await this.search(title);
            if (!searchResults.results || searchResults.results.length === 0) return null;

            const candidates = searchResults.results.map(r => ({
                id: r.dataId || r.id,
                title: r.title || r.name || r.jname,
                name: r.title || r.name || r.jname,
                type: r.type
            }));

            let { match, score } = FuzzyMatcher.findBestMatch(title, candidates);
            if (score < 0.7 && altTitles && altTitles.length > 0) {
                for (const altTitle of altTitles) {
                    if (!altTitle) continue;
                    const altResult = FuzzyMatcher.findBestMatch(altTitle, candidates);
                    if (altResult.score > score) {
                        score = altResult.score;
                        match = altResult.match;
                    }
                }
            }
            return (match && score > 0.7) ? match.id : null;
        } catch (error) {
            return null;
        }
    }
}

module.exports = new HiAnime();
