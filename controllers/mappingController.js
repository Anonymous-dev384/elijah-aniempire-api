const axios = require('axios');
const { fetchUrl } = require('../utils/fetchUtils');
const { pipeline } = require('stream/promises');
const { Parser } = require('stream-json');
const { streamArray } = require('stream-json/streamers/StreamArray');
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const AnimeMapping = require('../models/AnimeMapping');
const UpdateLog = require('../models/UpdateLog');

let isInitialized = false;
let initializationPromise = null;

// Initialize function that connects DB and sets up cron
const initialize = async () => {
    // If already initializing, wait for it to complete
    if (initializationPromise) {
        await initializationPromise;
        return; // Don't return the promise to prevent logging
    }

    // If already initialized, return immediately
    if (isInitialized) {
        return; // Return undefined to avoid potential logging
    }

    // Create a new initialization promise
    initializationPromise = (async () => {
        try {
            console.log('Starting initialization...');

            await connectDB();

            // Wait for connection to be ready
            await new Promise((resolve, reject) => {
                if (mongoose.connection.readyState === 1) {
                    resolve();
                } else {
                    mongoose.connection.once('connected', resolve);
                    mongoose.connection.once('error', reject);
                }
            });

            console.log('Database connection established');

            await updateMappingsDatabase();

            isInitialized = true;
            console.log('Initialization completed successfully');
        } catch (error) {
            console.error('Initialization failed:', error);
            initializationPromise = null;
            throw error;
        }
    })();

    await initializationPromise; // Wait for initialization to complete but don't return the result
};

const updateMappingsDatabase = async (forceUpdate = false, reset = false) => {
  try {
      console.log('Starting update process...');

      let updateLog = await UpdateLog.findOne() || new UpdateLog();
      console.log('Update log retrieved');

      // Check Fribb data first for ETag
      const fribbUrl = 'https://cdn.jsdelivr.net/gh/Fribb/anime-lists/anime-list-full.json';
      console.log('Checking Fribb data for updates...');

      // Debug: Log the stored ETag
      console.log('Stored ETag:', updateLog.lastEtag);

      // Normalize ETag for comparison (remove quotes and W/ prefix if present)
      let normalizedStoredEtag = null;
      if (updateLog.lastEtag) {
          normalizedStoredEtag = updateLog.lastEtag.replace(/^W\//, '').replace(/["']/g, '');
      }

      // If resetting, we ignore headers/cache and force fresh download
      const headers = (!forceUpdate && !reset && normalizedStoredEtag) ?
          { 'If-None-Match': updateLog.lastEtag } : {}; 

      try {
        // First, check if Fribb data has changed using conditional request
        const headResponse = await axios.head(fribbUrl, {
          headers: {
            ...headers,
            'User-Agent': 'aniempire-api/1.0 (compatible; Node.js)'
          },
          validateStatus: function (status) {
              return status === 200 || status === 304; // Accept both 200 and 304 as valid
          }
        });

        // Debug: Log the response status and headers
        console.log('HEAD request status:', headResponse.status);
        console.log('Response ETag:', headResponse.headers.etag);

        let normalizedResponseEtag = null;
        if (headResponse.headers.etag) {
            normalizedResponseEtag = headResponse.headers.etag.replace(/^W\//, '').replace(/["']/g, '');
        }
        console.log('Normalized stored ETag:', normalizedStoredEtag);
        console.log('Normalized response ETag:', normalizedResponseEtag);

        // If ETag matches and we're not forcing an update, skip the download
        // BUT only if we already have data in the database
        const existingCount = await AnimeMapping.countDocuments();
        console.log('Existing document count:', existingCount);

        if (!forceUpdate && !reset && headResponse.status === 304 && existingCount > 0) {
            console.log('Mappings are up to date (ETag match) and data exists in database');
            updateLog.lastUpdate = new Date();
            updateLog.status = 'success';
            await updateLog.save();
            return;
        } else if (!forceUpdate && headResponse.status === 304 && existingCount === 0) {
            console.log('ETag indicates no change, but database is empty - proceeding with download');
        } else if (headResponse.status === 200) {
            console.log('Remote data has changed (200 response), proceeding with download...');
        }

        // Proceed with download if data has changed or update is forced
        console.log('Proceeding with download...');

        // NEW APPROACH: Download both data sources and merge them
        console.log('Downloading and merging data sources...');

        // Download Fribb data (contains most ID mappings)
        console.log('Downloading Fribb data...');
        const fribbData = await fetchUrl(fribbUrl, {
          headers: {
            'User-Agent': 'aniempire-api/1.0 (compatible; Node.js)'
          },
          timeout: 120000
        });
        console.log(`Downloaded ${fribbData.length} entries from Fribb`);

        // Download anime-and-manga/lists data (contains titles and additional info)
        console.log('Downloading anime-and-manga/lists data...');
        const listsData = await fetchUrl('https://cdn.jsdelivr.net/gh/anime-and-manga/lists@main/anime-full.json', {
          headers: {
            'User-Agent': 'aniempire-api/1.0 (compatible; Node.js)'
          },
          timeout: 120000
        });
        console.log(`Downloaded ${listsData.length} entries from anime-and-manga/lists`);

        // Create a lookup map from the lists data for faster merging
        console.log('Creating lookup map...');
        const listsMap = new Map();
        for (const item of listsData) {
          if (item.idMal) {
            listsMap.set(item.idMal, item);
          }
        }
        console.log(`Created lookup map with ${listsMap.size} entries`);

        // Merge the data
        console.log('Merging data...');
        let processedCount = 0;
        const batchSize = 1000;
        const totalItems = fribbData.length;

        const session = await mongoose.startSession();
        await session.startTransaction();

        try {
          if (reset) {
            // == RESET MODE (Destructive: Wipe & Replace) ==
            console.warn('⚠️ RESET REQUESTED: Deleting ALL existing mappings...');
            await AnimeMapping.deleteMany({});
            
            console.log('Inserting fresh data (Reset Mode)...');
            let batch = [];

            for (const fribbItem of fribbData) {
               if (fribbItem.mal_id) {
                 const listsItem = listsMap.get(fribbItem.mal_id);
                 
                 // Build fresh mapping object
                 const mapping = {
                    mal_id: fribbItem.mal_id,
                    updated_at: new Date()
                 };
                 
                 // Map Fribb IDs
                 if (fribbItem.anilist_id) mapping.anilist_id = fribbItem.anilist_id;
                 if (fribbItem.kitsu_id) mapping.kitsu_id = fribbItem.kitsu_id;
                 if (fribbItem.anidb_id) mapping.anidb_id = fribbItem.anidb_id;
                 if (fribbItem.livechart_id) mapping.livechart_id = fribbItem.livechart_id;
                 if (fribbItem.anisearch_id) mapping.anisearch_id = fribbItem.anisearch_id;
                 if (fribbItem['notify.moe_id']) mapping.notify_moe_id = fribbItem['notify.moe_id'];
                 if (fribbItem['anime-planet_id']) mapping.anime_planet_id = fribbItem['anime-planet_id'];
                 
                 const tvdbId = fribbItem.thetvdb_id || fribbItem.tvdb_id;
                 if (tvdbId) mapping.thetvdb_id = tvdbId;
                 
                 if (fribbItem.imdb_id) mapping.imdb_id = fribbItem.imdb_id;
                 if (fribbItem.themoviedb_id) mapping.themoviedb_id = fribbItem.themoviedb_id;

                 // Add Title info
                 if (listsItem && listsItem.titles) {
                    if (listsItem.titles.romaji) mapping.title_romaji = listsItem.titles.romaji;
                    if (listsItem.titles.english) mapping.title_english = listsItem.titles.english;
                    if (listsItem.titles.native) mapping.title_native = listsItem.titles.native;
                    // Primary title logic: English > Romaji > Native
                    mapping.title = listsItem.titles.english || listsItem.titles.romaji || listsItem.titles.native || null;
                 }
                 if (listsItem && listsItem.type) mapping.type = listsItem.type;
                 
                 batch.push(mapping);
                 processedCount++;

                 if (batch.length >= batchSize) {
                    await AnimeMapping.insertMany(batch, { ordered: false });
                    batch = [];
                    // Small delay to prevent blocking event loop
                    await new Promise(resolve => setImmediate(resolve));
                 }
               }
            }
            if (batch.length > 0) await AnimeMapping.insertMany(batch, { ordered: false });

          } else {
            // == SAFE UPSERT MODE (Non-Destructive: Fill Only Missing) ==
            console.log('Updating mappings (only filling missing fields)...');
            const bulkOps = [];

            for (const fribbItem of fribbData) {
              if (fribbItem.mal_id) {
                const listsItem = listsMap.get(fribbItem.mal_id);
                
                // Use aggregation pipeline for conditional updates ($ifNull)
                // This ensures we NEVER overwrite existing data, only fill in gaps
                const setOnlyIfMissing = { updated_at: new Date() };

                // IDs
                if (fribbItem.anilist_id) setOnlyIfMissing.anilist_id = { $ifNull: ['$anilist_id', fribbItem.anilist_id] };
                if (fribbItem.kitsu_id) setOnlyIfMissing.kitsu_id = { $ifNull: ['$kitsu_id', fribbItem.kitsu_id] };
                if (fribbItem.anidb_id) setOnlyIfMissing.anidb_id = { $ifNull: ['$anidb_id', fribbItem.anidb_id] };
                if (fribbItem.livechart_id) setOnlyIfMissing.livechart_id = { $ifNull: ['$livechart_id', fribbItem.livechart_id] };
                if (fribbItem.anisearch_id) setOnlyIfMissing.anisearch_id = { $ifNull: ['$anisearch_id', fribbItem.anisearch_id] };
                if (fribbItem['notify.moe_id']) setOnlyIfMissing.notify_moe_id = { $ifNull: ['$notify_moe_id', fribbItem['notify.moe_id']] };
                if (fribbItem['anime-planet_id']) setOnlyIfMissing.anime_planet_id = { $ifNull: ['$anime_planet_id', fribbItem['anime-planet_id']] };
                
                const tvdbId = fribbItem.thetvdb_id || fribbItem.tvdb_id;
                if (tvdbId) setOnlyIfMissing.thetvdb_id = { $ifNull: ['$thetvdb_id', tvdbId] };
                
                if (fribbItem.imdb_id) setOnlyIfMissing.imdb_id = { $ifNull: ['$imdb_id', fribbItem.imdb_id] };
                if (fribbItem.themoviedb_id) setOnlyIfMissing.themoviedb_id = { $ifNull: ['$themoviedb_id', fribbItem.themoviedb_id] };

                // Titles
                if (listsItem && listsItem.titles) {
                  if (listsItem.titles.romaji) setOnlyIfMissing.title_romaji = { $ifNull: ['$title_romaji', listsItem.titles.romaji] };
                  if (listsItem.titles.english) setOnlyIfMissing.title_english = { $ifNull: ['$title_english', listsItem.titles.english] };
                  if (listsItem.titles.native) setOnlyIfMissing.title_native = { $ifNull: ['$title_native', listsItem.titles.native] };
                  
                  const primaryTitle = listsItem.titles.english || listsItem.titles.romaji || listsItem.titles.native || null;
                  if (primaryTitle) setOnlyIfMissing.title = { $ifNull: ['$title', primaryTitle] };
                }
                
                // Type
                if (listsItem && listsItem.type) setOnlyIfMissing.type = { $ifNull: ['$type', listsItem.type] };

                bulkOps.push({
                  updateOne: {
                    filter: { mal_id: fribbItem.mal_id },
                    update: [{ $set: setOnlyIfMissing }], // Use pipeline for conditional updates
                    upsert: true
                  }
                });

                processedCount++;

                if (bulkOps.length >= batchSize) {
                  await AnimeMapping.bulkWrite(bulkOps, { ordered: false });
                  bulkOps.length = 0;
                  // Small delay to prevent blocking event loop
                  await new Promise(resolve => setImmediate(resolve));
                }
              }
            }
            if (bulkOps.length > 0) await AnimeMapping.bulkWrite(bulkOps, { ordered: false });
          }

          // Clear memory
          listsMap.clear();

          // Calculate final progress
          const progress = ((processedCount / totalItems) * 100).toFixed(2);
          console.log(`Database updated successfully with ${processedCount} mappings (${progress}% complete)`);
          
          if (reset) {
            console.log('✓ Full RESET completed - Old data wiped, fresh data inserted.');
          } else {
            console.log('✓ SAFE UPDATE completed - Only empty fields were filled, existing values preserved!');
          }

          // Update the log with success status and ETag
          updateLog.lastUpdate = new Date();
          updateLog.lastEtag = headResponse.headers.etag;
          updateLog.status = 'success';
          updateLog.error = null;
          await updateLog.save();

        } catch (error) {
          console.error('Error during merged data processing:', error);
          throw error;
        } finally {
            // No session to end
        }

        // Explicitly return nothing to prevent logging
        return;
      } catch (error) {
          console.error('Error during data fetch:', error.message);
          if (error.response) {
              console.error(`HTTP Error: ${error.response.status} - ${error.response.statusText}`);
              console.error('Response headers:', error.response.headers);
          } else if (error.request) {
              console.error('Request error - no response received:', error.message);
          }
          throw error;
      }
  } catch (error) {
      console.error('Error updating database:', error);

      const updateLog = await UpdateLog.findOne() || new UpdateLog();
      updateLog.status = 'error';
      updateLog.error = error.message;
      await updateLog.save();
  }

  // Explicitly return nothing to prevent logging
  return;
};

const apiEndpoints = {
  manualUpdate: async (req, res) => {
      try {
        const apiKey = req.headers.authorization?.split(' ')[1];
        if (!apiKey || apiKey !== process.env.API_KEY) {
            return res.status(401).json({
                error: 'Unauthorized - Invalid API key'
            });
        }

        // const userAgent = req.headers['user-agent'];
        // if (!userAgent?.includes('GitHub-Action')) {
        //     return res.status(401).json({
        //         error: 'Unauthorized - Invalid source'
        //     });
        // }
        await initialize();
        const forceUpdate = req.query.force === 'true';
        const reset = req.query.reset === 'true';
        await updateMappingsDatabase(forceUpdate, reset);
        
        res.json({ 
            message: reset ? 'Hard reset initiated' : 'Update initiated successfully',
            mode: reset ? 'RESET (Wipe & Replace)' : 'SAFE (Merge)'
        });
      } catch (error) {
          console.error('Error initiating update:', error);
          res.status(500).json({ error: 'Failed to initiate update: ' + error.message });
      }
  },

  checkUpdateStatus: async (req, res) => {
      try {
          await initialize();
          const status = await UpdateLog.findOne();
          res.json(status || { status: 'never updated' });
      } catch (error) {
          res.status(500).json({ error: 'Failed to get update status: ' + error.message });
      }
  },

  getMappingsById: async (req, res) => {
      try {
          await initialize();

          const { source, id } = req.params;
          const mapping = await AnimeMapping.findOne({ [`${source}_id`]: id });

          if (!mapping) return res.status(404).json({ error: 'Mapping not found' });
          res.json(mapping);
      } catch (error) {
          res.status(500).json({ error: error.message });
      }
  },

  backupMappings: async (req, res) => {
      try {
          await initialize();
          const currentMappings = await AnimeMapping.find({});
          const timestamp = new Date().toISOString();

          // Ensure backups directory exists
          const backupDir = path.join(__dirname, '..', 'backups');
          try {
            await fs.access(backupDir);
          } catch {
            await fs.mkdir(backupDir, { recursive: true });
          }

          const fileName = `mappings_${timestamp.replace(/[:.]/g, '-')}.json`;
          const filePath = path.join(backupDir, fileName);

          await fs.writeFile(
              filePath,
              JSON.stringify(currentMappings, null, 2)
          );
          res.json({ message: 'Mappings backed up successfully' });
      } catch (error) {
          console.error('Error backing up mappings:', error);
          res.status(500).json({ error: 'Failed to backup mappings: ' + error.message });
      }
  }
};

module.exports = {
  ...apiEndpoints,
  initialize,
  updateMappingsDatabase  // Export for direct access
};