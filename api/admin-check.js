import { authorizeAdmin } from './_admin-guard.js';

/* Lightweight admin gate for the admin console. The browser calls this once
   before rendering admin.html; anything other than a valid master password or
   a promoted-admin access token gets rejected here, so the console never
   renders for ordinary signed-in users or guests. */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    const auth = await authorizeAdmin(req);
    if (!auth.ok) {
        return res.status(auth.status || 403).json({ error: auth.error });
    }
    return res.status(200).json({ ok: true });
}
