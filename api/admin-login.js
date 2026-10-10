import { timingSafeEqual } from 'crypto';

/* Online brute-force guard for the master admin password: per-IP sliding
   window (10 attempts / 15 min). Best-effort only — resets on serverless cold
   start — but it stops casual brute-forcing. Failures are logged so the owner
   can spot attacks in Vercel's function logs (OWASP A07/A09). */
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map();

function ipOf(req) {
    const fwd = (req.headers && req.headers['x-forwarded-for']) || '';
    if (fwd) return String(fwd).split(',')[0].trim();
    return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function rateLimited(ip) {
    const now = Date.now();
    const list = (attempts.get(ip) || []).filter(t => now - t < WINDOW_MS);
    if (list.length >= MAX_ATTEMPTS) {
        attempts.set(ip, list);
        return true;
    }
    return false;
}

function recordFailure(ip) {
    const now = Date.now();
    const list = (attempts.get(ip) || []).filter(t => now - t < WINDOW_MS);
    list.push(now);
    attempts.set(ip, list);
    if (attempts.size > 5000) attempts.clear();
}

function clearFailures(ip) {
    attempts.delete(ip);
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const ip = ipOf(req);
    if (rateLimited(ip)) {
        console.warn('[admin-login] rate-limited', ip);
        return res.status(429).json({ error: 'Too many attempts. Try again later.' });
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
        clearFailures(ip);
        return res.status(200).json({ role: 'admin' });
    }

    recordFailure(ip);
    console.warn('[admin-login] failed attempt', { ip, email });
    return res.status(403).json({ error: 'Not an admin account.' });
}

function safeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
}