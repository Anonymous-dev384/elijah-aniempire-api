const mongoose = require('mongoose');
const connectDB = require('../config/db');
const MangaMapping = require('../models/MangaMapping');

async function fixMangaStatuses() {
    try {
        console.log('--- Resumable Manga Status Repair Started ---');
        await connectDB();

        // 1. Only target records that NEED an update (Status is null or the old default)
        // This makes the script resumable if the internet drops.
        const query = {
            $and: [
                { mapping_status: { $in: [null, 'pending_verification'] } }, 
                { 
                    $or: [
                        { background_status: 'completed' },
                        { mangafire_id: { $exists: true } },
                        { mangapill_id: { $exists: true } },
                        { mangadex_id: { $exists: true } },
                        { flamecomics_id: { $exists: true } }
                    ]
                }
            ]
        };

        const totalToRepair = await MangaMapping.countDocuments(query);
        console.log(`Found ${totalToRepair} manga records remaining to be fixed...`);

        if (totalToRepair === 0) {
            console.log('All records are already up to date!');
            process.exit(0);
        }

        // Use a cursor with a shorter batch size to stay "chatty" with the server
        const cursor = MangaMapping.find(query).batchSize(100).cursor();
        const bulkOps = [];
        let count = 0;
        let updatedCount = 0;

        for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
            count++;
            
            const providers = [
                'mangafire_id',
                'mangapill_id',
                'mangapark_id',
                'flamecomics_id',
                'mangadex_id'
            ];

            const foundProviders = providers.filter(p => doc[p] != null);
            const providerCount = foundProviders.length;

            let mappingStatus = 'pending_verification';
            let mappingConfidence = 0.5;
            let mappingError = null;

            if (providerCount > 0) {
                mappingStatus = 'mapped';
                mappingConfidence = providerCount >= 3 ? 1.0 : (providerCount >= 2 ? 0.8 : 0.7);
            } else if (doc.background_status === 'completed') {
                mappingStatus = 'not_found';
                mappingConfidence = 0.7;
                mappingError = 'No provider IDs found for this manga';
            }

            // Prepare the update
            bulkOps.push({
                updateOne: {
                    filter: { _id: doc._id },
                    update: { 
                        $set: { 
                            mapping_status: mappingStatus,
                            mapping_confidence: mappingConfidence,
                            mapping_error: mappingError,
                            mapping_last_update: new Date()
                        } 
                    }
                }
            });

            // Process batches
            if (bulkOps.length >= 100) {
                updatedCount += bulkOps.length;
                process.stdout.write(`\rProgress: ${updatedCount}/${totalToRepair} fixed...`);
                await MangaMapping.bulkWrite(bulkOps);
                bulkOps.length = 0;
                // Tiny pause to keep network stable
                await new Promise(r => setTimeout(r, 50));
            }
        }

        // Final batch
        if (bulkOps.length > 0) {
            updatedCount += bulkOps.length;
            await MangaMapping.bulkWrite(bulkOps);
        }

        console.log(`\n\n--- Repair Phase Complete ---`);
        console.log(`Successfully fixed: ${updatedCount} records.`);
        process.exit(0);

    } catch (error) {
        console.error('\nRepair Script Error:', error.message);
        console.log('You can run this script again to resume from where you left off.');
        process.exit(1);
    }
}

fixMangaStatuses();
