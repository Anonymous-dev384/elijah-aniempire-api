const mongoose = require('mongoose');
const connectDB = require('../config/db');
const AnimeMapping = require('../models/AnimeMapping');
const { addToQueue } = require('../services/queueService');

async function bulkProcess(limit = null) {
    try {
        console.log('--- Bulk Anime Processing Started ---');
        await connectDB();

        // Find anime that haven't been completed yet
        // We prioritize those with NO hianime_id or those marked as 'null'/'failed'
        const query = {
            $and: [
                { hianime_id: { $exists: false } }, // Skip if already mapped
                {
                    $or: [
                        { background_status: { $nin: ['completed', 'pending'] } },
                        { background_status: { $exists: false } }
                    ]
                }
            ]
        };

        console.log('Querying database for records needing processing...');
        const totalToProcess = await AnimeMapping.countDocuments(query);
        console.log(`Found ${totalToProcess} records needing processing.`);

        let count = 0;
        let lastId = null;
        const batchSize = 100;

        while (!limit || count < limit) {
            // Build query for the current batch
            const batchQuery = { ...query };
            if (lastId) {
                batchQuery._id = { $gt: lastId };
            }

            // Fetch a batch of documents
            const docs = await AnimeMapping.find(batchQuery)
                .sort({ _id: 1 })
                .limit(Math.min(batchSize, limit ? limit - count : batchSize))
                .lean();

            if (docs.length === 0) break;

            for (const doc of docs) {
                const title = doc.title || null;
                const altTitles = doc.title_synonyms || [];

                if (!title) {
                    const additionalTitles = [
                        doc.title_english,
                        doc.title_romaji,
                        doc.title_native
                    ].filter(Boolean);

                    const combinedAltTitles = [...new Set([...altTitles, ...additionalTitles])];

                    await addToQueue(
                        title,
                        doc.mal_id,
                        doc.anilist_id || null,
                        combinedAltTitles,
                        { skipCheck: true }
                    );
                } else {
                    await addToQueue(
                        title,
                        doc.mal_id,
                        doc.anilist_id || null,
                        altTitles,
                        { skipCheck: true }
                    );
                }

                count++;
                lastId = doc._id;

                if (count % 100 === 0) {
                    console.log(`Queued ${count}/${totalToProcess}...`);
                }
            }
            
            // Small break between batches to prevent overwhelming things
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        console.log(`--- Finished queueing ${count} items ---`);
        process.exit(0);
    } catch (error) {
        console.error('Bulk Processing Error:', error);
        process.exit(1);
    }
}

// Check for arguments
const limitArg = process.argv[2] ? parseInt(process.argv[2]) : null;
bulkProcess(limitArg);
