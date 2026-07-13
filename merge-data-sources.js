// Script to merge Fribb and anime-and-manga lists data
const axios = require('axios');

async function mergeDataSources() {
  try {
    console.log('Downloading Fribb data...');
    const fribbUrl = 'https://cdn.jsdelivr.net/gh/Fribb/anime-lists/anime-list-full.json';
    const fribbResponse = await axios.get(fribbUrl);
    const fribbData = fribbResponse.data;
    console.log(`Downloaded ${fribbData.length} entries from Fribb`);

    console.log('Downloading anime-and-manga/lists data...');
    const listsUrl = 'https://raw.githubusercontent.com/anime-and-manga/lists/refs/heads/main/anime-full.json';
    const listsResponse = await axios.get(listsUrl);
    const listsData = listsResponse.data;
    console.log(`Downloaded ${listsData.length} entries from anime-and-manga/lists`);

    // Create a lookup map from the lists data for faster merging
    console.log('Creating lookup map...');
    const listsMap = {};
    for (const item of listsData) {
      if (item.idMal) {
        listsMap[item.idMal] = item;
      }
    }
    console.log(`Created lookup map with ${Object.keys(listsMap).length} entries`);

    // Merge the data
    console.log('Merging data...');
    const mergedData = [];
    let mergedCount = 0;
    
    for (const fribbItem of fribbData) {
      if (fribbItem.mal_id) {
        const listsItem = listsMap[fribbItem.mal_id];
        
        // Start with the Fribb data (has more ID mappings)
        const mergedItem = { ...fribbItem };
        
        // Add title data from lists if available
        if (listsItem) {
          mergedCount++;
          
          // Add titles from lists data
          if (listsItem.titles) {
            if (listsItem.titles.romaji) mergedItem.title_romaji = listsItem.titles.romaji;
            if (listsItem.titles.english) mergedItem.title_english = listsItem.titles.english;
            if (listsItem.titles.native) mergedItem.title_native = listsItem.titles.native;
          }
          
          // Add type from lists data
          if (listsItem.type) mergedItem.type = listsItem.type;
        }
        
        mergedData.push(mergedItem);
      }
    }
    
    console.log(`Merged ${mergedCount} entries successfully`);
    console.log(`Total merged data size: ${mergedData.length} entries`);
    
    // Save the merged data to a file
    const fs = require('fs');
    fs.writeFileSync('merged-anime-data.json', JSON.stringify(mergedData, null, 2));
    console.log('Merged data saved to merged-anime-data.json');
    
    // Show a sample of the merged data
    console.log('Sample merged entry:', JSON.stringify(mergedData[0], null, 2));
    
  } catch (error) {
    console.error('Error merging data sources:', error.message);
    console.error('Stack:', error.stack);
  }
}

mergeDataSources();