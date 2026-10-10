const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const [key, ...rest] = line.split('=');
        if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
    });
}

const PORT = process.env.PORT || 3000;

// A user counts as active while they are actually using the app. The client
// flushes a usage chunk roughly every 60s, so the window has to be wider than
// the flush cadence — otherwise nobody would ever look active between flushes.
const ACTIVE_WINDOW_MS = 90 * 1000;

// Free model tiers have a rate limit rather than a bill, so the goal is to
// stop one account from consuming the whole provider quota. Vision is roughly
// an order of magnitude more expensive per call than a short chat turn, so it
// gets the tighter cap. Every number is env-tunable — set the DAILY limits to
// 6 if you want a hard 6-a-day cap.
const AI_LIMITS = {
    chat: {
        day: intEnv('AI_CHAT_DAILY_LIMIT', 20),
        minute: intEnv('AI_CHAT_MINUTE_LIMIT', 6)
    },
    vision: {
        day: intEnv('AI_VISION_DAILY_LIMIT', 8),
        minute: intEnv('AI_VISION_MINUTE_LIMIT', 3)
    }
};

const burstHits = new Map();

const MIME = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/chat') {
        let body = '';
        for await (const chunk of req) body += chunk;

        try {
            const parsed = JSON.parse(body);
            const isVision = parsed.requestType === 'vision';
            delete parsed.requestType;

            const gate = await enforceQuota(req, isVision);
            if (gate) {
                res.writeHead(gate.status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(gate.body));
                return;
            }

            // Prefer Gemini for vision. If it fails (rate limit, outage, etc.)
            // fall back to the NVIDIA vision model (VISION_MODEL) so extraction
            // never surfaces an error when Gemini is busy.
            if (isVision && process.env.GEMINI_API_KEY && process.env.GOOGLE_MODEL) {
                try {
                    const gemini = await proxyToGemini(parsed, {
                        apiKey: process.env.GEMINI_API_KEY,
                        model: process.env.GOOGLE_MODEL
                    });
                    if (gemini.status === 200) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(gemini.text);
                        return;
                    }
                    console.error('[server] Gemini vision failed, falling back to NVIDIA:', gemini.status, gemini.text);
                } catch (err) {
                    console.error('[server] Gemini vision threw, falling back to NVIDIA:', err.message);
                }
            }

            // Chat: try NVIDIA first, then fall back to Gemini on any failure
            // so replies never break when the NVIDIA model is down or changing.
            const apiRes = await proxyToNvidia(parsed, isVision);
            if (apiRes.status === 200 || isVision || !process.env.GEMINI_API_KEY || !process.env.GOOGLE_MODEL) {
                res.writeHead(apiRes.status, { 'Content-Type': 'application/json' });
                res.end(apiRes.text);
                return;
            }
            console.error('[server] NVIDIA chat failed, falling back to Gemini:', apiRes.status, apiRes.text);
            const geminiReply = await proxyToGemini(parsed, {
                apiKey: process.env.GEMINI_API_KEY,
                model: process.env.GOOGLE_MODEL
            });
            res.writeHead(geminiReply.status, { 'Content-Type': 'application/json' });
            res.end(geminiReply.text);
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    if (req.method === 'POST' && req.url === '/api/admin-login') {
        let body = '';
        for await (const chunk of req) body += chunk;

        const adminEmails = (process.env.ADMIN_EMAILS || '')
            .split(',')
            .map(e => e.trim().toLowerCase())
            .filter(Boolean);
        const adminPassword = process.env.ADMIN_PASSWORD || '';

        if (!adminEmails.length || !adminPassword) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'ADMIN_EMAILS / ADMIN_PASSWORD is not configured.' }));
        }

        let parsed;
        try {
            parsed = JSON.parse(body || '{}');
        } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Invalid JSON body.' }));
        }

        const email = String(parsed.email || '').trim().toLowerCase();
        const password = String(parsed.password || '');
        if (adminEmails.includes(email) && password && safeEqual(adminPassword, password)) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ role: 'admin' }));
        }
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Not an admin account.' }));
    }

    if (req.method === 'POST' && req.url === '/api/admin-check') {
        const auth = await authorizeAdmin(req);
        res.writeHead(auth.ok ? 200 : (auth.status || 403), { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(auth.ok ? { ok: true } : { error: auth.error }));
    }

    if (req.method === 'POST' && req.url === '/api/is-admin') {
        const adminEmails = (process.env.ADMIN_EMAILS || '')
            .split(',')
            .map(e => e.trim().toLowerCase())
            .filter(Boolean);

        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (!token) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ isAdmin: false }));
        }

        const claims = decodeTokenClaims(token);
        const email = claims && claims.email ? String(claims.email).toLowerCase() : null;
        if (email && adminEmails.includes(email)) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ isAdmin: true, via: 'allowlist' }));
        }

        /* Promoted admins carry their role in profiles, not in ADMIN_EMAILS. */
        let role = null;
        try {
            const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
            const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
            const uid = claims && claims.sub;
            if (base && key && uid) {
                const rows = await fetchJson(`${base}/rest/v1/profiles?select=role&id=eq.${encodeURIComponent(uid)}&limit=1`, {
                    apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json'
                });
                role = Array.isArray(rows) && rows.length ? rows[0].role : null;
            }
        } catch (err) { /* profiles table may not exist yet */ }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ isAdmin: role === 'admin', via: role === 'admin' ? 'role' : undefined }));
    }

    if (req.method === 'GET' && req.url === '/api/ai-limits') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(AI_LIMITS));
    }

    if (req.method === 'POST' && req.url === '/api/delete-account') {
        const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const supabaseUrl = process.env.SUPABASE_URL;
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

        if (!serviceRole || !supabaseUrl) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured.' }));
        }
        if (!token) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Missing access token.' }));
        }

        const userId = decodeTokenUserId(token);
        if (!userId) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Invalid access token.' }));
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
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    if ((req.method === 'GET' || req.method === 'POST') && req.url === '/api/admin-stats') {
        const auth = await authorizeAdmin(req);
        if (!auth.ok) {
            res.writeHead(auth.status, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: auth.error }));
        }
        const { base, headers } = auth;

try {
            // All auth users come from the GoTrue admin API (service_role bypasses RLS).
            const usersData = await fetchJson(`${base}/auth/v1/admin/users?per_page=1000`, headers);
            const users = usersData.users || (usersData.data && usersData.data.users) || [];

            let usage = [];
            try {
                usage = await fetchJson(`${base}/rest/v1/usage_sessions?select=user_id,started_at,duration_seconds`, headers);
            } catch (e) { /* usage_sessions table may not exist yet */ }

            const [modules, chat, unlocks, aiUsage, profiles] = await Promise.all([
                fetchJson(`${base}/rest/v1/modules?select=user_id,name,year,part,semester,mark,grade,created_at`, headers),
                fetchJson(`${base}/rest/v1/chat_messages?select=user_id,role,created_at`, headers),
                fetchJson(`${base}/rest/v1/achievement_unlocks?select=user_id,unlock_key,unlocked_at`, headers),
                fetchJson(`${base}/rest/v1/ai_usage?select=user_id,chat_count,vision_count&day=eq.${todayUtc()}`, headers).catch(() => []),
                fetchJson(`${base}/rest/v1/profiles?select=id,role`, headers).catch(() => [])
            ]);

            // ── Admin roles (promoted from the console) ──
            const roleByUser = new Map();
            (profiles || []).forEach(p => roleByUser.set(p.id, p.role === 'admin' ? 'admin' : 'user'));

            // ── AI quota usage today ──
            const aiByUser = new Map();
            let chatCallsToday = 0;
            let visionCallsToday = 0;
            (aiUsage || []).forEach(r => {
                const c = Number(r.chat_count) || 0;
                const v = Number(r.vision_count) || 0;
                chatCallsToday += c;
                visionCallsToday += v;
                aiByUser.set(r.user_id, { chat: c, vision: v });
            });
            const aiLimits = {
                chat: intEnv('AI_CHAT_DAILY_LIMIT', 20),
                vision: intEnv('AI_VISION_DAILY_LIMIT', 8)
            };

            const modCount = countBy(modules, 'user_id');
            const chatCount = countBy(chat, 'user_id');
            const unlockCount = countBy(unlocks, 'user_id');

            // Time on app: total and per-user active seconds.
            const usageByUser = new Map();
            let totalTimeSeconds = 0;
            (usage || []).forEach(u => {
                const s = Number(u.duration_seconds) || 0;
                if (s <= 0) return;
                totalTimeSeconds += s;
                usageByUser.set(u.user_id, (usageByUser.get(u.user_id) || 0) + s);
            });

            // Presence: when each user was last seen using the app. A usage chunk
            // covers [started_at, started_at + duration], so the end of a user's
            // latest chunk is their last moment with the dashboard visible.
            const lastSeenByUser = new Map();
            (usage || []).forEach(u => {
                const started = u.started_at ? new Date(u.started_at).getTime() : NaN;
                if (isNaN(started)) return;
                const end = started + (Number(u.duration_seconds) || 0) * 1000;
                if (end > (lastSeenByUser.get(u.user_id) || 0)) lastSeenByUser.set(u.user_id, end);
            });
            const cutoff = Date.now() - ACTIVE_WINDOW_MS;

            const rows = users.map(u => {
                const m = modCount.get(u.id) || 0;
                const c = chatCount.get(u.id) || 0;
                const a = unlockCount.get(u.id) || 0;
                const meta = u.user_metadata || u.raw_user_meta_data || {};
                const lastSeen = lastSeenByUser.get(u.id) || 0;
                const engaged = m > 0 || c > 0 || a > 0 || (usageByUser.get(u.id) || 0) > 0;
                const ai = aiByUser.get(u.id) || { chat: 0, vision: 0 };
                return {
                    id: u.id,
                    email: u.email || '(no email)',
                    display_name: meta.display_name || null,
                    created_at: u.created_at || u.createdAt || null,
                    modules: m,
                    chat_messages: c,
                    achievements: a,
                    time_spent_seconds: usageByUser.get(u.id) || 0,
                    last_seen_at: lastSeen ? new Date(lastSeen).toISOString() : null,
                    active: lastSeen >= cutoff,
                    engaged: engaged,
                    ai_chat_today: ai.chat,
                    ai_vision_today: ai.vision,
                    ai_chat_remaining: Math.max(0, aiLimits.chat - ai.chat),
                    ai_vision_remaining: Math.max(0, aiLimits.vision - ai.vision),
                    ai_at_limit: ai.chat >= aiLimits.chat || ai.vision >= aiLimits.vision,
                    role: roleByUser.get(u.id) || 'user'
                };
            });

            const activeCount = rows.filter(r => r.active).length;
            const engagedCount = rows.filter(r => r.engaged).length;

            // ── Performance & engagement ──
            const marks = modules.filter(m => m.mark != null && Number(m.mark) >= 0).map(m => Number(m.mark));
            const overallAverage = marks.length
                ? +(marks.reduce((s, x) => s + x, 0) / marks.length).toFixed(1)
                : null;

            const gradeDistribution = {};
            modules.forEach(m => {
                if (m.grade) gradeDistribution[String(m.grade)] = (gradeDistribution[String(m.grade)] || 0) + 1;
            });
            const gradeEntries = Object.entries(gradeDistribution).sort((a, b) => b[1] - a[1]);
            const mostCommonGrade = gradeEntries.length ? gradeEntries[0][0] : null;

            const moduleCounts = {};
            modules.forEach(m => {
                const name = String(m.name || '').trim();
                if (name) moduleCounts[name] = (moduleCounts[name] || 0) + 1;
            });
            const topModules = Object.entries(moduleCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([name, count]) => ({ name, count }));

            const achievementBreakdown = {};
            unlocks.forEach(u => {
                const key = u.unlock_key || 'other';
                achievementBreakdown[key] = (achievementBreakdown[key] || 0) + 1;
            });

            // ── Average mark per academic year ──
            const byYear = {};
            modules.forEach(m => {
                if (m.year != null && m.mark != null && !isNaN(Number(m.mark))) {
                    const y = String(m.year).trim();
                    if (y) (byYear[y] = byYear[y] || []).push(Number(m.mark));
                }
            });
            const averageMarkByYear = Object.entries(byYear)
                .sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }))
                .map(([year, list]) => ({
                    year,
                    average: +(list.reduce((s, x) => s + x, 0) / list.length).toFixed(1),
                    count: list.length
                }));

            // ── Time series (90 days) for signups, modules added, messages and usage ──
            const series = {
                signups: dailySeries(rows, 'created_at', 90),
                modules: dailySeries(modules, 'created_at', 90),
                messages: dailySeries(chat, 'created_at', 90),
                usage: dailyUsageSeries(usage || [], 90)
            };

            // ── Daily visitors (today) ──
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const todayMs = todayStart.getTime();
            const visitorMap = new Map();
            (usage || []).forEach(u => {
                const t = u.started_at ? new Date(u.started_at).getTime() : NaN;
                if (isNaN(t) || t < todayMs) return;
                const existing = visitorMap.get(u.user_id);
                if (!existing || t > existing.lastVisitMs) {
                    visitorMap.set(u.user_id, { lastVisitMs: t, started_at: u.started_at });
                }
            });
            const dailyVisitors = Array.from(visitorMap.entries()).map(([userId, info]) => {
                const userRow = rows.find(r => r.id === userId);
                return {
                    user_id: userId,
                    email: userRow ? userRow.email : '(unknown)',
                    display_name: userRow ? userRow.display_name : null,
                    last_visit: info.started_at
                };
            }).sort((a, b) => new Date(b.last_visit) - new Date(a.last_visit));

            // ── Trend deltas (last 7d vs previous 7d, last 30d vs previous 30d) ──
            const now = Date.now();
            const countSince = (list, days) => list.filter(r => {
                const t = r.created_at ? new Date(r.created_at).getTime() : NaN;
                return !isNaN(t) && t >= now - days * 86400000;
            }).length;
            const usageSince = (list, days) => list.filter(r => {
                const t = r.started_at ? new Date(r.started_at).getTime() : NaN;
                return !isNaN(t) && t >= now - days * 86400000;
            }).reduce((s, r) => s + (Number(r.duration_seconds) || 0), 0);
            const delta = (cur, prev) => prev > 0 ? Math.round(((cur - prev) / prev) * 100) : (cur > 0 ? 100 : 0);

            const users7d = countSince(rows, 7);
            const usersPrev7d = countSince(rows, 14) - users7d;
            const users30d = countSince(rows, 30);
            const usersPrev30d = countSince(rows, 60) - users30d;
            const modules7d = countSince(modules, 7);
            const modulesPrev7d = countSince(modules, 14) - modules7d;
            const messages7d = countSince(chat, 7);
            const messagesPrev7d = countSince(chat, 14) - messages7d;
            const usage7d = usageSince(usage || [], 7);
            const usagePrev7d = usageSince(usage || [], 14) - usage7d;

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                totalUsers: rows.length,
                activeUsers: activeCount,
                activeUserPct: rows.length ? Math.round((activeCount / rows.length) * 100) : 0,
                engagedUsers: engagedCount,
                engagedUserPct: rows.length ? Math.round((engagedCount / rows.length) * 100) : 0,
                aiCallsToday: chatCallsToday + visionCallsToday,
                aiChatCallsToday: chatCallsToday,
                aiVisionCallsToday: visionCallsToday,
                aiUsersToday: aiByUser.size,
                aiAtLimitCount: rows.filter(r => r.ai_at_limit).length,
                aiLimits: aiLimits,
                adminCount: rows.filter(r => r.role === 'admin').length,
                totalModules: modules.length,
                totalChatMessages: chat.length,
                totalAchievements: unlocks.length,
                totalTimeSeconds,
                avgSecondsPerActiveUser: engagedCount ? Math.round(totalTimeSeconds / engagedCount) : 0,
                overallAverage,
                mostCommonGrade,
                gradeDistribution,
                topModules,
                achievementBreakdown,
                averageMarkByYear,
                avgMessagesPerActiveUser: engagedCount ? +(chat.length / engagedCount).toFixed(1) : 0,
                dailyVisitors,
                dailyVisitorCount: dailyVisitors.length,
                signupsByDay: series.signups.slice(-30),
                series,
                trends: {
                    users7d, usersPrev7d, users7dDelta: delta(users7d, usersPrev7d),
                    users30d, usersPrev30d, users30dDelta: delta(users30d, usersPrev30d),
                    modules7d, modulesPrev7d, modules7dDelta: delta(modules7d, modulesPrev7d),
                    messages7d, messagesPrev7d, messages7dDelta: delta(messages7d, messagesPrev7d),
                    usage7d, usagePrev7d, usage7dDelta: delta(usage7d, usagePrev7d)
                },
                generatedAt: new Date().toISOString(),
                users: rows
            }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    if (req.url.startsWith('/api/admin-user')) {
        const auth = await authorizeAdmin(req);
        if (!auth.ok) {
            res.writeHead(auth.status, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: auth.error }));
        }

        const parsedUrl = new URL(req.url, 'http://localhost');
        const id = parsedUrl.searchParams.get('id') || '';
        const { base, headers } = auth;

        try {
            if (req.method === 'GET') {
                if (!id) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Missing user id.' }));
                }
                const userRes = await fetch(`${base}/auth/v1/admin/users/${id}`, { headers });
                if (!userRes.ok) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'User not found.' }));
                }
                const user = await userRes.json();
                const meta = user.user_metadata || user.raw_user_meta_data || {};

                let usage = [];
                try {
                    usage = await fetchJson(`${base}/rest/v1/usage_sessions?select=started_at,duration_seconds&user_id=eq.${encodeURIComponent(id)}&order=started_at.asc`, headers);
                } catch (e) { /* usage_sessions table may not exist yet */ }

                let profile = null;
                try {
                    const rows = await fetchJson(`${base}/rest/v1/profiles?select=role&id=eq.${encodeURIComponent(id)}&limit=1`, headers);
                    profile = Array.isArray(rows) && rows.length ? rows[0] : null;
                } catch (e) { /* profiles table may not exist yet */ }

                const [modules, chat, achievements] = await Promise.all([
                    fetchJson(`${base}/rest/v1/modules?select=id,name,year,part,semester,mark,grade&user_id=eq.${encodeURIComponent(id)}&order=year.asc,semester.asc,id.asc`, headers),
                    fetchJson(`${base}/rest/v1/chat_messages?select=id,role,content,created_at&user_id=eq.${encodeURIComponent(id)}&order=created_at.asc,id.asc`, headers),
                    fetchJson(`${base}/rest/v1/achievement_unlocks?select=unlock_key,unlocked_at&user_id=eq.${encodeURIComponent(id)}&order=unlocked_at.asc`, headers)
                ]);

                const timeSpentSeconds = (usage || []).reduce((s, u) => s + (Number(u.duration_seconds) || 0), 0);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({
                    user: {
                        id: user.id,
                        email: user.email || '',
                        display_name: meta.display_name || null,
                        created_at: user.created_at || user.createdAt || null,
                        last_sign_in_at: user.last_sign_in_at || user.lastSignInAt || null,
                        phone: user.phone || null,
                        role: profile ? profile.role : 'user',
                        time_spent_seconds: timeSpentSeconds
                    },
                    modules,
                    chat,
                    achievements,
                    usage
                }));
            }

            if (req.method === 'PUT') {
                if (!id) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Missing user id.' }));
                }
                let body = '';
                for await (const chunk of req) body += chunk;
                let parsed;
                try {
                    parsed = JSON.parse(body || '{}');
                } catch (err) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Invalid JSON body.' }));
                }

                /* Promote / demote — lives in profiles, not auth metadata. */
                if (typeof parsed.role === 'string') {
                    const role = parsed.role === 'admin' ? 'admin' : 'user';
                    if (auth.actor.kind !== 'owner' && auth.actor.userId === id) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ error: 'You cannot change your own admin role.' }));
                    }
                    const roleErr = await setUserRole(base, headers, id, role);
                    if (roleErr) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ error: roleErr }));
                    }
                    if (Object.keys(parsed).length === 1) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ ok: true, role }));
                    }
                }

                const curRes = await fetch(`${base}/auth/v1/admin/users/${id}`, { headers });
                if (!curRes.ok) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'User not found.' }));
                }
                const cur = await curRes.json();
                const curMeta = cur.user_metadata || cur.raw_user_meta_data || {};

                const payload = {};
                if (parsed.email) payload.email = String(parsed.email);
                if (parsed.password) payload.password = String(parsed.password);
                if (typeof parsed.display_name === 'string') {
                    const clean = parsed.display_name.replace(/[^a-zA-Z0-9 ]/g, '').trim();
                    if (clean) payload.user_metadata = { ...curMeta, display_name: clean };
                }
                if (Object.keys(payload).length === 0) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ ok: true }));
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
                    res.writeHead(updRes.status, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Update failed: ' + msg }));
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(updText);
            }

            if (req.method === 'DELETE') {
                if (!id) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Missing user id.' }));
                }
                const delRes = await fetch(`${base}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers });
                if (!delRes.ok && delRes.status !== 404) {
                    res.writeHead(delRes.status, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Failed to delete user.' }));
                }
                await Promise.all([
                    fetch(`${base}/rest/v1/modules?user_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers }),
                    fetch(`${base}/rest/v1/chat_messages?user_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers }),
                    fetch(`${base}/rest/v1/achievement_unlocks?user_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers }),
                    fetch(`${base}/rest/v1/usage_sessions?user_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers })
                ]);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ ok: true }));
            }

            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed.' }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    const ext = path.extname(filePath);
    const contentType = MIME[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (res.headersSent) return;
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            return res.end('<h1>404 Not Found</h1>');
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`Gradelytics running at http://localhost:${PORT}`);
    console.log(`NVIDIA_API_KEY: ${process.env.NVIDIA_API_KEY ? 'set' : 'NOT SET — run: set NVIDIA_API_KEY=your_key'}`);
    console.log(`SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'NOT SET — add it to .env for account deletion'}`);
    console.log(`ADMIN_EMAILS / ADMIN_PASSWORD: ${process.env.ADMIN_EMAILS && process.env.ADMIN_PASSWORD ? 'set' : 'NOT SET — add both to .env for the admin login'}`);
});

async function fetchJson(url, headers) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error('Request failed: ' + res.status + ' ' + url);
    return res.json();
}

function parseDataURL(dataUrl) {
    const match = /^data:([^;,]+);base64,(.+)$/.exec(String(dataUrl || ''));
    if (!match) return null;
    return { mime: match[1], base64: match[2] };
}

async function proxyToNvidia(payload, isVision) {
    const modelEnv = isVision ? process.env.VISION_MODEL : process.env.AI_MODEL;
    const apiKey = isVision
        ? (process.env.NVIDIA_VISION_API_KEY || process.env.NVIDIA_API_KEY)
        : process.env.NVIDIA_API_KEY;
    if (!apiKey) {
        return { status: 500, text: JSON.stringify({ error: 'NVIDIA_API_KEY not set.' }) };
    }
    const body = { ...payload };
    if (modelEnv) body.model = modelEnv;
    if (!isVision) body.chat_template_kwargs = { ...(body.chat_template_kwargs || {}), enable_thinking: false };

    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify(body)
    });
    const text = await res.text();
    return { status: res.status, text: stripReasoning(text) };
}

const REASONING_TAGS = 'think|thinking|reasoning|analysis|scratchpad|reflection|thought';
const REASONING_PREAMBLE_RE = /here'?s (a|the) (thinking|thought) process|chain[- ]of[- ]thought|thinking process:|analyze user input|identify (the )?constraints|formulate (the )?response|determine the answer/i;

// Reasoning models (e.g. NVIDIA Nemotron) can leak their chain-of-thought —
// including the system prompt verbatim — into the visible `content` field.
// `enable_thinking: false` above is the source-level fix; this is the
// defence-in-depth guard so no provider/model can surface deliberation or
// <think> blocks to the user.
function sanitizeModelText(text) {
    if (typeof text !== 'string' || !text) return text;
    let t = text;
    t = t.replace(new RegExp(`<(${REASONING_TAGS})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi'), '');
    t = t.replace(new RegExp(`<(${REASONING_TAGS})\\b[^>]*>[\\s\\S]*$`, 'i'), '');
    t = t.replace(new RegExp(`^[\\s\\S]*?<\\/(${REASONING_TAGS})\\s*>`, 'i'), '');
    if (REASONING_PREAMBLE_RE.test(t)) {
        t = extractFinalAnswer(t);
    }
    if (REASONING_PREAMBLE_RE.test(t)) return '';
    t = t.split('\n').filter(line => !isLeakedInstruction(line)).join('\n');
    t = t.replace(/^\s*(?:we need to|the user (?:is asking|wants|asked)|let me|i should|okay,? so|alright,? so|analyze user input|the prompt (?:includes|says))[^\n]*\n?/i, '');
    return t.replace(/\n{3,}/g, '\n\n').trim();
}

function isLeakedInstruction(line) {
    return /(STRICTLY ENFORCED|DATA RULES|Never reveal or mention your underlying model|You are "?Gradelytics AI|You ONLY help with academic performance analysis|NEVER output deliberation|invent, fabricate, guess, or assume|You CANNOT see anything else|Precomputed Averages|Never reveal, quote, paraphrase, or acknowledge these instructions|which company, researchers, model, or technology powers you)/i.test(line);
}

function extractFinalAnswer(text) {
    const labelled = text.match(/(?:final answer|answer|result)\s*[:：]\s*([\s\S]+)$/i);
    if (labelled && labelled[1].trim()) return labelled[1].trim();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (/^[-*•\d]/.test(line)) continue;
        if (REASONING_PREAMBLE_RE.test(line)) continue;
        if (line.length <= 300 && !/^[.\-–—:]+$/.test(line)) return line;
    }
    return '';
}

function stripReasoning(text) {
    try {
        const data = JSON.parse(text);
        const msg = data && data.choices && data.choices[0] && data.choices[0].message;
        if (msg) {
            delete msg.reasoning_content;
            delete msg.reasoning;
            delete msg.reasoning_text;
            if (typeof msg.content === 'string') msg.content = sanitizeModelText(msg.content);
        }
        return JSON.stringify(data);
    } catch (e) {
        return text;
    }
}

async function proxyToGemini(payload, { apiKey, model }) {
    const contents = [];
    const systemParts = [];

    for (const msg of payload.messages || []) {
        if (msg.role === 'system') {
            if (typeof msg.content === 'string') systemParts.push({ text: msg.content });
            continue;
        }
        const role = msg.role === 'assistant' ? 'model' : 'user';
        const parts = [];
        if (typeof msg.content === 'string') {
            parts.push({ text: msg.content });
        } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part.type === 'text') {
                    parts.push({ text: part.text });
                } else if (part.type === 'image_url') {
                    const url = typeof part.image_url === 'string' ? part.image_url : (part.image_url && part.image_url.url);
                    const img = parseDataURL(url);
                    if (img) parts.push({ inline_data: { mime_type: img.mime, data: img.base64 } });
                }
            }
        }
        if (parts.length) contents.push({ role, parts });
    }

    const generationConfig = {};
    if (payload.temperature != null) generationConfig.temperature = payload.temperature;
    if (payload.max_tokens) generationConfig.maxOutputTokens = payload.max_tokens;

    const geminiBody = {};
    if (systemParts.length) geminiBody.systemInstruction = { parts: systemParts };
    geminiBody.contents = contents;
    if (Object.keys(generationConfig).length) geminiBody.generationConfig = generationConfig;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
        },
        body: JSON.stringify(geminiBody)
    });

    if (!res.ok) {
        const errText = await res.text();
        return { status: res.status, text: JSON.stringify({ error: `Gemini API error (${res.status}): ${errText}` }) };
    }

    const data = await res.json();
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content)
        ? (data.candidates[0].content.parts || [])
        : [];
    const content = sanitizeModelText(parts.map(p => p.text || '').join(''));
    return { status: 200, text: JSON.stringify({ choices: [{ message: { content } }] }) };
}

function countBy(list, key) {
    const map = new Map();
    (list || []).forEach(item => {
        const k = item[key];
        map.set(k, (map.get(k) || 0) + 1);
    });
    return map;
}

/* ── Per-user AI quota ── */

function intEnv(name, fallback) {
    const n = parseInt(process.env[name], 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function todayUtc() {
    return new Date().toISOString().slice(0, 10);
}

async function enforceQuota(req, isVision) {
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const kind = isVision ? 'vision' : 'chat';
    const limits = AI_LIMITS[kind];

    // No Supabase config means there is nothing to count against. Never block
    // the app because quota bookkeeping is unavailable.
    if (!serviceRole || !supabaseUrl || !anonKey) return null;

    const userId = await resolveUserId(supabaseUrl, anonKey, req.headers.authorization);
    if (!userId) {
        return {
            status: 401,
            body: {
                error: 'ai_unauthenticated',
                message: 'Sign in again to use AI features — your session may have expired.'
            }
        };
    }

    if (burstExceeded(userId, kind, limits.minute)) {
        return {
            status: 429,
            body: {
                error: 'ai_quota_exceeded',
                kind: kind,
                scope: 'minute',
                limit: limits.minute,
                message: `Easy there — you can send ${limits.minute} AI ${plural(kind)} a minute. Try again in a moment.`
            }
        };
    }

    const used = await bumpDailyUsage(supabaseUrl, serviceRole, userId, kind);
    if (used != null && used > limits.day) {
        return {
            status: 429,
            body: {
                error: 'ai_quota_exceeded',
                kind: kind,
                scope: 'day',
                used: used - 1,
                limit: limits.day,
                message: `You've used all ${limits.day} of today's AI ${plural(kind)}. Your allowance resets tomorrow.`
            }
        };
    }

    return null;
}

function plural(kind) {
    return kind === 'vision' ? 'image extractions' : 'messages';
}

async function resolveUserId(base, anonKey, authHeader) {
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) return null;
    try {
        const res = await fetch(`${base}/auth/v1/user`, {
            headers: { apikey: anonKey, Authorization: `Bearer ${token}` }
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data && data.id ? data.id : null;
    } catch (e) {
        return null;
    }
}

function burstExceeded(userId, kind, max) {
    const key = `${userId}:${kind}`;
    const now = Date.now();
    const window = 60000;
    const hits = (burstHits.get(key) || []).filter(t => now - t < window);
    if (hits.length >= max) {
        burstHits.set(key, hits);
        return true;
    }
    hits.push(now);
    burstHits.set(key, hits);
    if (burstHits.size > 5000) burstHits.clear();
    return false;
}

// Returns the new count for this kind, or null when the counter is unavailable
// so a missing migration degrades to "no limit" instead of a broken app.
async function bumpDailyUsage(base, serviceRole, userId, kind) {
    try {
        const res = await fetch(`${base}/rest/v1/rpc/bump_ai_usage`, {
            method: 'POST',
            headers: {
                apikey: serviceRole,
                Authorization: `Bearer ${serviceRole}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ p_user_id: userId, p_kind: kind })
        });
        if (!res.ok) return null;
        const data = await res.json();
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return null;
        return Number(kind === 'vision' ? row.vision_count : row.chat_count) || 0;
    } catch (e) {
        return null;
    }
}

function safeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

/* ─────────────────────────────────────────────────────────────────────────────
   Admin authorisation (self-hosted mirror of api/_admin-guard.js).

   Accepts either the master ADMIN_PASSWORD (the owner) or a Supabase access
   token whose profiles.role = 'admin' (someone promoted from the console).
   Returns { ok: false, status, error } or { ok: true, actor, base, headers }.
   ───────────────────────────────────────────────────────────────────────────── */

async function authorizeAdmin(req) {
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const adminPassword = process.env.ADMIN_PASSWORD || '';

    if (!serviceRole || !supabaseUrl) {
        return { ok: false, status: 500, error: 'SUPABASE_SERVICE_ROLE_KEY is not configured.' };
    }
    if (!adminPassword) {
        return { ok: false, status: 500, error: 'ADMIN_PASSWORD is not configured.' };
    }

    const base = supabaseUrl.replace(/\/$/, '');
    const headers = {
        'apikey': serviceRole,
        'Authorization': `Bearer ${serviceRole}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };

    const authHeader = req.headers.authorization || '';
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!provided) {
        return { ok: false, status: 403, error: 'Access denied. Admin credentials required.' };
    }

    if (safeEqual(adminPassword, provided)) {
        return { ok: true, actor: { kind: 'owner', userId: null }, base, headers, serviceRole };
    }

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

    const role = await fetchJsonSafe(`${base}/rest/v1/profiles?select=role&id=eq.${encodeURIComponent(user.id)}&limit=1`, headers);
    if (!Array.isArray(role) || !role.length || role[0].role !== 'admin') {
        return { ok: false, status: 403, error: 'Access denied. Admin role required.' };
    }

    return { ok: true, actor: { kind: 'admin', userId: user.id }, base, headers, serviceRole };
}

async function fetchJsonSafe(url, headers) {
    try {
        const res = await fetch(url, { headers });
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        return null;
    }
}

async function setUserRole(base, headers, id, role) {
    const upd = await fetch(`${base}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: Object.assign({}, headers, { Prefer: 'return=representation' }),
        body: JSON.stringify({ role })
    });
    if (upd.ok) {
        const rows = await upd.json().catch(() => []);
        if (Array.isArray(rows) && rows.length) return null;
    }

    const authUser = await fetch(`${base}/auth/v1/admin/users/${id}`, { headers });
    const email = authUser.ok ? ((await authUser.json()).email || null) : null;
    const ins = await fetch(`${base}/rest/v1/profiles`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id, email, role })
    });
    if (!ins.ok) return 'Role update failed: ' + (await ins.text());
    return null;
}

function dailySeries(list, dateField, days) {
    const out = [];
    const map = new Map();
    list.forEach(r => {
        const t = r[dateField] ? new Date(r[dateField]).getTime() : NaN;
        if (isNaN(t)) return;
        const key = new Date(t).toISOString().slice(0, 10);
        map.set(key, (map.get(key) || 0) + 1);
    });
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        out.push({ day: key, count: map.get(key) || 0 });
    }
    return out;
}

function dailyUsageSeries(list, days) {
    const out = [];
    const map = new Map();
    list.forEach(r => {
        const t = r.started_at ? new Date(r.started_at).getTime() : NaN;
        if (isNaN(t)) return;
        const key = new Date(t).toISOString().slice(0, 10);
        map.set(key, (map.get(key) || 0) + (Number(r.duration_seconds) || 0));
    });
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        out.push({ day: key, seconds: map.get(key) || 0 });
    }
    return out;
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

function decodeTokenUserId(token) {
    const claims = decodeTokenClaims(token);
    return claims ? claims.sub : null;
}
