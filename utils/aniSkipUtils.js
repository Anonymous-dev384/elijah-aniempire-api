const axios = require('axios');
const NodeCache = require('node-cache');

const aniskipCache = new NodeCache({ stdTTL: 86400 }); // 24hr cache
const ANISKIP_API_URL = 'https://api.aniskip.com/v2/skip-times';

/**
 * Get skip times (intro/outro) for an anime episode from AniSkip
 * @param {string|number} malId 
 * @param {string|number} episode 
 * @param {number} episodeLength 
 */
async function getSkipTimes(malId, episode, episodeLength = 0) {
    const cacheKey = `aniskip_${malId}_${episode}`;
    const cached = aniskipCache.get(cacheKey);
    if (cached) return cached;

    try {
        // AniSkip requires MAL ID. 
        // episodeLength is optional but helps with accuracy.
        const url = `${ANISKIP_API_URL}/${malId}/${episode}?types[]=op&types[]=ed&types[]=mixed-op&types[]=mixed-ed&types[]=recap&episodeLength=${episodeLength}`;
        const response = await axios.get(url, { timeout: 5000 });

        if (response.data && response.data.found) {
            const results = response.data.results || [];
            const intro = results.find(r => r.skipType === 'op' || r.skipType === 'mixed-op' || r.skipType === 'recap');
            const outro = results.find(r => r.skipType === 'ed' || r.skipType === 'mixed-ed');

            const result = {
                found: true,
                intro: intro ? { start: intro.interval.startTime, end: intro.interval.endTime } : null,
                outro: outro ? { start: outro.interval.startTime, end: outro.interval.endTime } : null
            };

            aniskipCache.set(cacheKey, result);
            return result;
        }

        const noFoundResult = { found: false, intro: null, outro: null };
        aniskipCache.set(cacheKey, noFoundResult, 3600); // Cache negative result for 1hr
        return noFoundResult;
    } catch (err) {
        // If AniSkip is down or returns 404, we still cache a "not found" to avoid spamming them
        const result = { found: false, intro: null, outro: null };
        const ttl = err.response?.status === 404 ? 3600 : 300; // 1hr for 404, 5min for server errors
        aniskipCache.set(cacheKey, result, ttl);
        
        if (err.response?.status !== 404) {
            console.warn(`[AniSkip Utils] Error for MAL ${malId} Ep ${episode}:`, err.message);
        }
        return result;
    }
}

module.exports = {
    getSkipTimes
};
