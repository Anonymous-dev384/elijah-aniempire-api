const express = require('express');
const { getPerson, getPersonFull, getPersonVoices, getPersonAnime, getPersonManga, getRandomPerson, getTopPeople } = require('../controllers/personController');

const router = express.Router();

router.get('/person/:id', getPerson);
router.get('/person/:id/full', getPersonFull);

router.get('/person/:id/voices', getPersonVoices);

router.get('/person/:id/anime', getPersonAnime);

router.get('/person/:id/manga', getPersonManga);

router.get('/person/random', getRandomPerson);

router.get('/person/top', getTopPeople);

module.exports = router;