const axios = require('axios');
const { fetcher } = require('../utils/fetchUtils');
const { pipeline } = require('stream/promises');
const { Parser } = require('stream-json');
const { streamArray } = require('stream-json/streamers/StreamArray');
const mongoose = require('mongoose');
const MangaMapping = require('../models/MangaMapping');
const MangaUpdateLog = require('../models/MangaUpdateLog');
const connectDB = require('../config/db');

// Ensure DB connection helper
const ensureConnection = async () => {
    if (mongoose.connection.readyState !== 1) {
        await connectDB();
    }
};

const updateMangaMappingsDatabase = async (forceUpdate = false, reset = false) => {
  try {
      await ensureConnection();
      console.log('Starting Manga update process...');

      let updateLog = await MangaUpdateLog.findOne() || new MangaUpdateLog();
      console.log('Manga Update log retrieved');

      // Source URL for Manga
      const listUrl = 'https://cdn.jsdelivr.net/gh/anime-and-manga/lists@main/manga-full.json';
      console.log('Checking Manga data source...');

      // Normalize ETag for comparison
      let normalizedStoredEtag = null;
      if (updateLog.lastEtag) {
          normalizedStoredEtag = updateLog.lastEtag.replace(/^W\//, '').replace(/[\"\']/g, '');
      }

      const headers = (!forceUpdate && !reset && normalizedStoredEtag) ?
          { 'If-None-Match': updateLog.lastEtag } : {};

      try {
        // 1. Check for updates via HEAD request
        const headResponse = await axios.head(listUrl, {
          headers: { ...headers, 'User-Agent': 'aniempire-api/1.0' },
          validateStatus: status => status === 200 || status === 304
        });

        const existingCount = await MangaMapping.countDocuments();
        
        if (!forceUpdate && !reset && headResponse.status === 304 && existingCount > 0) {
            console.log('Manga mappings are up to date (ETag match).');
            updateLog.lastUpdate = new Date();
            updateLog.status = 'success';
            await updateLog.save();
            return;
        }

        console.log('Proceeding with Manga download (Streaming mode)...');

        // 2. Download and Process Data via Streams
        const response = await fetcher({
            method: 'GET',
            url: listUrl,
            responseType: 'stream',
            timeout: 0, 
            validateStatus: status => status === 200 // Only proceed if 200 OK
        });

        // Basic sanity check on the stream headers
        const contentType = response.headers['content-type'] || '';
        if (contentType.includes('text/html')) {
            throw new Error('Received HTML instead of JSON stream (likely a proxy error page)');
        }

        let processedCount = 0;
        let lastLoggedCount = 0;
        const batchSize = 500;
        let batch = [];
        let bulkOps = [];
        
        console.log('Stream established. Starting JSON parse...');

        // Pipeline to parse JSON as it arrives
        await pipeline(
            response.data,
            new Parser(),
            streamArray(),
            async function* (source) {
                for await (const { value: item } of source) {
                    if (!item.idMal) continue;

                    if (reset) {
                        // Reset Mode: Build fresh document
                        const mapping = {
                            mal_id: item.idMal,
                            updated_at: new Date()
                        };
                        if (item.idAnilist) mapping.anilist_id = item.idAnilist;
                        if (item.idKitsu) mapping.kitsu_id = item.idKitsu;
                        if (item.idMangaupdates) mapping.mangaupdates_id = item.idMangaupdates;
                        if (item.idNovelupdates) mapping.novelupdates_id = item.idNovelupdates;
                        if (item.titles) {
                            mapping.title_english = item.titles.english;
                            mapping.title_romaji = item.titles.romaji;
                            mapping.title_native = item.titles.native;
                            mapping.title = item.titles.english || item.titles.romaji || item.titles.native;
                        }
                        if (item.type) mapping.type = item.type;
                        batch.push(mapping);
                    } else {
                        // Safe Upsert Mode: Only fill missing
                        const setOnlyIfMissing = { updated_at: new Date() };
                        if (item.idAnilist) setOnlyIfMissing.anilist_id = { $ifNull: ['$anilist_id', item.idAnilist] };
                        if (item.idKitsu) setOnlyIfMissing.kitsu_id = { $ifNull: ['$kitsu_id', item.idKitsu] };
                        if (item.idMangaupdates) setOnlyIfMissing.mangaupdates_id = { $ifNull: ['$mangaupdates_id', item.idMangaupdates] };
                        if (item.idNovelupdates) setOnlyIfMissing.novelupdates_id = { $ifNull: ['$novelupdates_id', item.idNovelupdates] };
                        if (item.titles) {
                            const primaryTitle = item.titles.english || item.titles.romaji || item.titles.native;
                            if (item.titles.english) setOnlyIfMissing.title_english = { $ifNull: ['$title_english', item.titles.english] };
                            if (item.titles.romaji) setOnlyIfMissing.title_romaji = { $ifNull: ['$title_romaji', item.titles.romaji] };
                            if (item.titles.native) setOnlyIfMissing.title_native = { $ifNull: ['$title_native', item.titles.native] };
                            if (primaryTitle) setOnlyIfMissing.title = { $ifNull: ['$title', primaryTitle] };
                        }
                        if (item.type) setOnlyIfMissing.type = { $ifNull: ['$type', item.type] };

                        bulkOps.push({
                            updateOne: {
                                filter: { mal_id: item.idMal },
                                update: [{ $set: setOnlyIfMissing }],
                                upsert: true
                            }
                        });
                    }

                    processedCount++;

                    // Execute batch every batchSize
                    if (batch.length >= batchSize) {
                        await MangaMapping.insertMany(batch, { ordered: false });
                        batch = [];
                        console.log(`Streaming: Inserted ${processedCount} items...`);
                    }
                    if (bulkOps.length >= batchSize) {
                        await MangaMapping.bulkWrite(bulkOps, { ordered: false });
                        bulkOps = [];
                        console.log(`Streaming: Upserted ${processedCount} items...`);
                    }
                }

                // Final small batches
                if (batch.length > 0) await MangaMapping.insertMany(batch, { ordered: false });
                if (bulkOps.length > 0) await MangaMapping.bulkWrite(bulkOps, { ordered: false });
            }
        );

        console.log(`Manga database update complete: ${processedCount} items processed.`);
        
        // Update Log
        updateLog.lastUpdate = new Date();
        updateLog.lastEtag = headResponse.headers.etag;
        updateLog.status = 'success';
        await updateLog.save();

      } catch (error) {
          console.error('Error fetching/processing Manga data:', error);
          throw error;
      }
  } catch (error) {
      console.error('Top-level error updating Manga DB:', error);
      const updateLog = await MangaUpdateLog.findOne() || new MangaUpdateLog();
      updateLog.status = 'failed';
      updateLog.error = error.message;
      await updateLog.save();
  }
};

const apiEndpoints = {
    manualMangaUpdate: async (req, res) => {
        try {
            const apiKey = req.headers.authorization?.split(' ')[1];
            if (!apiKey || apiKey !== process.env.API_KEY) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const forceUpdate = req.query.force === 'true';
            const reset = req.query.reset === 'true';

            // Trigger background update
            updateMangaMappingsDatabase(forceUpdate, reset);

            res.json({ 
                message: reset ? 'Hard RESET initiated for Manga' : 'Manga Update initiated', 
                mode: reset ? 'RESET' : 'SAFE'
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },
    
    checkMangaStatus: async (req, res) => {
        const log = await MangaUpdateLog.findOne();
        res.json(log || { status: 'never_run' });
    }
};

module.exports = {
    updateMangaMappingsDatabase,
    ...apiEndpoints
};
