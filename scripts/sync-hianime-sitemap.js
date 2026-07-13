const axios = require('axios');
const connectDB = require('../config/db');
const AnimeMapping = require('../models/AnimeMapping');

// List of sitemaps provided by user
const SITEMAP_URLS = [
    'https://hianime.to/sitemap-movie-1.xml',
    'https://hianime.to/sitemap-movie-2.xml',
    'https://hianime.to/sitemap-movie-3.xml',
    'https://hianime.to/sitemap-movie-4.xml',
    'https://hianime.to/sitemap-movie-5.xml',
    'https://hianime.to/sitemap-movie-6.xml',
    'https://hianime.to/sitemap-movie-7.xml',
    'https://hianime.to/sitemap-movie-8.xml',
    'https://hianime.to/sitemap-movie-9.xml',
    'https://hianime.to/sitemap-movie-10.xml',
    'https://hianime.to/sitemap-movie-11.xml',
    'https://hianime.to/sitemap-movie-12.xml',
    'https://hianime.to/sitemap-movie-13.xml',
    'https://hianime.to/sitemap-movie-14.xml',
    'https://hianime.to/sitemap-movie-15.xml',
    'https://hianime.to/sitemap-movie-16.xml',
    'https://hianime.to/sitemap-movie-17.xml',
    'https://hianime.to/sitemap-movie-18.xml',
    'https://hianime.to/sitemap-movie-19.xml',
    'https://hianime.to/sitemap-movie-20.xml'
];

/**
 * Normalizes title into a slug for matching
 * e.g. "Spy x Family: Code: White" -> "spy-x-family-code-white"
 */
function slugify(text) {
    if (!text) return '';
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')           // Replace spaces with -
        .replace(/[^\w-]+/g, '')       // Remove all non-word chars except -
        .replace(/--+/g, '-')         // Replace multiple - with single -
        .replace(/^-+/, '')             // Trim - from start
        .replace(/-+$/, '');            // Trim - from end
}

async function syncHiAnimeSitemap() {
    try {
        console.log('Connecting to database...');
        await connectDB();
        console.log('Database connected.');

        console.log('Loading all existing mappings from database...');
        const internalMappings = await AnimeMapping.find({}, {
            mal_id: 1,
            title: 1,
            title_romaji: 1,
            title_english: 1,
            title_synonyms: 1,
            zoro_id: 1,
            zoro_verified: 1
        }).lean();

        console.log(`Loaded ${internalMappings.length} mappings from database.`);

        // Build a search map: slugified_title -> mapping
        // We'll map every title variant to the record
        const slugMap = new Map();
        internalMappings.forEach(mapping => {
            const titles = [
                mapping.title,
                mapping.title_romaji,
                mapping.title_english,
                ...(mapping.title_synonyms || [])
            ];

            titles.forEach(t => {
                const s = slugify(t);
                if (s && !slugMap.has(s)) {
                    slugMap.set(s, mapping);
                }
            });
        });

        console.log(`Slug index created with ${slugMap.size} unique slugified titles.`);

        const matches = [];
        const bulkOps = [];

        console.log(`Starting fetch of ${SITEMAP_URLS.length} sitemaps...`);

        for (const url of SITEMAP_URLS) {
            try {
                console.log(`Fetching ${url}...`);
                const response = await axios.get(url, { timeout: 10000 });
                const xml = response.data;

                // Simple regex to extract <loc> URLs
                const locs = xml.match(/<loc>(.*?)<\/loc>/g);
                if (!locs) continue;

                console.log(`Found ${locs.length} URLs in ${url.split('/').pop()}`);

                for (const locTag of locs) {
                    const fullUrl = locTag.replace('<loc>', '').replace('</loc>', '');
                    // URL format: https://hianime.to/the-young-imperial-guards-prologue-19287
                    const parts = fullUrl.split('/');
                    const slugWithId = parts[parts.length - 1];
                    
                    if (!slugWithId) continue;

                    // Split slug and ID (ID is the last numeric part)
                    const match = slugWithId.match(/^(.*)-(\d+)$/);
                    if (!match) continue;

                    const slug = match[1];
                    const zoroId = match[2];

                    const mapping = slugMap.get(slug);

                    if (mapping) {
                        // If mapping doesn't have zoro_id or it's unverified, queue update
                        if (mapping.zoro_id !== zoroId || !mapping.zoro_verified) {
                            bulkOps.push({
                                updateOne: {
                                    filter: { _id: mapping._id },
                                    update: {
                                        $set: {
                                            zoro_id: zoroId,
                                            zoro_verified: true,
                                            updated_at: new Date()
                                        }
                                    }
                                }
                            });
                            
                            // Prevent duplicate bulk ops for same record in this run
                            mapping.zoro_id = zoroId;
                            mapping.zoro_verified = true;
                            matches.push(`${mapping.title} -> ${zoroId}`);
                        }
                    }
                }
            } catch (err) {
                console.error(`Failed to fetch/parse ${url}:`, err.message);
            }
        }

        console.log(`Total potential matches found: ${matches.length}`);

        if (bulkOps.length > 0) {
            console.log(`Performing bulk update for ${bulkOps.length} records...`);
            const batchSize = 500;
            let updatedCount = 0;

            for (let i = 0; i < bulkOps.length; i += batchSize) {
                const batch = bulkOps.slice(i, i + batchSize);
                await AnimeMapping.bulkWrite(batch);
                updatedCount += batch.length;
                console.log(`Updated batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(bulkOps.length / batchSize)}`);
            }

            console.log(`Successfully completed! Updated ${updatedCount} Zoro IDs from sitemaps.`);
        } else {
            console.log('No new matches found.');
        }

        process.exit(0);

    } catch (error) {
        console.error('Fatal Sync Error:', error);
        process.exit(1);
    }
}

syncHiAnimeSitemap();
