const mongoose = require('mongoose');

const ProxySchema = new mongoose.Schema({
    host: {
        type: String,
        required: true,
        trim: true
    },
    port: {
        type: Number,
        required: true
    },
    username: {
        type: String,
        default: null
    },
    password: {
        type: String,
        default: null
    },
    protocol: {
        type: String,
        default: 'http',
        enum: ['http', 'https', 'socks4', 'socks5']
    },
    status: {
        type: String,
        default: 'active',
        enum: ['active', 'dead', 'testing']
    },
    failCount: {
        type: Number,
        default: 0
    },
    lastUsed: {
        type: Date,
        default: null
    },
    lastTested: {
        type: Date,
        default: null
    },
    errorMessage: {
        type: String,
        default: null
    }
}, {
    timestamps: true
});

// Helper to get formatted proxy URL
ProxySchema.methods.getProxyUrl = function() {
    let username = this.username || process.env.PROXY_USER;
    let password = this.password || process.env.PROXY_PASS;

    if (!username || !password) {
        return `${this.protocol}://${this.host}:${this.port}`;
    }

    // Specialized logic for Oxylabs
    if (this.host.includes('oxylabs.io') && !username.startsWith('user-')) {
        username = `user-${username}`;
    }

    return `${this.protocol}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${this.host}:${this.port}`;
};

module.exports = mongoose.model('Proxy', ProxySchema);
