/* Answers "should this signed-in account be sent to the admin console?" for the
   Google sign-in flow. Two sources of truth:
     1. ADMIN_EMAILS env allowlist (the owner)
     2. profiles.role = 'admin' (promoted from the admin console)          */

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const adminEmails = (process.env.ADMIN_EMAILS || '')
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(Boolean);

    const authHeader = (req.headers && req.headers.authorization) || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
        return res.status(200).json({ isAdmin: false });
    }

    const claims = decodeTokenClaims(token);
    const email = claims && claims.email ? String(claims.email).toLowerCase() : null;
    const userId = (claims && claims.sub) || null;

    if (email && adminEmails.includes(email)) {
        return res.status(200).json({ isAdmin: true, via: 'allowlist' });
    }

    const role = await fetchRole(userId);
    if (role === 'admin') {
        return res.status(200).json({ isAdmin: true, via: 'role' });
    }

    return res.status(200).json({ isAdmin: false });
}

async function fetchRole(userId) {
    if (!userId) return null;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    try {
        const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/profiles?select=role&id=eq.${encodeURIComponent(userId)}&limit=1`, {
            headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }
        });
        if (!res.ok) return null;
        const rows = await res.json();
        return rows && rows.length ? rows[0].role : null;
    } catch (e) {
        return null;
    }
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