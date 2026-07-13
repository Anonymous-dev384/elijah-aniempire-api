const errorHandler = (err, req, res, next) => {
    console.error(err);
    const status = err.status || 500;
    const message = err.message || 'Internal Server Error'; // Default message

    res.status(status).json({
        status: status,
        message: message,
    });
};

// Error handling middleware
const handleDatabaseError = (err, req, res, next) => {
    console.error('Database Error:', err);
    res.status(500).json({ 
        error: 'Database error occurred',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
};

module.exports = { handleDatabaseError, errorHandler };
