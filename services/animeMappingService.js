const AnimeMapping = require('../models/AnimeMapping');
const { isDBConnected } = require('../config/db');

class AnimeMappingService {
    constructor() {
        this.memoryCache = new Map();
    }
    // Get single mapping by MAL ID
    async getMappingByMalId(malId) {
        // 1. Try memory cache first if DB is down or as a fast fallback
        if (this.memoryCache.has(malId)) {
            return this.memoryCache.get(malId);
        }

        if (!isDBConnected()) return null;

        try {
            const mapping = await AnimeMapping.findOne({ mal_id: malId }).lean();
            if (mapping) this.memoryCache.set(malId, mapping);
            return mapping;
        } catch (error) {
            console.error('Error fetching mapping:', error);
            return null;
        }
    }

    // Get multiple mappings by MAL IDs
    async getMappingsByMalIds(malIds) {
        try {
            const mappings = await AnimeMapping.find({ mal_id: { $in: malIds } }).lean(); // Add .lean()
            return mappings.reduce((acc, mapping) => {
                acc[mapping.mal_id] = mapping;
                return acc;
            }, {});
        } catch (error) {
            console.error('Error fetching mappings:', error);
            return {};
        }
    }

    // Save or update a mapping
    async saveMapping(mappingData) {
        // Update memory cache regardless of DB status
        const { mal_id } = mappingData;
        if (mal_id) {
            const existing = this.memoryCache.get(mal_id) || { mal_id };
            const updated = { ...existing, ...mappingData };
            this.memoryCache.set(mal_id, updated);
        }

        if (!isDBConnected()) return mappingData;

        try {
            const { mal_id } = mappingData;
            const existingMapping = await AnimeMapping.findOne({ mal_id });

            if (existingMapping) {
                // Update only provided fields, preserving existing values
                Object.keys(mappingData).forEach(key => {
                    if (mappingData[key] !== undefined) {
                        existingMapping[key] = mappingData[key];
                    }
                });
                
                // Update the mapping status based on the data
                if (Object.keys(mappingData).some(key => key.includes('_id'))) {
                    // If we have provider IDs, update mapping status
                    existingMapping.mapping_status = 'mapped';
                    existingMapping.mapping_confidence = 0.9; // High confidence if we found IDs
                    
                    // Calculate confidence based on number of providers mapped
                    const providerCount = Object.keys(mappingData).filter(key => key.includes('_id')).length;
                    if (providerCount >= 3) {
                        existingMapping.mapping_confidence = 1.0; // Very high confidence
                    } else if (providerCount >= 2) {
                        existingMapping.mapping_confidence = 0.8; // High confidence
                    } else {
                        existingMapping.mapping_confidence = 0.7; // Medium-high confidence
                    }
                    
                    existingMapping.mapping_last_update = new Date();
                } else if (mappingData.mapping_status) {
                    // If mapping status is explicitly provided, use it
                    existingMapping.mapping_status = mappingData.mapping_status;
                    if (mappingData.mapping_confidence !== undefined) {
                        existingMapping.mapping_confidence = mappingData.mapping_confidence;
                    }
                    if (mappingData.mapping_error) {
                        existingMapping.mapping_error = mappingData.mapping_error;
                    }
                    if (mappingData.mapping_last_update) {
                        existingMapping.mapping_last_update = mappingData.mapping_last_update;
                    } else {
                        existingMapping.mapping_last_update = new Date();
                    }
                }
                
                return await existingMapping.save().then(doc => doc.toObject());
            } else {
                // For new mappings, set appropriate status
                const newMappingData = { ...mappingData };
                
                if (Object.keys(mappingData).some(key => key.includes('_id'))) {
                    // If we have provider IDs, set mapped status
                    newMappingData.mapping_status = 'mapped';
                    newMappingData.mapping_confidence = 0.9; // High confidence if we found IDs
                    
                    // Calculate confidence based on number of providers mapped
                    const providerCount = Object.keys(mappingData).filter(key => key.includes('_id')).length;
                    if (providerCount >= 3) {
                        newMappingData.mapping_confidence = 1.0; // Very high confidence
                    } else if (providerCount >= 2) {
                        newMappingData.mapping_confidence = 0.8; // High confidence
                    } else {
                        newMappingData.mapping_confidence = 0.7; // Medium-high confidence
                    }
                    
                    newMappingData.mapping_last_update = new Date();
                } else {
                    // Default to pending verification if no provider IDs
                    newMappingData.mapping_status = 'pending_verification';
                    newMappingData.mapping_confidence = 0.5; // Medium confidence
                    newMappingData.mapping_last_update = new Date();
                }
                
                const newMapping = new AnimeMapping(newMappingData);
                return await newMapping.save();
            }
        } catch (error) {
            console.error('Error saving mapping:', error);
            return null;
        }
    }
    

    // Format mapping response
    // Update a mapping directly
    async updateMapping(malId, updateData) {
        // Update memory cache regardless of DB status
        const existing = this.memoryCache.get(malId) || { mal_id: malId };
        const setFields = updateData.$set || updateData;
        const updated = { ...existing, ...setFields };
        this.memoryCache.set(malId, updated);

        if (!isDBConnected()) return updated;

        try {
            const finalUpdate = {};
            const fields = {};

            for (const key in updateData) {
                if (key.startsWith('$')) {
                    finalUpdate[key] = updateData[key];
                } else {
                    fields[key] = updateData[key];
                }
            }

            if (Object.keys(fields).length > 0) {
                finalUpdate.$set = fields;
            }

            return await AnimeMapping.findOneAndUpdate(
                { mal_id: malId },
                finalUpdate,
                { new: true, upsert: true }
            );
        } catch (error) {
            console.error('Error updating mapping:', error);
            throw error;
        }
    }

    // Format mapping response
    formatMapping(mapping, title) {
        if (!mapping) return null;

        return {
            mal_id: mapping.mal_id,
            anilist_id: mapping.anilist_id,
            kitsu_id: mapping.kitsu_id,
            anidb_id: mapping.anidb_id,
            livechart_id: mapping.livechart_id,
            anisearch_id: mapping.anisearch_id,
            anime_planet_id: mapping.anime_planet_id,
            imdb_id: mapping.imdb_id,
            themoviedb_id: mapping.themoviedb_id,
            thetvdb_id: mapping.thetvdb_id,
            notify_moe_id: mapping.notify_moe_id,
            
            title: title || mapping.title,
            title_english: mapping.title_english,
            title_romaji: mapping.title_romaji,
            title_native: mapping.title_native,
            type: mapping.type,
            
            // Primary Providers
            zoro_id: mapping.zoro_id,
            animepahe_id: mapping.animepahe_id,
            
            // Consumet Fallbacks
            animesaturn_id: mapping.animesaturn_id,
            animeunity_id: mapping.animeunity_id,
            
            verified: mapping.zoro_verified || mapping.animepahe_verified,
            last_check: mapping.updated_at
        };
    }    
}

module.exports = new AnimeMappingService();