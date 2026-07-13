const axios = require('axios');
const connectDB = require('../config/db');
const MangaMapping = require('../models/MangaMapping');
// Inline slugify
function safeSlugify(text) {
    if (!text) return '';
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
}

// Configuration
const BASE_URL = 'https://mangafire.to';
const SEARCH_URL = 'https://mangafire.to/filter?keyword=&page=';
const MAX_PAGES = 1737; 

// Headers
const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Referer': 'https://mangafire.to/'
};

// Helper: Sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function syncMangaFire() {
    try {
        console.log('Connecting to database...');
        await connectDB();
        console.log('Database connected. Starting Page-by-Page Sync (No Pre-load)...');

        let totalUpdated = 0;
        const failedPages = [];
        const startPage = parseInt(process.argv[2]) || 1; // Allow resuming from a specific page
        const endPage = parseInt(process.argv[3]) || MAX_PAGES;

        console.log(`Processing pages ${startPage} to ${endPage}...`);

        for (let page = startPage; page <= endPage; page++) {
            const url = `${SEARCH_URL}${page}`;
            console.log(`\nFetching page ${page}/${endPage}...`);

            let retries = 3;
            let success = false;

            while (retries > 0 && !success) {
                try {
                    const { data } = await axios.get(url, { headers, timeout: 10000 });
                
                    // Extract Items
                    const itemRegex = /href="\/manga\/([^"]+)"[^>]*>([^<]+)<\/a>/g;
                    let match;
                    let pageCandidates = [];

                    while ((match = itemRegex.exec(data)) !== null) {
                        const mfId = match[1];
                        const mfTitle = match[2].trim();
                    
                        if (mfId.includes('?')) continue;
                        pageCandidates.push({ mfId, mfTitle });
                    }

                    console.log(`  - Analying ${pageCandidates.length} items on page...`);

                    // Process each candidate CONCURRENTLY with Promise.all
                    const lookupPromises = pageCandidates.map(async (item) => {
                        const { mfId, mfTitle } = item;
                    
                        try {
                            // Escape special regex characters
                            const escapedTitle = mfTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            const titleRegex = new RegExp(`^${escapedTitle}$`, 'i');
                        
                            // Optimization: Only select _id to minimize data transfer
                            const match = await MangaMapping.findOne({
                                $or: [
                                    { title: titleRegex },
                                    { title_english: titleRegex },
                                    { title_romaji: titleRegex }
                                ],
                                mangafire_verified: { $ne: true } 
                            }).select('_id');

                            if (match) {
                                // Found a match!
                                match.mangafire_id = mfId;
                                match.mangafire_verified = true;
                                match.mangafire_last_check = new Date();
                                match.updated_at = new Date();
                                await match.save();
                        
                                console.log(`    ✅ Mapped: "${mfTitle}" -> ID: ${mfId}`);
                                return 1;
                            }
                            return 0;
                        } catch (err) {
                            // Skip this item on error (likely regex issue)
                            console.warn(`    ⚠️ Skipped "${mfTitle}": ${err.message}`);
                            return 0;
                        }
                    });

                    const results = await Promise.all(lookupPromises);
                    const pageUpdates = results.reduce((a, b) => a + b, 0);
                    totalUpdated += pageUpdates;

                    if (pageUpdates > 0) {
                        console.log(`  - Page ${page} Complete. Updated ${pageUpdates} records.`);
                    } else {
                        console.log(`  - Page ${page} Complete. No new matches.`);
                    }

                    success = true; // Mark as successful
                    await sleep(50);

                } catch (err) {
                    retries--;
                    console.error(`❌ Error on page ${page} (${3 - retries}/3 attempts): ${err.message}`);
                    
                    if (retries > 0) {
                        console.log(`  Retrying in 3s...`);
                        await sleep(3000);
                    } else {
                        console.error(`  Failed after 3 attempts. Marking page ${page} as failed.`);
                        failedPages.push(page);
                    }
                }
            }
        }

        console.log(`\n✅ Sync Complete!`);
        console.log(`Total Records Updated: ${totalUpdated}`);
        
        if (failedPages.length > 0) {
            console.log(`\n⚠️ ${failedPages.length} pages failed after 3 retries:`);
            console.log(failedPages.join(', '));
            console.log(`\nTo retry failed pages, run:`);
            console.log(`node scripts/sync-mangafire-bulk.js ${Math.min(...failedPages)} ${Math.max(...failedPages)}`);
        }
        
        process.exit(0);

    } catch (error) {
        console.error('Fatal Error:', error);
        process.exit(1);
    }
}

syncMangaFire();
