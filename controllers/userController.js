const { jikanFunctions } = require('../utils/jikanUtils');

const getUser = async (req, res, next) => {
    const { username } = req.params; 
    try {
        const userData = await jikanFunctions.loadUser(username); 
        res.json(userData); 
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user data' });
    }
};

const getAnimelist = async (req, res, next) => {
    const { username } = req.params; 
    const { limit, offset } = req.query; 
    try {
        const animelistData = await jikanFunctions.loadAnimelist(username, limit, offset);
        res.json(animelistData); 
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch anime list data' });
    }
};

const getMangalist = async (req, res, next) => {
    const { username } = req.params;
    const { limit, offset } = req.query; 
    try {
        const mangalistData = await jikanFunctions.loadMangalist(username, limit, offset); 
        res.json(mangalistData); 
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch manga list data' });
    }
};

const getUserFavorites = async (req, res, next) => {
    const { username } = req.params; 
    try {
        const favoritesData = await jikanFunctions.loadUser(username, 'favorites'); 
        res.json(favoritesData); 
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user favorites' });
    }
};

const getUserStatistics = async (req, res, next) => {
    const { username } = req.params; 
    try {
        const statsData = await jikanFunctions.loadUser(username, 'statistics');
        res.json(statsData); 
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user statistics' });
    }
};

const getRandomUser = async (req, res, next) => {
    try {
        const randomUser = await jikanFunctions.loadRandom('users');
        console.log(randomUser);
        res.json(randomUser);
    } catch (error) {
        console.error(error);
        next(error);
    }
}

module.exports = {
    getUser,
    getAnimelist,
    getMangalist,
    getUserFavorites,
    getUserStatistics,
    getRandomUser
};