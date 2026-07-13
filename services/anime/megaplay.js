class MegaPlayProvider {
    /**
     * Get servers for MegaPlay
     * MegaPlay doesn't have an API to fetch servers, but we mock Sub/Dub to allow toggling
     */
    async getServers(episodeId) {
        return [
            { id: 'megaplay-sub', name: 'MegaPlay', cat: 'sub' },
            { id: 'megaplay-dub', name: 'MegaPlay', cat: 'dub' }
        ];
    }

    /**
     * Get sources (the iframe URL)
     * @param {string} episodeId - Used as malId because of our injection
     * @param {string} serverId 
     * @param {string} category - 'sub' or 'dub'
     * @param {string} animeId - Often equivalent to malId
     * @param {number} episodeNumber - The current episode
     */
    async getSources(episodeId, serverId, category, animeId, episodeNumber) {
        const malId = animeId || episodeId;
        const epNum = episodeNumber || 1;
        const lang = category || 'sub';
        
        const embedUrl = `https://megaplay.buzz/stream/mal/${malId}/${epNum}/${lang}`;
        
        return {
            isEmbed: true,
            sources: [],
            activeServer: {
                id: serverId,
                name: 'MegaPlay',
                cat: lang
            },
            embedUrl: embedUrl
        };
    }
}

module.exports = new MegaPlayProvider();
