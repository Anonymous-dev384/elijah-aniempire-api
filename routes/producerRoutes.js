const express = require('express');
const { getProducers, getProducer } = require('../controllers/producerController');

const router = express.Router();

router.get('/producers', getProducers);
router.get('/producers/:id', getProducer);

module.exports = router;
