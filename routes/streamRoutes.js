const express = require('express');
const router = express.Router();
const streamController = require('../controllers/streamController');

router.get('/download', streamController.downloadMedia);
router.post('/download', streamController.downloadMedia);

// Wildcard route to proxy any other stream requests to the streaming server
router.all('*', streamController.proxyKatalyst);

module.exports = router;
