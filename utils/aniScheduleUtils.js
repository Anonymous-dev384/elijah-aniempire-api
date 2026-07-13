const axios = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 21600 }); // Cache for 6 hours
const ANISCHEDULE_URL = 'https://raw.githubusercontent.com/RockinChaos/AniSchedule/master/raw/sub-schedule.json';

const aniScheduleUtils = {
    async fetchAll() {
        const cached = cache.get('full_schedule');
        if (cached) return cached;

        try {
            const response = await axios.get(ANISCHEDULE_URL, { timeout: 10000 });
            const data = response.data;
            cache.set('full_schedule', data);
            return data;
        } catch (error) {
            console.error('AniScheduleUtils: Failed to fetch schedule:', error.message);
            return null;
        }
    },

    async getScheduleByDay(dayName) {
        const all = await this.fetchAll();
        if (!all) return null;

        const dayLower = dayName.toLowerCase();
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const targetDayIndex = days.indexOf(dayLower);

        if (targetDayIndex === -1) return null;

        // Get the start and end of the target day in the current week (UTC or Local?)
        // Jikan usually uses JST for days, but AniSchedule uses absolute timestamps.
        // Let's filter based on the next airing episode's timestamp.
        
        const now = new Date();
        const results = all.map(anime => {
            const nodes = anime.airingSchedule?.nodes || [];
            // Find the first node that falls on the target day
            const targetNode = nodes.find(node => {
                const airingDate = new Date(node.airingAt * 1000);
                return airingDate.getDay() === targetDayIndex;
            });

            if (!targetNode) return null;

            const timeStr = new Date(targetNode.airingAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

            return {
                mal_id: anime.idMal,
                title: anime.title.english || anime.title.romaji || anime.title.userPreferred,
                images: {
                    jpg: {
                        image_url: anime.coverImage.extraLarge || anime.coverImage.large,
                        large_image_url: anime.coverImage.extraLarge,
                        small_image_url: anime.coverImage.medium
                    }
                },
                airing: true,
                episodes: null,
                status: 'Currently Airing',
                type: anime.format,
                score: null,
                broadcast: {
                    day: dayName.charAt(0).toUpperCase() + dayName.slice(1),
                    time: timeStr,
                    timezone: 'UTC',
                    string: null
                },
                time: timeStr,
                episode: targetNode.episode || 'TBA',
                airing_info: {
                    episode: targetNode.episode,
                    timestamp: targetNode.airingAt
                }
            };
        });
        const data = results.filter(Boolean);

        return {
            data,
            pagination: {
                has_next_page: false,
                current_page: 1,
                last_visible_page: 1
            }
        };
    }
};

module.exports = aniScheduleUtils;
