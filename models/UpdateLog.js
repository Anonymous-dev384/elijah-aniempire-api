const mongoose = require('mongoose');

// First, let's create a schema to track our last update
const UpdateLogSchema = new mongoose.Schema({
    lastUpdate: Date,
    lastEtag: String,  // GitHub's ETag for checking if content changed
    status: String,
    error: String
});

const UpdateLog = mongoose.model('UpdateLog', UpdateLogSchema);
module.exports = UpdateLog;