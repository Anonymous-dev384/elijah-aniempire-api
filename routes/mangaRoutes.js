const express = require('express');
const { 
    search,
    getManga, 
    getMangaFull,
    getMangaGenres, 
    getMangaCharacter,
    getMangaPerson,
    getMangaReviews,
    getRecentMangaReviews,
    getMangaRecommendations, 
    getMangaPictures, 
    getMangaEpisodes,
    getMangaStatistics,
    getMangaNews,
    getMangaForum,
    getMangaMoreinfo,
    getMangaUserupdates,
    getMangaRelations,
    getTopManga,
    getMangaExternal,
    getRandomManga,
    getMangaChapters,
    getMangaChapterPages

} = require('../controllers/mangaController');

const router = express.Router();

// BECAREFUL: The order of the routes matters. Code may fail if the order is changed.

router.get('/manga/search', search);
router.get('/manga/top', getTopManga); 
router.get('/manga/random', getRandomManga);
router.get('/manga/genres', getMangaGenres);
router.get('/manga/recommendations', getMangaRecommendations);
router.get('/manga/reviews', getRecentMangaReviews);
router.get('/manga/:id/full', getMangaFull);
router.get('/manga/:id', getManga);
router.get('/manga/:id/character', getMangaCharacter); 
router.get('/manga/:id/person', getMangaPerson); 
router.get('/manga/:id/reviews', getMangaReviews);
router.get('/manga/:id/recommendations', getMangaRecommendations);
router.get('/manga/:id/pictures', getMangaPictures); 
router.get('/manga/:id/episodes', getMangaEpisodes); 
router.get('/manga/:id/statistics', getMangaStatistics); 
router.get('/manga/:id/news', getMangaNews); 
router.get('/manga/:id/forum', getMangaForum); 
router.get('/manga/:id/moreinfo', getMangaMoreinfo); 
router.get('/manga/:id/userupdates', getMangaUserupdates); 
router.get('/manga/:id/relations', getMangaRelations); 
router.get('/manga/:id/external', getMangaExternal); 
router.get('/manga/:id/anilist', require('../controllers/mangaController').getAniListDetails);

router.get('/manga/:id/chapters', getMangaChapters);
// Handle chapter ID that may contain slashes
router.get('/manga/read/*', (req, res, next) => {
    const pathParts = req.originalUrl.split('/manga/read/');
    if (pathParts.length > 1) {
        let chapterId = pathParts[1];
        if (chapterId.includes('?')) {
            chapterId = chapterId.split('?')[0];
        }
        req.params.chapterId = chapterId;
    }
    getMangaChapterPages(req, res, next);
});

module.exports = router;

