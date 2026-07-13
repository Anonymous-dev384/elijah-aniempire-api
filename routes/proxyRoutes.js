const express = require('express');
const router = express.Router();
const proxyController = require('../controllers/proxyController');
const { requireDB } = require('../middleware/dbGuard');

// API Key middleware check
const authMiddleware = (req, res, next) => {
    const apiKey = req.headers.authorization?.split(' ')[1] || req.query.key;
    if (!apiKey || apiKey !== process.env.API_KEY) {
        return res.status(401).json({ error: 'Unauthorized - Invalid API key' });
    }
    next();
};

router.use(requireDB, authMiddleware);

router.post('/', proxyController.addProxy);
router.get('/', proxyController.getAllProxies);
router.delete('/:id', proxyController.deleteProxy);
router.post('/test-all', proxyController.testAllProxies);
router.post('/seed-oxylabs', proxyController.seedOxylabs);

module.exports = router;
