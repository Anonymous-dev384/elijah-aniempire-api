const mongoose = require('mongoose');

const AnimeMappingSchema = new mongoose.Schema({
    mal_id: { type: Number, required: true, index: true },
    title: { type: String, index: true },
    title_english: { type: String, index: true },
    title_romaji: { type: String, index: true },
    title_native: { type: String, index: true },
    title_synonyms: [{ type: String }],
    type: { type: String }, // TV, MOVIE, OVA, etc.
    anilist_id: { type: Number, sparse: true, index: true },
    kitsu_id: { type: Number, sparse: true, index: true },
    anidb_id: { type: Number, sparse: true, index: true },
    livechart_id: { type: Number, sparse: true, index: true },
    anisearch_id: { type: Number, sparse: true, index: true },
    notify_moe_id: { type: String, sparse: true, index: true },
    anime_planet_id: { type: String, sparse: true, index: true },
    thetvdb_id: { type: Number, sparse: true, index: true },
    imdb_id: { type: String, sparse: true, index: true },
    themoviedb_id: { type: Number, sparse: true, index: true },
    // --- New Providers ---
    // Primary
    zoro_id: { type: String, sparse: true, index: true },
    zoro_verified: { type: Boolean, default: false },
    zoro_last_check: { type: Date },

    // Custom
    animepahe_id: { type: String, sparse: true, index: true },
    animepahe_verified: { type: Boolean, default: false },
    animepahe_last_check: { type: Date },

    // Consumet Fallbacks

    animesaturn_id: { type: String, sparse: true, index: true },
    animesaturn_verified: { type: Boolean, default: false },
    animesaturn_last_check: { type: Date },

    animeunity_id: { type: String, sparse: true, index: true },
    animeunity_verified: { type: Boolean, default: false },
    animeunity_last_check: { type: Date },

    // --- Background Processing Tracking ---
    background_last_attempt: { type: Date },
    background_attempt_count: { type: Number, default: 0 },
    background_status: { type: String, enum: ['pending', 'completed', 'failed', 'null'], default: 'null' },
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
}, {
    timestamps: true
});

// Create indexes for efficient querying - Done inline above in schema definition

const AnimeMapping = mongoose.model('AnimeMapping', AnimeMappingSchema);
module.exports = AnimeMapping;