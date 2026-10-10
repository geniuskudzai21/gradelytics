import { getAiLimits } from './_ai-limits.js';

/* Public: the per-day / per-minute AI allowance, so the client can tell the
   user what they have without hardcoding numbers that drift from the server. */
export default function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    res.status(200).json(getAiLimits());
}
