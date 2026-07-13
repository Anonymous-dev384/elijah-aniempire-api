// Script to force update the mappings database with detailed logging
const connectDB = require('./config/db');
const { updateMappingsDatabase } = require('./controllers/mappingController');

async function forceUpdate() {
  try {
    console.log('Connecting to database...');
    await connectDB();
    console.log('Database connected.');
    
    console.log('Forcing update of mappings database...');
    console.time('Update Duration');
    await updateMappingsDatabase(true); // Pass true to force update
    console.timeEnd('Update Duration');
    console.log('Update completed!');
  } catch (error) {
    console.error('Error during forced update:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

forceUpdate();