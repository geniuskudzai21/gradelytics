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

    let email = null;
    if (token) {
        const claims = decodeTokenClaims(token);
        if (claims && claims.email) email = String(claims.email).toLowerCase();
    }

    return res.status(200).json({ isAdmin: !!(email && adminEmails.includes(email)) });
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
