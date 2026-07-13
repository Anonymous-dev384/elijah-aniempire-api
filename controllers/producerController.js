const { jikanFunctions } = require('../utils/jikanUtils');

const getProducers = async (req, res, next)=> {
    const { page } = req.query;
    try {
        const producersData = await jikanFunctions.loadProducers(page); 
        res.json(producersData); 
    } catch (error) {
        next(error);
    }
};

const getProducer = async (req, res, next) => {
    const { id } = req.params;
    try {
        const data = await jikanFunctions.rawFetch(`https://api.jikan.moe/v4/producers/${id}`);
        res.json(data);
    } catch (error) {
        console.error(`Error fetching producer ${id}:`, error.message);
        next(error);
    }
};

module.exports = {
    getProducers,
    getProducer,
};
