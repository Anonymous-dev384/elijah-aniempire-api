const Proxy = require('../models/Proxy');
const proxyService = require('../services/proxyService');

const proxyController = {
    addProxy: async (req, res) => {
        try {
            const { host, port, username, password, protocol = 'http' } = req.body;
            
            // Basic validation
            if (!host || !port) {
                return res.status(400).json({ error: 'Host and port are required' });
            }

            const newProxy = await Proxy.create({ host, port, username, password, protocol });
            
            // Test immediately
            const testResult = await proxyService.testProxy(newProxy.getProxyUrl());
            if (testResult.success) {
                newProxy.status = 'active';
                newProxy.lastTested = new Date();
            } else {
                newProxy.status = 'dead';
                newProxy.errorMessage = testResult.error;
            }
            await newProxy.save();

            res.status(201).json({ 
                message: 'Proxy added successfully', 
                proxy: newProxy,
                test: testResult 
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    getAllProxies: async (req, res) => {
        try {
            const proxies = await Proxy.find().sort({ createdAt: -1 });
            res.json(proxies);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    deleteProxy: async (req, res) => {
        try {
            await Proxy.findByIdAndDelete(req.params.id);
            res.json({ message: 'Proxy deleted' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    testAllProxies: async (req, res) => {
        try {
            const proxies = await Proxy.find();
            const results = [];
            
            for (const proxy of proxies) {
                const res = await proxyService.testProxy(proxy.getProxyUrl());
                proxy.lastTested = new Date();
                if (res.success) {
                    proxy.status = 'active';
                    proxy.failCount = 0;
                    proxy.errorMessage = null;
                } else {
                    proxy.status = 'dead';
                    proxy.errorMessage = res.error;
                }
                await proxy.save();
                results.push({ id: proxy._id, host: proxy.host, ...res });
            }
            
            res.json({ message: 'Tests completed', results });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    seedOxylabs: async (req, res) => {
        try {
            const ports = [8001, 8002, 8003, 8004, 8005];
            const host = 'dc.oxylabs.io';
            const created = [];

            for (const port of ports) {
                const existing = await Proxy.findOne({ host, port });
                if (!existing) {
                    const p = await Proxy.create({ host, port, protocol: 'http' });
                    created.push(p);
                }
            }

            res.json({ 
                message: `Oxylabs seeding complete. Added ${created.length} new proxies.`,
                proxies: created
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
};

module.exports = proxyController;
