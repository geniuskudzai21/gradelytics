import { timingSafeEqual } from 'crypto';

/* ─────────────────────────────────────────────────────────────────────────────
   Shared admin authorisation for the /api/admin-* serverless functions.

   Two ways to be an admin:

   1. The master ADMIN_PASSWORD (the owner). Unchanged behaviour.
   2. A real Supabase access token whose profiles.role = 'admin' — i.e. somebody
      the owner promoted from the admin console.

   The `Bearer` token may be either, so callers send one header and we figure
   out which it is. A promoted admin never sees the master password.
   ───────────────────────────────────────────────────────────────────────────── */

export async function authorizeAdmin(req) {
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const adminPassword = process.env.ADMIN_PASSWORD || '';

    if (!serviceRole || !supabaseUrl) {
        return { ok: false, status: 500, error: 'SUPABASE_SERVICE_ROLE_KEY is not configured.' };
    }
    if (!adminPassword) {
        return { ok: false, status: 500, error: 'ADMIN_PASSWORD is not configured.' };
    }

    const header = (req.headers && req.headers.authorization) || '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!provided) {
        return { ok: false, status: 403, error: 'Access denied. Admin credentials required.' };
    }

    // 1. Master password — the owner.
    if (safeEqual(adminPassword, provided)) {
        return { ok: true, actor: { kind: 'owner', userId: null }, serviceRole, supabaseUrl };
    }

    // 2. Promoted admin — verified against Supabase Auth, then role-checked.
    const base = supabaseUrl.replace(/\/$/, '');
    const authRes = await fetch(`${base}/auth/v1/user`, {
        headers: { apikey: serviceRole, Authorization: `Bearer ${provided}` }
    });
    if (!authRes.ok) {
        return { ok: false, status: 403, error: 'Access denied. Invalid or expired session.' };
    }
    const user = await authRes.json();
    if (!user || !user.id) {
        return { ok: false, status: 403, error: 'Access denied. Invalid or expired session.' };
    }

    const role = await fetchAdminRole(base, serviceRole, user.id);
    if (role !== 'admin') {
        return { ok: false, status: 403, error: 'Access denied. Admin role required.' };
    }

    return { ok: true, actor: { kind: 'admin', userId: user.id }, serviceRole, supabaseUrl };
}

export function serviceHeaders(serviceRole) {
    return {
        'apikey': serviceRole,
        'Authorization': `Bearer ${serviceRole}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
}

async function fetchAdminRole(base, serviceRole, userId) {
    const res = await fetch(`${base}/rest/v1/profiles?select=role&id=eq.${encodeURIComponent(userId)}&limit=1`, {
        headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}`, Accept: 'application/json' }
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows && rows.length ? rows[0].role : null;
}

export function safeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
}