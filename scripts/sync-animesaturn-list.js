const axios = require('axios');
const cheerio = require('cheerio');
const connectDB = require('../config/db');
const AnimeMapping = require('../models/AnimeMapping');

const BASE_URL = 'https://www.animesaturn.cx/animelist';

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

// Function to retry database operations
async function retryDatabaseOperation(operation, maxRetries = 3, delay = 1000) { // Reduced from 5000ms to 1000ms
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await operation();
        } catch (error) {
            console.log(`Database operation failed, attempt ${i + 1}/${maxRetries}:`, error.message);
            if (i === maxRetries - 1) throw error; // Last attempt, rethrow the error
            console.log(`Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

async function syncAnimeSaturnList() {
    try {
        console.log('Connecting to database...');
        await connectDB(); // Connect to the database

        // Create the slug map using batch processing to handle large datasets efficiently
        console.log('Loading mappings (Main Titles Only) for speed...');
        const slugMap = new Map();
        let count = 0;
        const batchSize = 500; // Even smaller batch size to reduce load
        let skip = 0;

        while (true) {
            // Retry the database operation in case of timeout
            const batch = await retryDatabaseOperation(async () => {
                return await AnimeMapping.find({}, {
                    mal_id: 1, title: 1, title_romaji: 1, title_english: 1,
                    animesaturn_id: 1, animesaturn_verified: 1
                })
                .skip(skip)
                .limit(batchSize)
                .lean()
                .exec();
            });

            if (batch.length === 0) {
                break; // No more documents
            }

            for (const doc of batch) {
                [doc.title, doc.title_romaji, doc.title_english].forEach(t => {
                    if (t) {
                        const s = slugify(t);
                        if (s && !slugMap.has(s)) slugMap.set(s, doc);
                    }
                });
                count++;
            }

            console.log(`Processed ${count} mappings...`);
            skip += batchSize;

            // Small delay to prevent overwhelming the database (optional, can be removed for speed)
            // await new Promise(resolve => setTimeout(resolve, 100)); // Reduced from 1000ms to 100ms or comment out for max speed
        }

        console.log(`Successfully loaded ${count} mappings. Slug index created with ${slugMap.size} entries.`);

        const bulkOps = [];
        let matches = 0;
        let page = 1;
        let hasMore = true;

        console.log('Starting paginated scrape of AnimeSaturn...');

        // Define all the letter categories to iterate through
        const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
                         'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
                         '0-9', '.']; // Include numbers and special characters

        for (const letter of letters) {
            console.log(`Processing letter category: ${letter}`);
            let page = 1;
            let hasMore = true;

            while (hasMore && page <= 50) { // Limit to 50 pages per letter for safety
                let url;
                if (letter === 'A') {
                    // Default is A, so just use page parameter
                    url = `${BASE_URL}?page=${page}`;
                } else {
                    // For other letters, include the letter parameter
                    url = `${BASE_URL}?letter=${letter}&page=${page}`;
                }

                console.log(`Fetching page ${page} from: ${url}`);
                try {
                    const response = await axios.get(url, {
                        timeout: 30000, // Increased timeout to 30 seconds
                        maxRedirects: 5, // Allow redirects
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                        },
                        // Follow redirects and handle potential SSL issues
                        validateStatus: (status) => {
                            return status >= 200 && status < 400; // Accept redirect statuses as well
                        }
                    });
                    console.log(`Page ${page} (letter ${letter}) fetched successfully. Status: ${response.status}, Size: ${response.data.length} bytes`);

                    const $ = cheerio.load(response.data);

                    // Log some debug info about the page
                    console.log(`Found ${$('h3 a.badge, .info-archivio h3 a').length} anime links on page ${page} (letter ${letter})`);

                    // Check if the page loaded correctly by looking for expected content
                    const pageContentCheck = $('.container').length > 0 || $('body').text().length > 100;
                    if (!pageContentCheck) {
                        console.log(`Page ${page} (letter ${letter}) doesn't seem to have expected content, stopping.`);
                        hasMore = false;
                        break;
                    }

                    // Correct selector for AnimeSaturn anime list items - targeting the actual anime titles in the list
                    const links = $('h3 a.badge, .info-archivio h3 a'); // Target the anime titles in the list

                    // If no links found, try alternative selectors
                    if (links.length === 0) {
                        console.log(`No links found on page ${page} (letter ${letter}), trying alternative selectors...`);
                        // Try other possible selectors
                        const altLinks = $('a[href*="/anime/"]');
                        if (altLinks.length > 0) {
                            console.log(`Found ${altLinks.length} alternative links on page ${page} (letter ${letter})`);
                        } else {
                            console.log(`No links found on page ${page} (letter ${letter}), stopping.`);
                            hasMore = false;
                            break;
                        }
                    }

                    links.each((i, el) => {
                        const href = $(el).attr('href');
                        const title = $(el).text().trim();

                        // Extract the saturnId from the full URL
                        if (!href || !href.includes('/anime/')) return;

                        // Extract the ID from the URL path - it's the part after the last slash
                        const urlParts = href.split('/');
                        const saturnId = urlParts[urlParts.length - 1]; // Get the last part of the URL

                        const slug = slugify(title);

                        const mapping = slugMap.get(slug);
                        if (mapping) {
                            if (mapping.animesaturn_id !== saturnId || !mapping.animesaturn_verified) {
                                bulkOps.push({
                                    updateOne: {
                                        filter: { _id: mapping._id },
                                        update: {
                                            $set: {
                                                animesaturn_id: saturnId,
                                                animesaturn_verified: true,
                                                updated_at: new Date()
                                            }
                                        }
                                    }
                                });
                                mapping.animesaturn_id = saturnId;
                                mapping.animesaturn_verified = true;
                                matches++;
                            }
                        }
                    });

                    page++;
                    // Since pagination links are not reliable (they use # placeholders),
                    // we'll continue to the next page number up to the limit
                    // Only stop if we get an empty page or very few results
                    if (links.length < 3) {  // If we get fewer than 3 anime on a page, assume we've reached the end
                        hasMore = false;
                    }
                } catch (err) {
                    console.error(`Error on page ${page} (letter ${letter}):`, err.message);
                    console.error(`Error code: ${err.code}`);
                    console.error(`Error stack:`, err.stack);
                    hasMore = false;
                }
            }
        }

        console.log(`Matched ${matches} AnimeSaturn entries.`);

        if (bulkOps.length > 0) {
            console.log(`Updating ${bulkOps.length} records...`);
            const batchSize = 500;
            for (let i = 0; i < bulkOps.length; i += batchSize) {
                await AnimeMapping.bulkWrite(bulkOps.slice(i, i + batchSize));
            }
        }

        console.log('Sync complete.');
        process.exit(0);
    } catch (err) {
        console.error('Fatal Error:', err);
        process.exit(1);
    }
}

syncAnimeSaturnList();
