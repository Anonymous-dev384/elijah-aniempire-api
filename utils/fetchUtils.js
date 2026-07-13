const axios = require('axios');
const proxyService = require('../services/proxyService');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');
const axiosRetry = require('axios-retry').default;

const DIRECT_CDN_DOMAINS = [
    'googlevideo.com',
    'drive.google.com'
];

/**
 * Enhanced fetch utility that supports proxy rotation and fallbacks
 */
const fetcher = axios.create({
    timeout: 30000, // Increased to 30s for slower connections
    headers: {
        'User-Agent': 'aniempire-api/1.0 (compatible; Node.js)'
    }
});

// Setup automatic retries
axiosRetry(fetcher, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) => {
        // Retry on network errors or 5xx status naturally
        return axiosRetry.isNetworkOrIdempotentRequestError(error) || 
               (error.response && error.response.status >= 500);
    },
    onRetry: (retryCount, error, requestConfig) => {
        console.log(`Fetcher: Retry attempt #${retryCount} for ${requestConfig.url} due to: ${error.message}`);
    }
});

// Interceptor to add proxy to every request
fetcher.interceptors.request.use(async (config) => {
    // Skip proxy if explicitly disabled
    if (config.useProxy === false) return config;

    const proxy = await proxyService.getNextProxy();
    if (proxy) {
        const isOxylabs = proxy.url.includes('oxylabs.io');
        const targetIsHttps = config.url.startsWith('https');
        
        console.log(`Fetcher: Using ${isOxylabs ? 'Oxylabs' : proxy.source} proxy config for ${targetIsHttps ? 'HTTPS' : 'HTTP'} target`); 
        
        const agentOptions = { 
            rejectUnauthorized: false,
            keepAlive: true,
            timeout: 60000 // Increased timeout for the proxy handshake
        };

        const agent = targetIsHttps 
            ? new HttpsProxyAgent(proxy.url, agentOptions)
            : new HttpProxyAgent(proxy.url, agentOptions);
        
        config.httpsAgent = agent;
        config.httpAgent = agent;
        config.proxy = false; 

        // Let axios handle decompression (removing identity)
        // Also ensure we accept JSON and other formats
        config.headers['Accept'] = 'application/json, text/plain, */*';
        
        config.metadata = { ...config.metadata, proxy };
    }
    
    return config;
}, (error) => {
    return Promise.reject(error);
});

// Interceptor to handle proxy failures
fetcher.interceptors.response.use((response) => {
    const proxyMetadata = response.config.metadata?.proxy;
    if (proxyMetadata?.id) {
        proxyService.reportSuccess(proxyMetadata.id).catch(err => console.error('Proxy reporting success failed:', err.message));
    }
    return response;
}, async (error) => {
    const proxyMetadata = error.config?.metadata?.proxy;
    if (proxyMetadata) {
        const status = error.response ? error.response.status : 'NO_RESPONSE';
        console.error(`Fetcher: Proxy failure (${proxyMetadata.source}) - Status: ${status} - Error: ${error.message} (${error.code || 'NO_CODE'})`);
        
        if (proxyMetadata.id && error.response?.status !== 404) {
            // Only report failure to DB if it's not a logical 404
            proxyService.reportFailure(proxyMetadata.id).catch(err => console.error('Proxy reporting failure failed:', err.message));
        }
    }
    return Promise.reject(error);
});

async function fetchUrl(url, options = {}) {
    try {
        const response = await fetcher.get(url, options);
        return response.data;
    } catch (error) {
        if (error.response) {
            throw new Error(`Fetch failed: ${error.response.status} ${error.response.statusText}`);
        }
        throw error;
    }
}

module.exports = {
    fetchUrl,
    fetcher, // Export the instance for direct use (e.g. POST requests)
    DIRECT_CDN_DOMAINS
};
