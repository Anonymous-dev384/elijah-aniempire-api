const yomu = require('yomu-api');
const FuzzyMatcher = require('../../utils/fuzzyMatcher');

class Yomu {
    constructor() {
        this.providers = {
            'mangafire': yomu.models.mangafire,
            'mangapill': new yomu.models.mangapill(),
            'flamecomics': new yomu.models.flamecomics(),
            'mangapark': new yomu.models.mangapark(),
        };
        this.name = 'yomu';
    }

    getProvider(name) {
        const p = this.providers[name.toLowerCase()];
        if (!p) throw new Error(`Yomu manga provider ${name} not found`);
        return p;
    }

    async executeProviderRequestWithRetry(requestFn, providerName, retries = 3) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                return await requestFn();
            } catch (error) {
                if (this.isLogicalFailure(error)) throw error;
                if (attempt === retries) throw error;
                const totalDelay = (2500 * Math.pow(1.5, attempt)) + (Math.random() * 1000);
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
        const results = await this.executeProviderRequestWithRetry(
            () => providerName === 'mangafire' ? provider.search(query, page) : provider.searchManga(query),
            providerName
        );
        return results;
    }

    async resolveMangaId(providerName, title, altTitles = []) {
        try {
            const results = await this.search(providerName, title);
            const items = results.results || results;
            if (!items || items.length === 0) return null;

            const { match } = FuzzyMatcher.findBestMatch(title, items, ['title', 'name']);
            if (match) return match.id || match.session;

            return items[0].id || items[0].session;
        } catch (error) {
            console.warn(`Yomu (${providerName}) resolveMangaId error:`, error.message);
            return null;
        }
    }

    async getChapters(providerName, mangaId, language = 'EN') {
        const provider = this.getProvider(providerName);
        
        if (providerName === 'mangafire') {
            let chaptersData = await this.executeProviderRequestWithRetry(
                () => provider.getChapters(mangaId, language),
                providerName
            );

            // If we got languages instead of chapters (happens if language wasn't matched)
            if (Array.isArray(chaptersData) && chaptersData.length > 0 && chaptersData[0].chapters) {
                const firstLang = chaptersData[0].id;
                chaptersData = await this.executeProviderRequestWithRetry(
                    () => provider.getChapters(mangaId, firstLang),
                    providerName
                );
            }

            if (!chaptersData || !chaptersData.length) return [];

            return chaptersData.map(ch => ({
                id: ch.chapterId || ch.id || ch.session,
                number: ch.number || ch.episode || ch.chapter,
                title: ch.title || `Chapter ${ch.number || ch.episode || ch.chapter || 'N/A'}`,
                date: ch.date || ch.created_at || ch.release_date
            }));
        }

        const info = await this.executeProviderRequestWithRetry(() => provider.getMangaById(mangaId), providerName);
        if (!info || !info.chapters) return [];

        return info.chapters.map(ch => {
            let num = ch.number || ch.chapter;
            if (num === undefined || num === null) {
                // Parse from title (e.g. "Chapter 162")
                const titleStr = ch.title || '';
                const match = titleStr.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i);
                if (match && match[1]) {
                    num = match[1];
                } else {
                    // Parse from id (e.g. "3-10162000/monster-chapter-162")
                    const idStr = ch.id || '';
                    const idMatch = idStr.match(/(?:chapter|ch[-/])(\d+(?:\.\d+)?)/i);
                    if (idMatch && idMatch[1]) {
                        num = idMatch[1];
                    }
                }
            }
            return {
                id: ch.id,
                number: num,
                title: ch.title || `Chapter ${num || 'N/A'}`,
                date: ch.date
            };
        });
    }

    async getPages(providerName, chapterId, mangaId) {
        const provider = this.getProvider(providerName);
        
        const pageData = await this.executeProviderRequestWithRetry(
            () => providerName === 'mangafire' ? provider.getChapterImages(chapterId) : provider.getMangaChapter(mangaId, chapterId),
            providerName
        );
        
        return {
            pages: pageData.images || pageData.pages || pageData
        };
    }
}

module.exports = new Yomu();
