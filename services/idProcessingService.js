const animeService = require('./animeService');
const animeMappingService = require('./animeMappingService');
const { jikanFunctions } = require('../utils/jikanUtils');

class IdProcessingService {
    
    /**
     * Process anime to find IDs from all providers
     * @param {Object} jobData 
     */
    async processAnime(jobData) {
        let { title, malId, anilistId, altTitles = [] } = jobData;
        console.log(`IdProcessingService: Processing ${title || 'Unknown'} (MAL: ${malId})`);

        try {
            // 1. If title is missing, try to use existing title from DB before fetching from Jikan
            if (!title) {
                console.log(`IdProcessingService: Title missing for MAL ${malId}, checking DB for existing titles...`);

                // Get existing mapping to check for alternative titles
                const existingMapping = await animeMappingService.getMappingByMalId(malId);

                if (existingMapping) {
                    // Use any available title field as fallback
                    title = existingMapping.title_romaji ||
                           existingMapping.title_english ||
                           existingMapping.title_native;

                    if (title) {
                        console.log(`IdProcessingService: Found existing title in DB for MAL ${malId}: ${title}`);

                        // Update jobData with the found title
                        jobData.title = title;

                        // Build altTitles from existing DB data if available
                        const dbAltTitles = [
                            existingMapping.title_english,
                            existingMapping.title_romaji,
                            existingMapping.title_native,
                            ...(existingMapping.title_synonyms || [])
                        ].filter(Boolean);

                        jobData.altTitles = [...new Set([...altTitles, ...dbAltTitles])]; // Deduplicate
                    }
                }

                // If still no title, we skip external metadata fetches as requested to save resources
                if (!title) {
                    console.warn(`IdProcessingService: No title found for MAL ${malId}. Skipping metadata recovery to save requests.`);
                    throw new Error('Missing title and metadata recovery disabled');
                }
            }

            // 2. Update status to pending
            await animeMappingService.updateMapping(malId, {
                background_status: 'pending',
                background_last_attempt: new Date(),
                $inc: { background_attempt_count: 1 }
            });

            const updates = await animeService.fetchAndSaveProviderIds(jobData);
            const requestsMade = Object.keys(updates).length > 0; // True if any updates were made

            // Mark as completed
            await animeMappingService.updateMapping(malId, {
                background_status: 'completed',
                background_error: null
            });

            console.log(`IdProcessingService: Completed processing for ${title}`);
            return requestsMade;
        } catch (error) {
            console.error(`IdProcessingService: Error processing ${title}:`, error);
            
            // Mark as failed
            await animeMappingService.updateMapping(malId, {
                background_status: 'failed',
                background_error: error.message
            });

            throw error;
        }
    }
}

module.exports = new IdProcessingService();