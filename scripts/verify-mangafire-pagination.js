const axios = require('axios');

// MangaFire verification script
// Goal: Confirm total pages and data extraction logic

const BASE_URL = 'https://mangafire.to';
const SEARCH_URL = 'https://mangafire.to/filter?keyword=';

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': 'https://mangafire.to/'
};

async function verify() {
    console.log(`Fetching ${SEARCH_URL}...`);
    try {
        const { data } = await axios.get(SEARCH_URL, { headers });
        
        console.log('Page fetched successfully. Analyzing...');

        // 1. Extract Total Pages
        // Pagination usually looks like: <li class="page-item last"><a class="page-link" href="?keyword=&page=1737">Last</a></li>
        // or just detecting the last number in the pagination block
        const paginationRegex = /page=(\d+)"/g;
        let maxPage = 1;
        let match;
        while ((match = paginationRegex.exec(data)) !== null) {
            const pageNum = parseInt(match[1]);
            if (pageNum > maxPage) maxPage = pageNum;
        }

        console.log(`\nDetected Max Page: ${maxPage}`);
        if (maxPage > 1000) {
            console.log('✅ Confirmed: High page count detected (matches user claim).');
        } else {
            console.warn('⚠️ Warning: Page count seems low. Check if pagination is hidden or dynamic.');
        }

        // 2. Extract Manga Items
        // MangaFire list items usually have a specific structure
        // Look for links like /manga/slug.id
        // Regex for <a href="/manga/one-piece.kpz">Title</a>
        
        // This regex is a guess based on standard HTML structures, might need refining based on actual HTML
        // MangaFire often uses: <a href="/manga/..." class="...">Title</a>
        const itemRegex = /href="\/manga\/([^"]+)"[^>]*>([^<]+)<\/a>/g;
        
        console.log('\nSample Extracted Items:');
        let count = 0;
        const seen = new Set();
        
        while ((match = itemRegex.exec(data)) !== null) {
            const url = match[1];
            const title = match[2].trim();
            
            // Filter out noise
            if (url.includes('?') || title.length < 2) continue;
            if (seen.has(url)) continue;
            
            seen.add(url);
            console.log(`- [${title}] (ID/Slug: ${url})`);
            count++;
            if (count >= 5) break; 
        }

        if (count === 0) {
            console.log('\n❌ Failed to extract any items. Regex needs adjustment.');
            console.log('Logging snippet for debugging:');
            console.log(data.substring(0, 2000)); // Log head
        } else {
            console.log(`\n✅ Successfully extracted ${seen.size}+ items from page 1.`);
        }

    } catch (error) {
        console.error('❌ Error fetching page:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
        }
    }
}

verify();
