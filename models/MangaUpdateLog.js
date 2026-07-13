const mongoose = require('mongoose');

const mangaUpdateLogSchema = new mongoose.Schema({
    lastUpdate: { type: Date, default: Date.now },
    status: { type: String, enum: ['success', 'failed', 'in_progress'], default: 'success' },
    error: { type: String },
    lastEtag: { type: String } // Store ETag for conditional requests
});

module.exports = mongoose.model('MangaUpdateLog', mangaUpdateLogSchema);
