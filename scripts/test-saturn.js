
const { ANIME } = require('@consumet/extensions');
async function test() {
    const saturn = new ANIME.AnimeSaturn();
    console.log('Default baseUrl:', saturn.baseUrl);
    saturn.baseUrl = 'https://www.animesaturn.cx/';
    console.log('Overridden baseUrl:', saturn.baseUrl);
    try {
        console.log('Searching for "Death Note"...');
        const results = await saturn.search('Death Note');
        console.log('Results:', JSON.stringify(results, null, 2));
    } catch (e) {
        console.error('Search failed:', e.message);
    }
}
test();
