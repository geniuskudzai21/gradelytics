import { timingSafeEqual } from 'crypto';

export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const adminPassword = process.env.ADMIN_PASSWORD || '';

    if (!serviceRole || !supabaseUrl) {
        return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured.' });
    }
    if (!adminPassword) {
        return res.status(500).json({ error: 'ADMIN_PASSWORD is not configured.' });
    }

    const authHeader = req.headers.authorization || '';
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!provided || !safeEqual(adminPassword, provided)) {
        return res.status(403).json({ error: 'Access denied. Invalid admin password.' });
    }

    try {
        const base = supabaseUrl.replace(/\/$/, '');
        const headers = {
            'apikey': serviceRole,
            'Authorization': `Bearer ${serviceRole}`,
            'Accept': 'application/json'
        };

        // All auth users come from the GoTrue admin API (service_role bypasses RLS).
        const usersRes = await fetch(`${base}/auth/v1/admin/users?per_page=1000`, { headers });
        if (!usersRes.ok) throw new Error('Failed to list users: ' + usersRes.status);
        const usersData = await usersRes.json();
        const users = usersData.users || (usersData.data && usersData.data.users) || [];

        const [modules, chat, unlocks] = await Promise.all([
            fetchRows(`${base}/rest/v1/modules?select=user_id,name,year,part,semester,mark,grade,created_at`, headers),
            fetchRows(`${base}/rest/v1/chat_messages?select=user_id,role,created_at`, headers),
            fetchRows(`${base}/rest/v1/achievement_unlocks?select=user_id,unlock_key,unlocked_at`, headers)
        ]);

        const modCount = countBy(modules, 'user_id');
        const chatCount = countBy(chat, 'user_id');
        const unlockCount = countBy(unlocks, 'user_id');

        const rows = users.map(u => {
            const m = modCount.get(u.id) || 0;
            const c = chatCount.get(u.id) || 0;
            const a = unlockCount.get(u.id) || 0;
            const meta = u.user_metadata || u.raw_user_meta_data || {};
            return {
                id: u.id,
                email: u.email || '(no email)',
                display_name: meta.display_name || null,
                created_at: u.created_at || u.createdAt || null,
                modules: m,
                chat_messages: c,
                achievements: a,
                active: m > 0 || c > 0 || a > 0
            };
        });

        const activeCount = rows.filter(r => r.active).length;

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

        // ── Time series (90 days) for signups, modules added and messages ──
        const series = {
            signups: dailySeries(rows, 'created_at', 90),
            modules: dailySeries(modules, 'created_at', 90),
            messages: dailySeries(chat, 'created_at', 90)
        };

        // ── Trend deltas (last 7d vs previous 7d, last 30d vs previous 30d) ──
        const now = Date.now();
        const countSince = (list, days) => list.filter(r => {
            const t = r.created_at ? new Date(r.created_at).getTime() : NaN;
            return !isNaN(t) && t >= now - days * 86400000;
        }).length;
        const delta = (cur, prev) => prev > 0 ? Math.round(((cur - prev) / prev) * 100) : (cur > 0 ? 100 : 0);

        const users7d = countSince(rows, 7);
        const usersPrev7d = countSince(rows, 14) - users7d;
        const users30d = countSince(rows, 30);
        const usersPrev30d = countSince(rows, 60) - users30d;
        const modules7d = countSince(modules, 7);
        const modulesPrev7d = countSince(modules, 14) - modules7d;
        const messages7d = countSince(chat, 7);
        const messagesPrev7d = countSince(chat, 14) - messages7d;

        res.status(200).json({
            totalUsers: rows.length,
            activeUsers: activeCount,
            activeUserPct: rows.length ? Math.round((activeCount / rows.length) * 100) : 0,
            totalModules: modules.length,
            totalChatMessages: chat.length,
            totalAchievements: unlocks.length,
            overallAverage,
            mostCommonGrade,
            gradeDistribution,
            topModules,
            achievementBreakdown,
            averageMarkByYear,
            avgMessagesPerActiveUser: activeCount ? +(chat.length / activeCount).toFixed(1) : 0,
            signupsByDay: series.signups.slice(-30),
            series,
            trends: {
                users7d, usersPrev7d, users7dDelta: delta(users7d, usersPrev7d),
                users30d, usersPrev30d, users30dDelta: delta(users30d, usersPrev30d),
                modules7d, modulesPrev7d, modules7dDelta: delta(modules7d, modulesPrev7d),
                messages7d, messagesPrev7d, messages7dDelta: delta(messages7d, messagesPrev7d)
            },
            generatedAt: new Date().toISOString(),
            users: rows
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
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

async function fetchRows(url, headers) {
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    return res.json();
}

function countBy(list, key) {
    const map = new Map();
    (list || []).forEach(item => {
        const k = item[key];
        map.set(k, (map.get(k) || 0) + 1);
    });
    return map;
}

function safeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
}
