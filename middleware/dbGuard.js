const { isDBConnected } = require('../config/db');

/**
 * Middleware: Returns 503 if DB is required but not connected.
 */
const requireDB = (req, res, next) => {
    if (!isDBConnected()) {
        return res.status(503).json({
            error: 'Database unavailable',
            message: 'This endpoint requires a database connection which is currently unavailable. Please try again later.'
        });
    }
    next();
};

module.exports = { requireDB };
