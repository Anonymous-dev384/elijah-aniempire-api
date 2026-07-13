const express = require('express');
const { getSystemStatus } = require('../controllers/healthController');
const syncService = require('../services/syncService');
const { requireDB } = require('../middleware/dbGuard');

const router = express.Router();

router.get('/status', getSystemStatus);

// Manual trigger for airing sync (lightweight)
const authMiddleware = (req, res, next) => {
    const apiKey = req.headers.authorization?.split(' ')[1] || req.query.key;
    if (!apiKey || apiKey !== process.env.API_KEY) {
        return res.status(401).json({ error: 'Unauthorized - Invalid API key' });
    }
    next();
};

router.all('/sync/airing', requireDB, authMiddleware, async (req, res) => {
    const force = req.query.force === 'true' || req.method === 'POST';
    const result = await syncService.syncAiringAnime(force);
    res.json(result);
});

// Manual trigger for global sync (heavier, use with caution)
router.get('/sync/global/:type', requireDB, async (req, res) => {
    const { type } = req.params;
    const result = await syncService.syncGlobalIds(type);
    res.json(result);
});

module.exports = router;
