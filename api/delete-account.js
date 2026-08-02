export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    if (!serviceRole || !supabaseUrl) {
        return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured.' });
    }

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
        return res.status(401).json({ error: 'Missing access token.' });
    }

    const userId = decodeUserId(token);
    if (!userId) {
        return res.status(401).json({ error: 'Invalid access token.' });
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
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

function decodeUserId(token) {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    try {
        const claims = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
        return claims.sub || null;
    } catch (e) {
        return null;
    }
}
