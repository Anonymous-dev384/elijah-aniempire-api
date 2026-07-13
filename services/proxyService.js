const Proxy = require('../models/Proxy');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');
const { isDBConnected } = require('../config/db');

class ProxyService {
    constructor() {
        this.maxFailuresBeforeDead = 5;
        this.envIndex = 0;
        this.initEnvProxies();
    }

    initEnvProxies() {
        const hosts = process.env.PROXY_HOSTS ? process.env.PROXY_HOSTS.split(',') : [];
        const user = process.env.PROXY_USER;
        const pass = process.env.PROXY_PASS;
        const singleUrl = process.env.PROXY_URL;

        console.log(`[ProxyService] Checking env: HOSTS=${hosts.length}, USER=${user ? 'SET' : 'MISSING'}`);

        this.envProxies = hosts.map(h => {
            const parts = h.trim().split(':');
            return {
                host: parts[0],
                port: parts[1] || 80,
                user,
                pass
            };
        }).filter(p => p.host);

        if (singleUrl && this.envProxies.length === 0) {
            this.envProxies.push({ url: singleUrl });
        }

        if (this.envProxies.length > 0) {
            console.log(`[ProxyService] Initialized with ${this.envProxies.length} environment proxies.`);
        } else {
            console.error('[ProxyService] CRITICAL: No environment proxies found in .env! Direct requests will likely be blocked.');
        }
    }

    /**
     * Get the next available proxy (rotates based on last used)
     */
    async getNextProxy() {
        try {
            // Priority 1: DB Proxies
            if (isDBConnected()) {
                const dbProxy = await Proxy.findOne({ status: 'active' }).sort({ lastUsed: 1 });
                if (dbProxy) {
                    dbProxy.lastUsed = new Date();
                    await dbProxy.save();
                    return {
                        url: dbProxy.getProxyUrl(),
                        id: dbProxy._id,
                        source: 'db'
                    };
                }
            }

            // Priority 2: Env Rotation
            if (this.envProxies.length > 0) {
                const p = this.envProxies[this.envIndex % this.envProxies.length];
                this.envIndex++;

                if (p.url) return { url: p.url, source: 'env' };

                return {
                    url: this.formatProxyUrl(p),
                    source: 'env'
                };
            }

            return null; // Direct connection
        } catch (error) {
            console.error('ProxyService: Error getting next proxy:', error.message);
            return null;
        }
    }

    /**
     * Get all available env proxies for libraries that support internal rotation
     */
    getAllProxies() {
        return this.envProxies.map(p => p.url ? p.url : this.formatProxyUrl(p));
    }

    formatProxyUrl({ host, port, user, pass }) {
        let auth = '';
        if (user && pass) {
            let u = user;
            if (host.includes('oxylabs.io') && !u.startsWith('user-')) {
                u = `user-${u}`;
            }
            auth = `${encodeURIComponent(u)}:${encodeURIComponent(pass)}@`;
        }
        return `http://${auth}${host}:${port}`;
    }

    /**
     * Mark a proxy as failed
     */
    async reportFailure(proxyId) {
        if (!proxyId) return;
        if (!isDBConnected()) return;
        try {
            const proxy = await Proxy.findById(proxyId);
            if (proxy) {
                proxy.failCount += 1;
                if (proxy.failCount >= this.maxFailuresBeforeDead) {
                    proxy.status = 'dead';
                    proxy.errorMessage = 'Exceeded maximum failure count';
                }
                await proxy.save();
            }
        } catch (error) {
            console.error('ProxyService: Error reporting failure:', error.message);
        }
    }

    /**
     * Mark a proxy as successful (reset fail count)
     */
    async reportSuccess(proxyId) {
        if (!proxyId) return;
        if (!isDBConnected()) return;
        try {
            await Proxy.findByIdAndUpdate(proxyId, { failCount: 0, status: 'active', errorMessage: null });
        } catch (error) {
            console.error('ProxyService: Error reporting success:', error.message);
        }
    }

    /**
     * Test a proxy's connectivity
     */
    async testProxy(proxyUrl) {
        try {
            const agent = proxyUrl.startsWith('https') 
                ? new HttpsProxyAgent(proxyUrl)
                : new HttpProxyAgent(proxyUrl);

            const start = Date.now();
            await axios.get('https://www.google.com', {
                httpsAgent: agent,
                httpAgent: agent,
                timeout: 5000
            });
            return { success: true, latency: Date.now() - start };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

module.exports = new ProxyService();
