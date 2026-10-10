export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!serviceRole || !supabaseUrl || !anonKey) {
        return res.status(500).json({ error: 'Supabase is not configured.' });
    }

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
        return res.status(401).json({ error: 'Missing access token.' });
    }

    // Verify the token against Supabase Auth before trusting it. The caller can
    // only ever delete their OWN account: the verified user id returned by
    // GoTrue is the target, never a value decoded from an unverified client
    // claim (forgeable) — see OWASP A01/A02.
    const userId = await verifyUserId(supabaseUrl, anonKey, token);
    if (!userId) {
        return res.status(401).json({ error: 'Invalid or expired access token.' });
    }

    try {
        const apiRes = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
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
        console.error('[delete-account] deletion failed:', error.message);
        res.status(500).json({ error: 'Account deletion failed. Please try again.' });
    }
}

async function verifyUserId(base, anonKey, token) {
    try {
        const res = await fetch(`${base.replace(/\/$/, '')}/auth/v1/user`, {
            headers: { apikey: anonKey, Authorization: `Bearer ${token}` }
        });
        if (!res.ok) return null;
        const data = await res.json();
        return (data && data.id) || null;
    } catch (e) {
        return null;
    }
}