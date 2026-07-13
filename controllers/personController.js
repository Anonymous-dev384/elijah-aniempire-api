const { jikanFunctions } = require('../utils/jikanUtils');

const getPerson = async (req, res, next) => {
    const { id } = req.params;
    try {
        const personData = await jikanFunctions.loadPerson(id);
        res.json(personData); 
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch person data' });
    }
};

const getPersonFull = async (req, res, next) => {
    const { id } = req.params;
    try {
        const data = await jikanFunctions.rawFetch(`https://api.jikan.moe/v4/people/${id}/full`);
        res.json(data);
    } catch (error) {
        console.warn(`Jikan /people/${id}/full failed with error: ${error.message}. Attempting modular fallback...`);
        try {
            // Fetch basic person info (much lighter and highly reliable)
            const basicRes = await jikanFunctions.rawFetch(`https://api.jikan.moe/v4/people/${id}`);
            if (!basicRes || !basicRes.data) {
                throw new Error("Basic person fetch failed");
            }
            
            // Fetch sub-resources in parallel, gracefully defaulting failures to empty lists
            const [animeRes, voicesRes, mangaRes] = await Promise.allSettled([
                jikanFunctions.rawFetch(`https://api.jikan.moe/v4/people/${id}/anime`),
                jikanFunctions.rawFetch(`https://api.jikan.moe/v4/people/${id}/voices`),
                jikanFunctions.rawFetch(`https://api.jikan.moe/v4/people/${id}/manga`)
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
            console.error(`Error fetching person fallback for ${id}:`, fallbackError.message);
            res.status(500).json({ error: 'Failed to fetch person data' });
        }
    }
};

const getPersonVoices = async (req, res, next) => {
    const { id } = req.params;

    try {
        const personVoiceData = await jikanFunctions.loadPerson(id, 'voices'); 
        res.json(personVoiceData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch person voice data' });
    }
};

const getPersonAnime = async (req, res, next) => {
    const { id } = req.params;

    try {
        const personAnimeData = await jikanFunctions.loadPerson(id, 'anime'); 
        res.json(personAnimeData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch person anime data' });
    }
};

const getPersonManga = async (req, res, next) => {
    const { id } = req.params;

    try {
        const personMangaData = await jikanFunctions.loadPerson(id, 'manga');
        res.json(personMangaData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch person manga data' });
    }
};

const getRandomPerson = async (req, res, next) => {
    try {
        const randomPerson = await jikanFunctions.loadRandom('people');
        console.log(randomPerson);
        res.json(randomPerson);
    } catch (error) {
        console.error(error);
        next(error);
    }
};

const getTopPeople = async (req, res, next) => {
    const { page, subtype, filter, limit } = req.query;
    
    try {
        const topPeople = await jikanFunctions.loadTop('people', { page, type: subtype, filter, limit });
        res.json(topPeople);
    } catch (error) {
        console.error(error);
        next(error);
    }
}

module.exports = {
    getPerson,
    getPersonFull,
    getPersonVoices,
    getPersonAnime, 
    getPersonManga, 
    getRandomPerson,
    getTopPeople
};
