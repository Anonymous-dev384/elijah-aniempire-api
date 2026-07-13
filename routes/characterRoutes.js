const express = require('express');
const {
    search,
    getCharacter,
    getCharacterFull,
    getCharacterPictures, 
    getCharacterAnime, 
    getCharacterManga,
    getCharacterVoices,
    getRandomCharacter,
    getTopCharacter
} = require('../controllers/characterController');

const router = express.Router();

router.get('/character/search', search);
router.get('/character/:id', getCharacter);
router.get('/character/:id/full', getCharacterFull);
router.get('/character/:id/pictures', getCharacterPictures);
router.get('/character/:id/anime', getCharacterAnime);
router.get('/character/:id/manga', getCharacterManga);
router.get('/character/:id/voices', getCharacterVoices);
router.get('/character/random', getRandomCharacter);
router.get('/character/top', getTopCharacter);

module.exports = router;

