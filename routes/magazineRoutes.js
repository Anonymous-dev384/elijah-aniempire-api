const express = require('express');
const { getMagazines } = require('../controllers/magazineController');

const router = express.Router();

router.get('/magazines', getMagazines);

module.exports = router;
