import { timingSafeEqual } from 'crypto';

export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'PUT' && req.method !== 'DELETE') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const adminPassword = process.env.ADMIN_PASSWORD || '';

    if (!serviceRole || !supabaseUrl) {
        return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured.' });
    }
    if (!adminPassword) {
        return res.status(500).json({ error: 'ADMIN_PASSWORD is not configured.' });
    }

    const authHeader = req.headers.authorization || '';
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!provided || !safeEqual(adminPassword, provided)) {
        return res.status(403).json({ error: 'Access denied. Invalid admin password.' });
    }

    const base = supabaseUrl.replace(/\/$/, '');
    const headers = {
        'apikey': serviceRole,
        'Authorization': `Bearer ${serviceRole}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };

    const id = String((req.query && req.query.id) || '');

    try {
        if (req.method === 'GET') {
            if (!id) return res.status(400).json({ error: 'Missing user id.' });

            const userRes = await fetch(`${base}/auth/v1/admin/users/${id}`, { headers });
            if (!userRes.ok) return res.status(404).json({ error: 'User not found.' });
            const user = await userRes.json();
            const meta = user.user_metadata || user.raw_user_meta_data || {};

            const [modules, chat, achievements, usage] = await Promise.all([
                fetchRows(`${base}/rest/v1/modules?select=id,name,year,part,semester,mark,grade&user_id=eq.${encodeURIComponent(id)}&order=year.asc,semester.asc,id.asc`, headers),
                fetchRows(`${base}/rest/v1/chat_messages?select=id,role,content,created_at&user_id=eq.${encodeURIComponent(id)}&order=created_at.asc,id.asc`, headers),
                fetchRows(`${base}/rest/v1/achievement_unlocks?select=unlock_key,unlocked_at&user_id=eq.${encodeURIComponent(id)}&order=unlocked_at.asc`, headers),
                fetchRows(`${base}/rest/v1/usage_sessions?select=started_at,duration_seconds&user_id=eq.${encodeURIComponent(id)}&order=started_at.asc`, headers)
            ]);

            const timeSpentSeconds = (usage || []).reduce((s, u) => s + (Number(u.duration_seconds) || 0), 0);

            return res.status(200).json({
                user: {
                    id: user.id,
                    email: user.email || '',
                    display_name: meta.display_name || null,
                    created_at: user.created_at || user.createdAt || null,
                    last_sign_in_at: user.last_sign_in_at || user.lastSignInAt || null,
                    phone: user.phone || null,
                    time_spent_seconds: timeSpentSeconds
                },
                modules,
                chat,
                achievements,
                usage
            });
        }

        if (req.method === 'PUT') {
            if (!id) return res.status(400).json({ error: 'Missing user id.' });
            const body = req.body || {};

            const curRes = await fetch(`${base}/auth/v1/admin/users/${id}`, { headers });
            if (!curRes.ok) return res.status(404).json({ error: 'User not found.' });
            const cur = await curRes.json();
            const curMeta = cur.user_metadata || cur.raw_user_meta_data || {};

            const payload = {};
            if (body.email) payload.email = String(body.email);
            if (body.password) payload.password = String(body.password);
            if (typeof body.display_name === 'string') {
                const clean = body.display_name.replace(/[^a-zA-Z0-9 ]/g, '').trim();
                if (clean) payload.user_metadata = { ...curMeta, display_name: clean };
            }
            if (Object.keys(payload).length === 0) {
                return res.status(400).json({ error: 'Nothing to update.' });
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
                return res.status(updRes.status).json({ error: 'Update failed: ' + msg });
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(updText);
        }

        if (req.method === 'DELETE') {
            if (!id) return res.status(400).json({ error: 'Missing user id.' });

            const delRes = await fetch(`${base}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers });
            if (!delRes.ok && delRes.status !== 404) {
                return res.status(delRes.status).json({ error: 'Failed to delete user.' });
            }

            await Promise.all([
                deleteRows(`${base}/rest/v1/modules?user_id=eq.${encodeURIComponent(id)}`, headers),
                deleteRows(`${base}/rest/v1/chat_messages?user_id=eq.${encodeURIComponent(id)}`, headers),
                deleteRows(`${base}/rest/v1/achievement_unlocks?user_id=eq.${encodeURIComponent(id)}`, headers),
                deleteRows(`${base}/rest/v1/usage_sessions?user_id=eq.${encodeURIComponent(id)}`, headers)
            ]);

            return res.status(200).json({ ok: true });
        }
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

async function fetchRows(url, headers) {
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    return res.json();
}

async function deleteRows(url, headers) {
    const res = await fetch(url, { method: 'DELETE', headers });
    if (!res.ok) throw new Error('Failed to delete user data: ' + res.status);
}

function safeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
}
