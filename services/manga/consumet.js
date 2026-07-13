const { MANGA } = require('@consumet/extensions');
const FuzzyMatcher = require('../../utils/fuzzyMatcher');

class Consumet {
    constructor() {
        this.providers = {
            'mangadex': new MANGA.MangaDex(),
        };
        this.name = 'consumet';
    }

    getProvider(name) {
        const p = this.providers[name.toLowerCase()];
        if (!p) throw new Error(`Consumet manga provider ${name} not found`);
        return p;
    }

    async executeProviderRequestWithRetry(requestFn, providerName, retries = 3) {
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
        return status === 404 || msg.includes('not found') || msg.includes('no results') || msg.includes('invalid id');
    }

    delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    async search(providerName, query, page = 1) {
        const provider = this.getProvider(providerName);
        const results = await this.executeProviderRequestWithRetry(() => provider.search(query, page), providerName);
        return results;
    }

    async resolveMangaId(providerName, title, altTitles = []) {
        try {
            const results = await this.search(providerName, title);
            const items = results.results || results;
            if (!items || items.length === 0) return null;

            const { match } = FuzzyMatcher.findBestMatch(title, items, ['title', 'name']);
            if (match) return match.id;

            return items[0].id;
        } catch (error) {
            console.warn(`Consumet (${providerName}) resolveMangaId error:`, error.message);
            return null;
        }
    }

    async getChapters(providerName, mangaId, language = 'EN') {
        const provider = this.getProvider(providerName);
        const info = await this.executeProviderRequestWithRetry(() => provider.fetchMangaInfo(mangaId), providerName);
        const chaptersData = info.chapters || info.chaptersList || info.data;
        if (!chaptersData || !chaptersData.length) return [];

        return chaptersData.map(ch => ({
            id: ch.id || ch.attributes?.id,
            number: ch.chapterNumber || ch.number || ch.chapter || ch.attributes?.chapter,
            title: ch.title || ch.attributes?.title || `Chapter ${ch.chapterNumber || ch.number || ch.chapter || ch.attributes?.chapter || 'N/A'}`,
            date: ch.date || ch.attributes?.updatedAt || ch.attributes?.publishAt
        }));
    }

    async getPages(providerName, chapterId) {
        const provider = this.getProvider(providerName);
        const pageData = await this.executeProviderRequestWithRetry(() => provider.fetchChapterPages(chapterId), providerName);
        return {
            pages: pageData.images || pageData.pages || pageData
        };
    }
}

module.exports = new Consumet();
