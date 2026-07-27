const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const [key, ...rest] = line.split('=');
        if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
    });
}

const PORT = 3000;

const MIME = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/chat') {
        const apiKey = process.env.NVIDIA_API_KEY;
        if (!apiKey) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'NVIDIA_API_KEY not set. Run: set NVIDIA_API_KEY=your_key' }));
        }

        let body = '';
        for await (const chunk of req) body += chunk;

        try {
            const parsed = JSON.parse(body);
            const modelEnv = parsed.requestType === 'vision'
                ? process.env.VISION_MODEL
                : process.env.AI_MODEL;
            if (modelEnv) parsed.model = modelEnv;
            delete parsed.requestType;

            const apiRes = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(parsed)
            });
            const text = await apiRes.text();
            res.writeHead(apiRes.status, { 'Content-Type': 'application/json' });
            res.end(text);
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    const ext = path.extname(filePath);
    const contentType = MIME[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            return res.end('<h1>404 Not Found</h1>');
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`Gradelytics running at http://localhost:${PORT}`);
    console.log(`NVIDIA_API_KEY: ${process.env.NVIDIA_API_KEY ? 'set' : 'NOT SET — run: set NVIDIA_API_KEY=your_key'}`);
});
