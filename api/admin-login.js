import { timingSafeEqual } from 'crypto';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const adminEmails = (process.env.ADMIN_EMAILS || '')
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(Boolean);
    const adminPassword = process.env.ADMIN_PASSWORD || '';

    if (!adminEmails.length || !adminPassword) {
        return res.status(500).json({ error: 'ADMIN_EMAILS / ADMIN_PASSWORD is not configured.' });
    }

    const body = req.body || {};
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (adminEmails.includes(email) && password && safeEqual(adminPassword, password)) {
        return res.status(200).json({ role: 'admin' });
    }
    return res.status(403).json({ error: 'Not an admin account.' });
}

function safeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
}
