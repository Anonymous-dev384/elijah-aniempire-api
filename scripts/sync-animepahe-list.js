const animepahe = require('animepahe-api');
const connectDB = require('../config/db');
const AnimeMapping = require('../models/AnimeMapping');

async function syncAnimePaheList() {
    try {
        console.log('Connecting to database...');
        await connectDB();
        console.log('Database connected.');

        console.log('Fetching full AnimePahe list (this might take a moment)...');
        const paheList = await animepahe.getAnimeList();
        console.log(`Found ${paheList.length} items on AnimePahe.`);

        if (paheList.length === 0) {
            console.error('AnimePahe list is empty. Aborting.');
            return;
        }

        console.log('Loading all existing mappings from database...');
        // Only fetch needed fields to save memory
        const internalMappings = await AnimeMapping.find({}, {
            mal_id: 1,
            anilist_id: 1,
            title: 1,
            title_romaji: 1,
            title_english: 1,
            title_native: 1,
            title_synonyms: 1,
            animepahe_id: 1
        }).lean();

        console.log(`Loaded ${internalMappings.length} mappings from database.`);

        // Create match maps (normalized title -> mapping)
        const titleMap = new Map();
        
        function normalize(str) {
            if (!str) return '';
            return str.toLowerCase()
                .replace(/[^a-z0-9]/g, '')
                .trim();
        }

        internalMappings.forEach(mapping => {
            const titles = [
                mapping.title,
                mapping.title_romaji,
                mapping.title_english,
                mapping.title_native,
                ...(mapping.title_synonyms || [])
            ];

            titles.forEach(t => {
                const norm = normalize(t);
                if (norm && !titleMap.has(norm)) {
                    titleMap.set(norm, mapping);
                }
            });
        });

        console.log(`Title index created with ${titleMap.size} unique normalized titles.`);

        let matchedCount = 0;
        let updateCount = 0;
        const bulkOps = [];

        console.log('Matching AnimePahe list against database...');

        for (const paheAnime of paheList) {
            if (!paheAnime.title || !paheAnime.url) continue;

            // Extract ID from URL: /anime/id-slug -> id-slug
            const paheId = paheAnime.url.split('/').pop();
            const normPaheTitle = normalize(paheAnime.title);

            const mapping = titleMap.get(normPaheTitle);

            if (mapping) {
                matchedCount++;
                
                // Update if ID is different OR if the mapping is not yet verified
            if (mapping.animepahe_id !== paheId || !mapping.animepahe_verified) {
                    bulkOps.push({
                        updateOne: {
                            filter: { _id: mapping._id },
                            update: { 
                                $set: { 
                                    animepahe_id: paheId,
                                    animepahe_verified: true,
                                    // Also set status to mapped if it wasn't already
                                    mapping_status: (mapping.mapping_status === 'not_found' || !mapping.mapping_status) ? 'mapped' : mapping.mapping_status,
                                    updated_at: new Date()
                                } 
                            }
                        }
                    });
                    
                    // Update our in-memory object to avoid duplicate bulk ops for same record
                    mapping.animepahe_id = paheId;
                }
            }
        }

        console.log(`Matched ${matchedCount} AnimePahe entries to database mappings.`);
        
        if (bulkOps.length > 0) {
            console.log(`Performing bulk update for ${bulkOps.length} records...`);
            
            // Process in batches of 500 to be safe
            const batchSize = 500;
            for (let i = 0; i < bulkOps.length; i += batchSize) {
                const batch = bulkOps.slice(i, i + batchSize);
                await AnimeMapping.bulkWrite(batch);
                console.log(`Updated batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(bulkOps.length / batchSize)}`);
                updateCount += batch.length;
            }
            
            console.log(`Successfully updated ${updateCount} mappings with AnimePahe IDs.`);
        } else {
            console.log('No new matches found to update.');
        }

        console.log('Sync completed successfully.');
        process.exit(0);

    } catch (error) {
        console.error('Sync Error:', error);
        process.exit(1);
    }
}

syncAnimePaheList();
