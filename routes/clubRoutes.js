const express = require('express');
const { getClub, getClubMember, getClubStaff, getClubRelations } = require('../controllers/clubController');

const router = express.Router();

// Define route for getting club data
router.get('/club/:id', getClub);

// Route for getting club member(s) data
router.get('/club/:id/members/', getClubMember);

// Route for getting club staff data
router.get('/club/:id/staff/', getClubStaff);

// Route for getting club relations data
router.get('/club/:id/relations/', getClubRelations);



module.exports = router;
