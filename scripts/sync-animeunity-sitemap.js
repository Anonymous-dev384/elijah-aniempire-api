const axios = require('axios');
const connectDB = require('../config/db');
const AnimeMapping = require('../models/AnimeMapping');

const SITEMAP_URL = 'https://www.animeunity.so/sitemap.xml';

function slugify(text) {
    if (!text) return '';
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w-]+/g, '')
        .replace(/--+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
}

async function syncAnimeUnitySitemap() {
    try {
        console.log('Connecting to database...');
        await connectDB();
        console.log('Database connected.');

        console.log('Loading mappings (Main Titles Only) for speed...');
        const mappings = await AnimeMapping.find({}, {
            mal_id: 1, title: 1, title_romaji: 1, title_english: 1,
            animeunity_id: 1, animeunity_verified: 1
        }).lean();

        console.log(`Successfully loaded ${mappings.length} mappings. Creating index...`);
        const slugMap = new Map();
        
        mappings.forEach(m => {
            [m.title, m.title_romaji, m.title_english].forEach(t => {
                const s = slugify(t);
                if (s && !slugMap.has(s)) slugMap.set(s, m);
            });
        });

        console.log(`Slug index created with ${slugMap.size} entries.`);
        console.log(`Fetching sitemap from ${SITEMAP_URL}...`);
        
        const response = await axios.get(SITEMAP_URL, { 
            timeout: 30000, 
            headers: { 'User-Agent': 'Mozilla/5.0' } 
        });
        const xml = response.data;

        const locs = xml.match(/<loc>(.*?)<\/loc>/g) || [];
        console.log(`Found ${locs.length} URLs in sitemap.`);

        const bulkOps = [];
        let matches = 0;

        for (const locTag of locs) {
            const url = locTag.replace('<loc>', '').replace('</loc>', '');
            if (!url.includes('/anime/')) continue;

            const part = url.split('/anime/')[1];
            if (!part) continue;

            // Format: ID-slug (e.g. 100-konosuba)
            const match = part.match(/^(\d+)-(.*)$/);
            if (!match) continue;

            const unityId = match[1];
            const slug = match[2];

            const mapping = slugMap.get(slug);
            if (mapping) {
                if (mapping.animeunity_id !== unityId || !mapping.animeunity_verified) {
                    bulkOps.push({
                        updateOne: {
                            filter: { _id: mapping._id },
                            update: {
                                $set: {
                                    animeunity_id: unityId,
                                    animeunity_verified: true,
                                    updated_at: new Date()
                                }
                            }
                        }
                    });
                    mapping.animeunity_id = unityId;
                    mapping.animeunity_verified = true;
                    matches++;
                }
            }
        }

        console.log(`Matched ${matches} AnimeUnity entries.`);

        if (bulkOps.length > 0) {
            console.log(`Updating ${bulkOps.length} records...`);
            const batchSize = 500;
            for (let i = 0; i < bulkOps.length; i += batchSize) {
                await AnimeMapping.bulkWrite(bulkOps.slice(i, i + batchSize));
                console.log(`Batch ${Math.floor(i/batchSize)+1} done.`);
            }
        }

        console.log('Sync complete.');
        process.exit(0);
    } catch (err) {
        console.error('Fatal Error:', err);
        process.exit(1);
    }
}

syncAnimeUnitySitemap();
