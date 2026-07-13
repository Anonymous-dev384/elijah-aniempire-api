const { jikanFunctions } = require('../utils/jikanUtils');

const getMagazines = async (req, res) => {
    const page = req.query.page || 1; 
    try {
        const magazinesData = await jikanFunctions.loadMagazines(page); 
        res.json(magazinesData);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Failed to fetch magazine data' });
    }
};

module.exports = {
    getMagazines,
};
