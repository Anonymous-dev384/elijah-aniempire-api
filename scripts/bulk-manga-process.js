const mongoose = require('mongoose');
const connectDB = require('../config/db');
const MangaMapping = require('../models/MangaMapping');
const { addMangaToQueue } = require('../services/queueService');

async function bulkMangaProcess(limit = null) {
    try {
        console.log('--- Bulk Manga Processing Started ---');
        await connectDB();

        // Find manga that haven't been completed yet
        const query = {
            $or: [
                { background_status: { $nin: ['completed', 'pending'] } },
                { background_status: { $exists: false } }
            ]
        };

        console.log('Querying database for manga records needing processing...');
        const totalToProcess = await MangaMapping.countDocuments(query);
        console.log(`Found ${totalToProcess} manga records needing processing.`);

        let count = 0;
        let lastId = null;
        const batchSize = 100;

        while (!limit || count < limit) {
            const batchQuery = { ...query };
            if (lastId) {
                batchQuery._id = { $gt: lastId };
            }

            const docs = await MangaMapping.find(batchQuery)
                .sort({ _id: 1 })
                .limit(Math.min(batchSize, limit ? limit - count : batchSize))
                .lean();

            if (docs.length === 0) break;

            for (const doc of docs) {
                const title = doc.title || doc.title_romaji || doc.title_english || null;
                const altTitles = doc.title_synonyms || [];

                await addMangaToQueue(
                    title,
                    doc.mal_id,
                    doc.anilist_id || null,
                    altTitles,
                    { skipCheck: true }
                );

                count++;
                lastId = doc._id;

                if (count % 100 === 0) {
                    console.log(`Queued ${count}/${totalToProcess}...`);
                }
            }

            // Small break between batches
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        console.log(`--- Finished queueing ${count} manga items ---`);
        process.exit(0);
    } catch (error) {
        console.error('Bulk Manga Processing Error:', error);
        process.exit(1);
    }
}

// Check for arguments
const limitArg = process.argv[2] ? parseInt(process.argv[2]) : null;
bulkMangaProcess(limitArg);
