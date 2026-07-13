const mongoose = require('mongoose');
const connectDB = require('../config/db');
const AnimeMapping = require('../models/AnimeMapping');

async function fixAnimeStatuses() {
    try {
        console.log('--- Resumable Anime Status Repair Started ---');
        await connectDB();

        const query = {
            $and: [
                { mapping_status: { $in: [null, 'pending_verification'] } }, 
                { 
                    $or: [
                        { background_status: 'completed' },
                        { zoro_id: { $exists: true } },
                        { animepahe_id: { $exists: true } },
                        { animesaturn_id: { $exists: true } },
                        { animeunity_id: { $exists: true } }
                    ]
                }
            ]
        };

        const totalToRepair = await AnimeMapping.countDocuments(query);
        console.log(`Found ${totalToRepair} anime records remaining to be fixed...`);

        if (totalToRepair === 0) {
            console.log('All anime are already up to date!');
            process.exit(0);
        }

        const cursor = AnimeMapping.find(query).batchSize(100).cursor();
        const bulkOps = [];
        let count = 0;
        let updatedCount = 0;

        for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
            count++;
            
            const providers = ['zoro_id', 'animepahe_id', 'animesaturn_id', 'animeunity_id'];
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
                mappingError = 'No provider IDs found for this anime';
            }

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

            if (bulkOps.length >= 100) {
                updatedCount += bulkOps.length;
                process.stdout.write(`\rProgress: ${updatedCount}/${totalToRepair} fixed...`);
                await AnimeMapping.bulkWrite(bulkOps);
                bulkOps.length = 0;
                await new Promise(r => setTimeout(r, 50));
            }
        }

        if (bulkOps.length > 0) {
            updatedCount += bulkOps.length;
            await AnimeMapping.bulkWrite(bulkOps);
        }

        console.log(`\n\n--- Repair Phase Complete ---`);
        console.log(`Successfully fixed: ${updatedCount} records.`);
        process.exit(0);

    } catch (error) {
        console.error('\nRepair Script Error:', error.message);
        process.exit(1);
    }
}

fixAnimeStatuses();
