const https = require('https');
const http = require('http');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const { url } = req.query;
        if (!url) {
            res.status(400).json({ error: '缺少URL参数' });
            return;
        }

        const protocol = url.startsWith('https') ? https : http;
        const parsedUrl = new URL(url);
        
        const reqOptions = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (url.startsWith('https') ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
                'Referer': 'https://www.douyin.com/',
                'Accept': '*/*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Accept-Encoding': 'identity'
            },
            timeout: 30000
        };

        const proxyReq = protocol.request(reqOptions, (proxyRes) => {
            const statusCode = proxyRes.statusCode || 500;
            
            if (statusCode >= 300 && statusCode < 400 && proxyRes.headers.location) {
                const redirectUrl = new URL(proxyRes.headers.location, url).href;
                res.writeHead(302, { 'Location': `/api/download?url=${encodeURIComponent(redirectUrl)}` });
                res.end();
                return;
            }
            
            const contentLength = proxyRes.headers['content-length'];
            const contentType = proxyRes.headers['content-type'] || 'application/octet-stream';
            
            res.writeHead(statusCode, {
                'Content-Type': contentType,
                'Content-Length': contentLength,
                'Content-Disposition': 'attachment; filename="video.mp4"'
            });
            
            proxyRes.pipe(res);
        });

        proxyReq.on('error', (error) => {
            console.error('Download proxy error:', error.message);
            res.status(500).json({ error: '下载失败' });
        });

        proxyReq.on('timeout', () => {
            proxyReq.destroy();
            res.status(500).json({ error: '下载超时' });
        });

        proxyReq.end();
    } catch (error) {
        console.error('Download handler error:', error.message);
        res.status(500).json({ error: error.message });
    }
};
