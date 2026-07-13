const mangaService = require('./mangaService');
const MangaMapping = require('../models/MangaMapping');
const { isDBConnected } = require('../config/db');

class MangaIdProcessingService {
    
    /**
     * Process manga to find IDs from all providers
     * @param {Object} jobData 
     */
    async processManga(jobData) {
        let { title, malId, anilistId, altTitles = [] } = jobData;
        console.log(`MangaIdProcessingService: Processing ${title || 'Unknown'} (MAL: ${malId})`);

        // 0. Ensure DB connection is established
        if (!isDBConnected()) {
            console.warn(`MangaIdProcessingService: Database not connected for ${title || 'Unknown'} (MAL: ${malId}). Skipping.`);
            return false;
        }

        try {
            // 1. Safety check/Title recovery if needed
            if (!title) {
                const existingMapping = await MangaMapping.findOne({ mal_id: malId });
                if (existingMapping) {
                    title = existingMapping.title ||
                            existingMapping.title_romaji ||
                            existingMapping.title_english ||
                            existingMapping.title_native;

                    if (title) {
                        jobData.title = title;
                        const dbAltTitles = [
                            existingMapping.title_english,
                            existingMapping.title_romaji,
                            existingMapping.title_native,
                            existingMapping.title,
                            ...(existingMapping.title_synonyms || [])
                        ].filter(Boolean);
                        jobData.altTitles = [...new Set([...altTitles, ...dbAltTitles])];
                    }
                }
            }

            if (!title) {
                // In a production environment, we'd fetch from Jikan for Manga too
                // For now, we assume title is provided or in DB since bulk script should handle it
                throw new Error(`Metadata missing for Manga MAL ${malId}`);
            }

            // 2. Update status to pending
            await MangaMapping.findOneAndUpdate(
                { mal_id: malId },
                {
                    $set: {
                        background_status: 'pending',
                        background_last_attempt: new Date(),
                    },
                    $inc: { background_attempt_count: 1 }
                },
                { upsert: true }
            );

            // 3. Resolve IDs
            const updates = await mangaService.fetchAndSaveProviderIds(jobData);
            const requestsMade = updates && typeof updates === 'object' && Object.keys(updates).length > 0; // True if any updates were made

            // 4. Update status based on results
            const updateData = {
                background_status: 'completed',
                background_error: null
            };

            // If the manga service returned a mapping status, use it
            if (updates && updates.mapping_status) {
                updateData.mapping_status = updates.mapping_status;
                updateData.mapping_confidence = updates.mapping_confidence;
                updateData.mapping_last_update = new Date();
                if (updates.mapping_error) {
                    updateData.mapping_error = updates.mapping_error;
                }
            }

            await MangaMapping.findOneAndUpdate(
                { mal_id: malId },
                { $set: updateData }
            );

            console.log(`MangaIdProcessingService: Completed processing for ${title}`);
            return requestsMade;
        } catch (error) {
            console.error(`MangaIdProcessingService: Error processing ${title}:`, error);
            
            // Mark as failed
            await MangaMapping.findOneAndUpdate(
                { mal_id: malId },
                { 
                    $set: {
                        background_status: 'failed',
                        background_error: error.message
                    }
                }
            );

            throw error;
        }
    }
}

module.exports = new MangaIdProcessingService();
