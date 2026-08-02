export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const adminEmails = (process.env.ADMIN_EMAILS || '')
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(Boolean);

    if (!serviceRole || !supabaseUrl) {
        return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured.' });
    }
    if (adminEmails.length === 0) {
        return res.status(500).json({ error: 'ADMIN_EMAILS is not configured.' });
    }

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
        return res.status(401).json({ error: 'Missing access token.' });
    }

    const claims = decodeToken(token);
    if (!claims) {
        return res.status(401).json({ error: 'Invalid access token.' });
    }

    const email = (claims.email || '').toLowerCase();
    if (!email || !adminEmails.includes(email)) {
        return res.status(403).json({ error: 'Access denied. You are not an admin.' });
    }

    try {
        const base = supabaseUrl.replace(/\/$/, '');
        const headers = {
            'apikey': serviceRole,
            'Authorization': `Bearer ${serviceRole}`,
            'Accept': 'application/json'
        };

        // All auth users come from the GoTrue admin API (service_role bypasses RLS).
        const usersRes = await fetch(`${base}/auth/v1/admin/users?per_page=1000`, { headers });
        if (!usersRes.ok) throw new Error('Failed to list users: ' + usersRes.status);
        const usersData = await usersRes.json();
        const users = usersData.users || (usersData.data && usersData.data.users) || [];

        const [modules, chat, unlocks] = await Promise.all([
            fetchRows(`${base}/rest/v1/modules?select=user_id`, headers),
            fetchRows(`${base}/rest/v1/chat_messages?select=user_id`, headers),
            fetchRows(`${base}/rest/v1/achievement_unlocks?select=user_id`, headers)
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

        res.status(200).json({
            totalUsers: rows.length,
            activeUsers: rows.filter(r => r.active).length,
            totalModules: modules.length,
            totalChatMessages: chat.length,
            totalAchievements: unlocks.length,
            signupsByDay: signupsByDay(rows, 30),
            users: rows
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

async function fetchRows(url, headers) {
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
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

function decodeToken(token) {
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
