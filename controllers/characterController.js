const { jikanFunctions } = require('../utils/jikanUtils');

const search = async (req, res, next) => {
    const { query, page, limit, ...filters } = req.query;

    try {
        const searchResults = await jikanFunctions.search('characters', query, limit, { page, ...filters });
        res.json(searchResults);
    } catch (error) {
        console.error(error);
        next(error);
    }
};

const getCharacter = async (req, res, next) => {
    const { id } = req.params;
    try {
        const characterData = await jikanFunctions.loadCharacter(id);
        res.json(characterData);
    } catch (error) {
        console.error(error);
        next(error);
    }
};

const getCharacterFull = async (req, res, next) => {
    const { id } = req.params;
    try {
        const data = await jikanFunctions.rawFetch(`https://api.jikan.moe/v4/characters/${id}/full`);
        res.json(data);
    } catch (error) {
        console.warn(`Jikan /characters/${id}/full failed with error: ${error.message}. Attempting modular fallback...`);
        try {
            // Fetch basic character info (much lighter and highly reliable)
            const basicRes = await jikanFunctions.rawFetch(`https://api.jikan.moe/v4/characters/${id}`);
            if (!basicRes || !basicRes.data) {
                throw new Error("Basic character fetch failed");
            }
            
            // Fetch sub-resources in parallel, gracefully defaulting failures to empty lists
            const [animeRes, voicesRes, mangaRes] = await Promise.allSettled([
                jikanFunctions.rawFetch(`https://api.jikan.moe/v4/characters/${id}/anime`),
                jikanFunctions.rawFetch(`https://api.jikan.moe/v4/characters/${id}/voices`),
                jikanFunctions.rawFetch(`https://api.jikan.moe/v4/characters/${id}/manga`)
            ]);

            const fullData = {
                data: {
                    ...basicRes.data,
                    anime: animeRes.status === 'fulfilled' ? (animeRes.value?.data || []) : [],
                    voices: voicesRes.status === 'fulfilled' ? (voicesRes.value?.data || []) : [],
                    manga: mangaRes.status === 'fulfilled' ? (mangaRes.value?.data || []) : []
                }
            };
            
            res.json(fullData);
        } catch (fallbackError) {
            console.error(`Error fetching character fallback for ${id}:`, fallbackError.message);
            res.status(500).json({ error: 'Failed to fetch character data' });
        }
    }
};

const getCharacterPictures = async (req, res, next) => {
    const { id } = req.params;
    try {
        const pictures = await jikanFunctions.loadCharacter(id, 'pictures');
        res.json(pictures);
    } catch (error) {
        console.error(error);
        next(error);
    }
};

const getCharacterAnime = async (req, res, next) => {
    const { id } = req.params;
    try {
        const animeAppearances = await jikanFunctions.loadCharacter(id, 'anime');
        res.json(animeAppearances);
    } catch (error) {
        console.error(error);
        next(error);
    }
};

const getCharacterManga = async (req, res, next) => {
    const { id } = req.params;
    try {
        const mangaAppearances = await jikanFunctions.loadCharacter(id, 'manga');
        res.json(mangaAppearances);
    } catch (error) {
        console.error(error);
        next(error);
    }
};

const getCharacterVoices = async (req, res, next) => {
    const { id } = req.params;

    try {
        const voices = await jikanFunctions.loadCharacter(id, 'voices');
        res.json(voices);
    } catch (error) {
        console.error(error);
        next(error);
    }
};

const getRandomCharacter = async (req, res, next) => {
    try {
        const randomAnime = await jikanFunctions.loadRandom('characters');
        console.log(randomAnime);
        res.json(randomAnime);
    } catch (error) {
        console.error(error);
        next(error);
    }
}

const getTopCharacter = async (req, res, next) => {
    const { page, subtype, filter, limit } = req.query;

    try {
        const topCharacters = await jikanFunctions.loadTop('characters', { page, type: subtype, filter, limit });
        res.json(topCharacters);
    } catch (error) {
        console.error(error);
        next(error);
    }
}

module.exports = {
    search,
    getCharacter,
    getCharacterFull,
    getCharacterPictures,
    getCharacterAnime,
    getCharacterManga,
    getCharacterVoices,
    getRandomCharacter,
    getTopCharacter
};
