const MangaMapping = require('../models/MangaMapping');
const { isDBConnected } = require('../config/db');

class MangaMappingService {
    constructor() {
        this.memoryCache = new Map();
    }

    // Get single mapping by MAL ID
    async getMappingByMalId(malId) {
        if (this.memoryCache.has(malId)) {
            return this.memoryCache.get(malId);
        }

        if (!isDBConnected()) return null;

        try {
            const mapping = await MangaMapping.findOne({ mal_id: malId }).lean();
            if (mapping) this.memoryCache.set(malId, mapping);
            return mapping;
        } catch (error) {
            console.error('Error fetching manga mapping:', error);
            return null;
        }
    }

    // Get multiple mappings by MAL IDs
    async getMappingsByMalIds(malIds) {
        const cached = {};
        const missingIds = [];

        for (const id of malIds) {
            if (this.memoryCache.has(id)) {
                cached[id] = this.memoryCache.get(id);
            } else {
                missingIds.push(id);
            }
        }

        if (missingIds.length === 0) return cached;
        if (!isDBConnected()) return cached;

        try {
            const mappings = await MangaMapping.find({ mal_id: { $in: missingIds } }).lean();
            const result = { ...cached };
            for (const mapping of mappings) {
                this.memoryCache.set(mapping.mal_id, mapping);
                result[mapping.mal_id] = mapping;
            }
            return result;
        } catch (error) {
            console.error('Error fetching manga mappings:', error);
            return cached;
        }
    }

    // Save or update a mapping
    async saveMapping(mappingData) {
        const { mal_id } = mappingData;
        if (mal_id) {
            const existing = this.memoryCache.get(mal_id) || { mal_id };
            const updated = { ...existing, ...mappingData };
            this.memoryCache.set(mal_id, updated);
        }

        if (!isDBConnected()) return mappingData;

        try {
            const { mal_id } = mappingData;
            const existingMapping = await MangaMapping.findOne({ mal_id });

            if (existingMapping) {
                // Update only provided fields, preserving existing values
                Object.keys(mappingData).forEach(key => {
                    if (mappingData[key] !== undefined) {
                        existingMapping[key] = mappingData[key];
                    }
                });
                
                // Update mapping status/confidence based on provider IDs
                if (Object.keys(mappingData).some(key => key.endsWith('_id') && key !== 'mal_id')) {
                    existingMapping.mapping_status = 'mapped';
                    
                    const providerCount = Object.keys(mappingData).filter(key => key.endsWith('_id') && key !== 'mal_id').length;
                    if (providerCount >= 3) {
                        existingMapping.mapping_confidence = 1.0;
                    } else if (providerCount >= 2) {
                        existingMapping.mapping_confidence = 0.8;
                    } else {
                        existingMapping.mapping_confidence = 0.7;
                    }
                    
                    existingMapping.mapping_last_update = new Date();
                }

                const doc = await existingMapping.save();
                const obj = doc.toObject();
                this.memoryCache.set(mal_id, obj);
                return obj;
            } else {
                const newMappingData = { ...mappingData };
                
                if (Object.keys(mappingData).some(key => key.endsWith('_id') && key !== 'mal_id')) {
                    newMappingData.mapping_status = 'mapped';
                    
                    const providerCount = Object.keys(mappingData).filter(key => key.endsWith('_id') && key !== 'mal_id').length;
                    if (providerCount >= 3) {
                        newMappingData.mapping_confidence = 1.0;
                    } else if (providerCount >= 2) {
                        newMappingData.mapping_confidence = 0.8;
                    } else {
                        newMappingData.mapping_confidence = 0.7;
                    }
                    
                    newMappingData.mapping_last_update = new Date();
                } else {
                    newMappingData.mapping_status = 'pending_verification';
                    newMappingData.mapping_confidence = 0.5;
                }

                const newMapping = new MangaMapping(newMappingData);
                const doc = await newMapping.save();
                const obj = doc.toObject();
                this.memoryCache.set(mal_id, obj);
                return obj;
            }
        } catch (error) {
            console.error('Error saving manga mapping:', error);
            return null;
        }
    }

    // Format mapping response
    formatMapping(mapping, title) {
        if (!mapping) return null;

        return {
            mal_id: mapping.mal_id,
            anilist_id: mapping.anilist_id,
            kitsu_id: mapping.kitsu_id,
            mangaupdates_id: mapping.mangaupdates_id,
            novelupdates_id: mapping.novelupdates_id,
            
            title: title || mapping.title,
            title_english: mapping.title_english,
            title_romaji: mapping.title_romaji,
            title_native: mapping.title_native,
            type: mapping.type,
            
            // Providers
            mangafire_id: mapping.mangafire_id,
            mangapill_id: mapping.mangapill_id,
            mangapark_id: mapping.mangapark_id,
            flamecomics_id: mapping.flamecomics_id,
            mangadex_id: mapping.mangadex_id,
            
            verified: mapping.mangafire_verified || mapping.mangadex_verified || mapping.mangapill_verified,
            last_check: mapping.updated_at
        };
    }
}

module.exports = new MangaMappingService();
