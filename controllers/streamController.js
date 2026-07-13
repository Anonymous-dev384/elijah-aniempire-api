const axios = require('axios');

exports.downloadMedia = async (req, res) => {
    try {
        let url, referrer, filename;

        // Support Base64 encoded payload via 'q' query parameter
        if (req.query.q) {
            try {
                const payload = JSON.parse(Buffer.from(req.query.q, 'base64').toString('utf-8'));
                url = payload.url;
                referrer = payload.referrer;
                filename = payload.filename;
            } catch (e) {
                return res.status(400).json({ error: 'Invalid encoded payload' });
            }
        } else {
            // Support legacy direct params
            url = req.query.url || req.body.url;
            referrer = req.query.referrer || req.body.referrer;
            filename = req.query.filename || req.body.filename || 'video.mp4';
        }

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        console.log(`[StreamController] Downloading: ${url}`);
        console.log(`[StreamController] Filename: ${filename}`);
        if (referrer) console.log(`[StreamController] Referrer: ${referrer}`);

        // Set up headers for the external request
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        };
        
        if (referrer && referrer !== 'undefined' && referrer !== 'null') {
            headers['Referer'] = referrer;
            headers['Origin'] = new URL(referrer).origin;
        }

        // Fetch the file as a stream
        const response = await axios({
            method: 'GET',
            url: url,
            headers: headers,
            responseType: 'stream',
            timeout: 60000, // 60 seconds connection timeout
            maxRedirects: 5,
            validateStatus: status => status >= 200 && status < 400
        });

        // Forward important headers to the client
        const contentType = response.headers['content-type'] || 'application/octet-stream';
        const contentLength = response.headers['content-length'];
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '\\"')}"`);
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400'); // Cache for 1 day
        
        if (contentLength) {
            res.setHeader('Content-Length', contentLength);
        }

        // Pipe the external stream to the client response
        response.data.pipe(res);

        // Handle errors during streaming
        response.data.on('error', (err) => {
            console.error('[StreamController] Error during streaming from source:', err.message);
            if (!res.headersSent) {
                res.status(502).json({ error: 'Error reading from source stream' });
            } else {
                res.end(); // End the response if headers already sent
            }
        });

        req.on('close', () => {
            // If the client aborts the request, destroy the source stream to prevent memory leaks
            response.data.destroy();
        });

    } catch (error) {
        console.error('[StreamController] Download error:', error.message);
        
        if (!res.headersSent) {
            res.status(error.response?.status || 500).json({ 
                error: 'Failed to download media',
                message: error.message
            });
        }
    }
};

exports.proxyKatalyst = async (req, res) => {
    try {
        const streamProxyUrl = process.env.STREAM_PROXY_URL;
        if (!streamProxyUrl) {
            console.error('[StreamController] STREAM_PROXY_URL is not set in environment variables');
            return res.status(500).json({ error: 'Streaming proxy is misconfigured (missing STREAM_PROXY_URL)' });
        }

        // Clean base URL to remove trailing slash
        const cleanBase = streamProxyUrl.replace(/\/$/, '');
        
        // Reconstruct the destination URL (req.originalUrl preserves path and query parameters)
        const targetUrl = `${cleanBase}${req.originalUrl}`;

        console.log(`[StreamController] Proxying ${req.method} request to: ${targetUrl}`);

        // Forward headers from client, but strip host and connection headers
        const headers = { ...req.headers };
        delete headers.host;
        delete headers.connection;
        
        // Make request to the streaming proxy server as a stream
        const response = await axios({
            method: req.method,
            url: targetUrl,
            headers: headers,
            responseType: 'stream',
            timeout: 30000, // 30s timeout
            maxRedirects: 5,
            validateStatus: status => true // Forward all status codes (including 206 Partial Content and 304 Not Modified)
        });

        // Set status code
        res.status(response.status);

        // Forward headers from response
        Object.entries(response.headers).forEach(([key, value]) => {
            res.setHeader(key, value);
        });

        // Pipe response data
        response.data.pipe(res);

        // Clean up stream if client disconnects early
        req.on('close', () => {
            response.data.destroy();
        });

    } catch (err) {
        console.error('[StreamController] Stream proxy error:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Proxy streaming request failed', details: err.message });
        }
    }
};

