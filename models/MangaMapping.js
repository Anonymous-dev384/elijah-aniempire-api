const mongoose = require('mongoose');

const mangaMappingSchema = new mongoose.Schema({
    mal_id: { type: Number, required: true, unique: true, index: true },
    
    // Core Manga IDs
    anilist_id: { type: Number, index: true },
    kitsu_id: { type: Number, index: true },
    mangaupdates_id: { type: String, index: true },
    novelupdates_id: { type: String, index: true },
    
    // Titles for better search/identification
    title: { type: String },
    title_english: { type: String },
    title_romaji: { type: String },
    title_native: { type: String },
    
    // Type (Manga, One-shot, Doujinshi, Light Novel, Novel, Manhwa, Manhua)
    type: { type: String },

    // --- Manga Providers ---
    mangafire_id: { type: String, sparse: true, index: true },
    mangafire_verified: { type: Boolean, default: false },
    mangafire_last_check: { type: Date },

    mangapill_id: { type: String, sparse: true, index: true },
    mangapill_verified: { type: Boolean, default: false },
    mangapill_last_check: { type: Date },

    mangapark_id: { type: String, sparse: true, index: true },
    mangapark_verified: { type: Boolean, default: false },
    mangapark_last_check: { type: Date },

    flamecomics_id: { type: String, sparse: true, index: true },
    flamecomics_verified: { type: Boolean, default: false },
    flamecomics_last_check: { type: Date },

    mangadex_id: { type: String, sparse: true, index: true },
    mangadex_verified: { type: Boolean, default: false },
    mangadex_last_check: { type: Date },

    // --- Background Processing Tracking ---
    background_last_attempt: { type: Date },
    background_attempt_count: { type: Number, default: 0 },
    background_status: { 
        type: String, 
        enum: ['pending', 'completed', 'failed', 'null'], 
        default: 'null' 
    },
    background_error: { type: String },

    // --- Mapping Status Tracking ---
    mapping_status: { 
        type: String, 
        enum: ['mapped', 'not_found', 'low_confidence', 'temporary_error', 'permanent_error', 'pending_verification', 'conflict'], 
        default: 'pending_verification' 
    },
    mapping_confidence: { type: Number, min: 0, max: 1 }, // Confidence score between 0-1
    mapping_last_update: { type: Date },
    mapping_error: { type: String },

    updated_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('MangaMapping', mangaMappingSchema);
