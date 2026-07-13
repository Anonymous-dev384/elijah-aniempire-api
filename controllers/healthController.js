const AnimeMapping = require('../models/AnimeMapping');
const MangaMapping = require('../models/MangaMapping');
const { isDBConnected } = require('../config/db');
const { getQueueSize } = require('../services/queueService');

const getSystemStatus = async (req, res) => {
    try {
        const dbStatus = isDBConnected();
        
        let animeStats = { total: 0, mapped: 0 };
        let mangaStats = { total: 0, mapped: 0 };
        let queueSize = 0;

        if (dbStatus) {
            // Get stats with lean() for performance
            const totalAnime = await AnimeMapping.countDocuments();
            const mappedAnime = await AnimeMapping.countDocuments({ mapping_status: 'mapped' });
            
            const totalManga = await MangaMapping.countDocuments();
            const mappedManga = await MangaMapping.countDocuments({ mapping_status: 'mapped' });

            animeStats = { total: totalAnime, mapped: mappedAnime, percentage: totalAnime ? ((mappedAnime/totalAnime)*100).toFixed(2) : 0 };
            mangaStats = { total: totalManga, mapped: mappedManga, percentage: totalManga ? ((mappedManga/totalManga)*100).toFixed(2) : 0 };
            
            queueSize = await getQueueSize() || 0;
        }

        res.json({
            success: true,
            status: {
                database: dbStatus ? 'connected' : 'disconnected',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                version: '1.2.0'
            },
            coverage: {
                anime: animeStats,
                manga: mangaStats
            },
            worker: {
                queueSize: queueSize
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = {
    getSystemStatus
};
