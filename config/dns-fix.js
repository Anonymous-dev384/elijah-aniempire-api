const dns = require('dns');

try {
    // Force Node.js to use Google & Cloudflare DNS
    // This fixes issues where local DNS or ISP DNS fails to resolve SRV records
    dns.setServers(['8.8.8.8', '1.1.1.1']);
    console.log('DNS servers manually set to Google/Cloudflare (8.8.8.8, 1.1.1.1)');
} catch (err) {
    console.warn('Failed to set manual DNS servers:', err.message);
}
