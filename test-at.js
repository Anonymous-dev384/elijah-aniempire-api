const axios = require('axios');
(async () => {
    try {
        const url = `https://api.animethemes.moe/song?filter[artist]=238&include=artists,animethemes.anime.images,animethemes.animethemeentries.videos.audio`;
        const res = await axios.get(url);
        console.log(`Success! Songs count:`, res.data.songs?.length);
    } catch (e) {
        console.log(`Failed:`, e.response?.status, e.response?.data?.message);
    }
})();
