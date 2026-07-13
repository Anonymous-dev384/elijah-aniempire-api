const router = require('express').Router();
const { manualUpdate, checkUpdateStatus, getMappingsById, backupMappings } = require('../controllers/mappingController');
const { manualMangaUpdate, checkMangaStatus } = require('../controllers/mangaMappingController');
const { requireDB } = require('../middleware/dbGuard');

// Anime Routes
router.get('/update-status', requireDB, checkUpdateStatus);
router.post('/update-mappings', requireDB, manualUpdate);
router.post('/backup-mappings', requireDB, backupMappings);
router.get('/:source/:id', requireDB, getMappingsById);

// Manga Routes
router.get('/manga-status', requireDB, checkMangaStatus);
router.post('/update-manga-mappings', requireDB, manualMangaUpdate);

module.exports = router;