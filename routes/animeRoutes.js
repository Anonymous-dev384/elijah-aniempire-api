const express = require('express');
const { 
    search, 
    getAnime, 
    getAnimeFull,
    getAnimeEpisode,
    getAniListDetails,
    loadWatch,
    getAnimeRecommendations, 
    getAnimeGenres, 
    getAnimeStaff, 
    getAnimeCharacter, 
    getAnimeReviews,
    getRecentAnimeReviews,
    getAnimeSchedule, 
    getRandomAnime, 
    getTopAnime,
    getAnimePictures, 
    getSeason,
    getUpcomingSeason, 
    getSeasonArchive,
    getAnimeRelations,
    getAnimeThemes,
    getFeaturedTheme,
    getPopularThemes,
    getNewThemes,
    searchThemes,
    getArtistThemes,
    getBatchThemes,
    getSeasonalThemes,
    getAnimeStatitics,
    getAnimeNews,
    getAnimeForum,
    getAnimeVideos,
    getAnimeVideosepisodes,
    getAnimeMoreinfo,
    getAnimeUserupdates,
    getAnimeExternal,
    getZoroServers, // Legacy
    getZoroStreamingLinks, // Legacy
    getStreamingServers, // New generic
    getStreamingSources, // New generic
    getEpisodeWatchData,
    getAniskipTimes,
    getRecentEpisodes

} = require('../controllers/animeController');

const router = express.Router();

// BECAREFUL: The order of the routes matters. Code may fail if the order is changed.

router.get('/anime/recent-episodes', getRecentEpisodes);
router.get('/anime/search', search);
router.get('/anime/genres', getAnimeGenres);
router.get('/anime/random', getRandomAnime);
router.get('/anime/top', getTopAnime);
router.get('/anime/themes/featured', getFeaturedTheme);
router.get('/anime/themes/popular', getPopularThemes);
router.get('/anime/themes/new', getNewThemes);
router.get('/anime/themes/search', searchThemes);
router.get('/anime/themes/artist/:slug', getArtistThemes);
router.get('/anime/themes/batch', getBatchThemes);
router.get('/anime/themes/seasonal', getSeasonalThemes);
router.get('/anime/recommendations', getAnimeRecommendations);
router.get('/anime/reviews', getRecentAnimeReviews);
router.get('/anime/:id/recommendations', getAnimeRecommendations);
router.get('/anime/staff/:id', getAnimeStaff);
router.get('/anime/:id/character', getAnimeCharacter);
router.get('/anime/:id/reviews', getAnimeReviews);
router.get('/anime/:id/statistics', getAnimeStatitics);
router.get('/anime/:id/relations', getAnimeRelations);
router.get('/anime/:id/themes', getAnimeThemes);
router.get('/anime/:id/anilist', getAniListDetails);
router.get('/anime/:id/news', getAnimeNews);
router.get('/anime/:id/forum', getAnimeForum);
router.get('/anime/:id/videos', getAnimeVideos);
router.get('/anime/:id/videosepisodes', getAnimeVideosepisodes);
router.get('/anime/:type/watch', loadWatch);
router.get('/anime/:id/episodes', getAnimeEpisode);
router.get('/anime/:id/episode/:episode/watch', getEpisodeWatchData);
router.get('/anime/:id/episode/:episode/skip-times', getAniskipTimes);
router.get('/anime/:id/episode/:episode', getAnimeEpisode);
router.get('/anime/:day/schedule', getAnimeSchedule);
router.get('/anime/:id/pictures', getAnimePictures); 
router.get('/anime/:id/moreinfo', getAnimeMoreinfo);
router.get('/anime/:id/userupdates', getAnimeUserupdates);
router.get('/anime/:id/external', getAnimeExternal);
// Not worth it.
// router.get('/anime/all/sources', getStreamingLinks);
router.get('/anime/streaming/servers', getStreamingServers);
router.get('/anime/streaming/sources', getStreamingSources);
// router.get('/anime/gogoanime/servers', getGogoServers); // DEPRECATED
// router.get('/anime/gogoanime/sources', getGogoStreamingLinks); // DEPRECATED
router.get('/anime/zoro/servers', getZoroServers); // Legacy support
router.get('/anime/zoro/sources', getZoroStreamingLinks); // Legacy support
router.get('/anime/seasons', getSeason); 
router.get('/anime/seasons/upcoming', getUpcomingSeason);
router.get('/anime/seasons/archive', getSeasonArchive); 
router.get('/anime/:id/full', getAnimeFull);
router.get('/anime/:id', getAnime);

module.exports = router;
