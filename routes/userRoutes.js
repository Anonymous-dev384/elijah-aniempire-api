const express = require('express');
const { getUser, getAnimelist, getMangalist, getUserFavorites, getUserStatistics, getRandomUser } = require('../controllers/userController');

const router = express.Router();

router.get('/user/:username', getUser);

router.get('/user/animelist/:username', getAnimelist);

router.get('/user/mangalist/:username', getMangalist);

router.get('/user/favorites/:username', getUserFavorites);

router.get('/user/statistics/:username', getUserStatistics);

router.get('/user/random', getRandomUser);

module.exports = router;