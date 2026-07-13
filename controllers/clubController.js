const { jikanFunctions } = require('../utils/jikanUtils');

const getClub = async (req, res, next) => {
    const { id } = req.params;
    try {
        const clubData = await jikanFunctions.loadClub(id); 
        res.json(clubData); 
    } catch (error) {
        next(error);
    }
};

const getClubMember = async (req, res, next) => {
    const { page } = req.query;
    const { id } = req.params;
    try {
        const clubData = await jikanFunctions.loadClub(id, 'members', page); 
        res.json(clubData); 
    } catch (error) {
        next(error);
    }
}

const getClubStaff = async (req, res, next) => {
    const { id } = req.params; 
    try {
        const clubData = await jikanFunctions.loadClub(id, 'staff'); 
        res.json(clubData);
    } catch (error) {
        next(error);
    }
};

const getClubRelations = async (req, res, next) => {
    const { id } = req.params; 
    try {
        const clubData = await jikanFunctions.loadClub(id, 'relations'); 
        res.json(clubData);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getClub,
    getClubMember,
    getClubStaff,
    getClubRelations
};
