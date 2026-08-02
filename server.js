const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
        let body = '';
        for await (const chunk of req) body += chunk;

        try {
            const parsed = JSON.parse(body);
            const isVision = parsed.requestType === 'vision';
            const modelEnv = isVision ? process.env.VISION_MODEL : process.env.AI_MODEL;
            const apiKey = isVision
                ? (process.env.NVIDIA_VISION_API_KEY || process.env.NVIDIA_API_KEY)
                : process.env.NVIDIA_API_KEY;
            if (!apiKey) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'NVIDIA_API_KEY not set.' }));
            }
            if (modelEnv) parsed.model = modelEnv;
            delete parsed.requestType;

            const apiRes = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
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

    if (req.method === 'POST' && req.url === '/api/admin-login') {
        let body = '';
        for await (const chunk of req) body += chunk;

        const adminEmails = (process.env.ADMIN_EMAILS || '')
            .split(',')
            .map(e => e.trim().toLowerCase())
            .filter(Boolean);
        const adminPassword = process.env.ADMIN_PASSWORD || '';

        if (!adminEmails.length || !adminPassword) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'ADMIN_EMAILS / ADMIN_PASSWORD is not configured.' }));
        }

        let parsed;
        try {
            parsed = JSON.parse(body || '{}');
        } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Invalid JSON body.' }));
        }

        const email = String(parsed.email || '').trim().toLowerCase();
        const password = String(parsed.password || '');
        if (adminEmails.includes(email) && password && safeEqual(adminPassword, password)) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ role: 'admin' }));
        }
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not an admin account.' }));
    }

    if (req.method === 'POST' && req.url === '/api/delete-account') {
        const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const supabaseUrl = process.env.SUPABASE_URL;
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

        if (!serviceRole || !supabaseUrl) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured.' }));
        }
        if (!token) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Missing access token.' }));
        }

        const userId = decodeTokenUserId(token);
        if (!userId) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Invalid access token.' }));
        }

        try {
            const apiRes = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/users/${userId}`, {
                method: 'DELETE',
                headers: {
                    'apikey': serviceRole,
                    'Authorization': `Bearer ${serviceRole}`
                }
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

    if ((req.method === 'GET' || req.method === 'POST') && req.url === '/api/admin-stats') {
        const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const supabaseUrl = process.env.SUPABASE_URL;
        const adminPassword = process.env.ADMIN_PASSWORD || '';

        if (!serviceRole || !supabaseUrl) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured.' }));
        }
        if (!adminPassword) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'ADMIN_PASSWORD is not configured.' }));
        }

        const authHeader = req.headers.authorization || '';
        const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (!provided || !safeEqual(adminPassword, provided)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Access denied. Invalid admin password.' }));
        }

        try {
            const base = supabaseUrl.replace(/\/$/, '');
            const headers = {
                'apikey': serviceRole,
                'Authorization': `Bearer ${serviceRole}`,
                'Accept': 'application/json'
            };

            const usersData = await fetchJson(`${base}/auth/v1/admin/users?per_page=1000`, headers);
            const users = usersData.users || (usersData.data && usersData.data.users) || [];

            const [modules, chat, unlocks] = await Promise.all([
                fetchJson(`${base}/rest/v1/modules?select=user_id`, headers),
                fetchJson(`${base}/rest/v1/chat_messages?select=user_id`, headers),
                fetchJson(`${base}/rest/v1/achievement_unlocks?select=user_id`, headers)
            ]);

            const modCount = countBy(modules, 'user_id');
            const chatCount = countBy(chat, 'user_id');
            const unlockCount = countBy(unlocks, 'user_id');

            const rows = users.map(u => {
                const m = modCount.get(u.id) || 0;
                const c = chatCount.get(u.id) || 0;
                const a = unlockCount.get(u.id) || 0;
                return {
                    id: u.id,
                    email: u.email || '(no email)',
                    created_at: u.created_at || u.createdAt || null,
                    modules: m,
                    chat_messages: c,
                    achievements: a,
                    active: m > 0 || c > 0 || a > 0
                };
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                totalUsers: rows.length,
                activeUsers: rows.filter(r => r.active).length,
                totalModules: modules.length,
                totalChatMessages: chat.length,
                totalAchievements: unlocks.length,
                signupsByDay: signupsByDay(rows, 30),
                users: rows
            }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    if (req.url.startsWith('/api/admin-user')) {
        const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const supabaseUrl = process.env.SUPABASE_URL;
        const adminPassword = process.env.ADMIN_PASSWORD || '';

        if (!serviceRole || !supabaseUrl) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured.' }));
        }
        if (!adminPassword) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'ADMIN_PASSWORD is not configured.' }));
        }

        const authHeader = req.headers.authorization || '';
        const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (!provided || !safeEqual(adminPassword, provided)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Access denied. Invalid admin password.' }));
        }

        const parsedUrl = new URL(req.url, 'http://localhost');
        const id = parsedUrl.searchParams.get('id') || '';
        const base = supabaseUrl.replace(/\/$/, '');
        const headers = {
            'apikey': serviceRole,
            'Authorization': `Bearer ${serviceRole}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };

        try {
            if (req.method === 'GET') {
                if (!id) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Missing user id.' }));
                }
                const userRes = await fetch(`${base}/auth/v1/admin/users/${id}`, { headers });
                if (!userRes.ok) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'User not found.' }));
                }
                const user = await userRes.json();
                const meta = user.user_metadata || user.raw_user_meta_data || {};

                const [modules, chat, achievements] = await Promise.all([
                    fetchJson(`${base}/rest/v1/modules?select=id,name,year,part,semester,mark,grade&user_id=eq.${encodeURIComponent(id)}&order=year.asc,semester.asc,id.asc`, headers),
                    fetchJson(`${base}/rest/v1/chat_messages?select=id,role,content,created_at&user_id=eq.${encodeURIComponent(id)}&order=created_at.asc,id.asc`, headers),
                    fetchJson(`${base}/rest/v1/achievement_unlocks?select=unlock_key,unlocked_at&user_id=eq.${encodeURIComponent(id)}&order=unlocked_at.asc`, headers)
                ]);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({
                    user: {
                        id: user.id,
                        email: user.email || '',
                        display_name: meta.display_name || null,
                        created_at: user.created_at || user.createdAt || null,
                        last_sign_in_at: user.last_sign_in_at || user.lastSignInAt || null,
                        phone: user.phone || null
                    },
                    modules,
                    chat,
                    achievements
                }));
            }

            if (req.method === 'PUT') {
                if (!id) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Missing user id.' }));
                }
                let body = '';
                for await (const chunk of req) body += chunk;
                let parsed;
                try {
                    parsed = JSON.parse(body || '{}');
                } catch (err) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Invalid JSON body.' }));
                }

                const curRes = await fetch(`${base}/auth/v1/admin/users/${id}`, { headers });
                if (!curRes.ok) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'User not found.' }));
                }
                const cur = await curRes.json();
                const curMeta = cur.user_metadata || cur.raw_user_meta_data || {};

                const payload = {};
                if (parsed.email) payload.email = String(parsed.email);
                if (parsed.password) payload.password = String(parsed.password);
                if (typeof parsed.display_name === 'string') {
                    const clean = parsed.display_name.replace(/[^a-zA-Z0-9 ]/g, '').trim();
                    if (clean) payload.user_metadata = { ...curMeta, display_name: clean };
                }
                if (Object.keys(payload).length === 0) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Nothing to update.' }));
                }

                const updRes = await fetch(`${base}/auth/v1/admin/users/${id}`, {
                    method: 'PUT',
                    headers,
                    body: JSON.stringify(payload)
                });
                const updText = await updRes.text();
                if (!updRes.ok) {
                    let msg = updText;
                    try { msg = (JSON.parse(updText).msg) || updText; } catch (e) { /* keep raw */ }
                    res.writeHead(updRes.status, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Update failed: ' + msg }));
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(updText);
            }

            if (req.method === 'DELETE') {
                if (!id) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Missing user id.' }));
                }
                const delRes = await fetch(`${base}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers });
                if (!delRes.ok && delRes.status !== 404) {
                    res.writeHead(delRes.status, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Failed to delete user.' }));
                }
                await Promise.all([
                    fetch(`${base}/rest/v1/modules?user_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers }),
                    fetch(`${base}/rest/v1/chat_messages?user_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers }),
                    fetch(`${base}/rest/v1/achievement_unlocks?user_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers })
                ]);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ ok: true }));
            }

            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed.' }));
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
    console.log(`SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'NOT SET — add it to .env for account deletion'}`);
    console.log(`ADMIN_EMAILS / ADMIN_PASSWORD: ${process.env.ADMIN_EMAILS && process.env.ADMIN_PASSWORD ? 'set' : 'NOT SET — add both to .env for the admin login'}`);
});

async function fetchJson(url, headers) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error('Request failed: ' + res.status + ' ' + url);
    return res.json();
}

function countBy(list, key) {
    const map = new Map();
    (list || []).forEach(item => {
        const k = item[key];
        map.set(k, (map.get(k) || 0) + 1);
    });
    return map;
}

function safeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function signupsByDay(rows, days) {
    const out = [];
    const map = new Map();
    const now = new Date();
    rows.forEach(r => {
        if (!r.created_at) return;
        const d = new Date(r.created_at);
        if (isNaN(d.getTime())) return;
        const key = d.toISOString().slice(0, 10);
        map.set(key, (map.get(key) || 0) + 1);
    });
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        out.push({ day: key, count: map.get(key) || 0 });
    }
    return out;
}

function decodeTokenClaims(token) {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    try {
        return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    } catch (e) {
        return null;
    }
}

function decodeTokenUserId(token) {
    const claims = decodeTokenClaims(token);
    return claims ? claims.sub : null;
}
