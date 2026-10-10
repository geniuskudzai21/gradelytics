import { authorizeAdmin, serviceHeaders, getAdminEmails } from './_admin-guard.js';

// A user counts as active while they are actually using the app. The client
// flushes a usage chunk roughly every 60s, so the window has to be wider than
// the flush cadence — otherwise nobody would ever look active between flushes.
const ACTIVE_WINDOW_MS = 90 * 1000;

export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const auth = await authorizeAdmin(req);
    if (!auth.ok) {
        return res.status(auth.status).json({ error: auth.error });
    }

    try {
        const base = auth.supabaseUrl.replace(/\/$/, '');
        const headers = serviceHeaders(auth.serviceRole);

        // All auth users come from the GoTrue admin API (service_role bypasses RLS).
        const usersRes = await fetch(`${base}/auth/v1/admin/users?per_page=1000`, { headers });
        if (!usersRes.ok) throw new Error('Failed to list users: ' + usersRes.status);
        const usersData = await usersRes.json();
        const users = usersData.users || (usersData.data && usersData.data.users) || [];

        const [modules, chat, unlocks, usage, aiUsage, profiles] = await Promise.all([
            fetchRows(`${base}/rest/v1/modules?select=user_id,name,year,part,semester,mark,grade,created_at`, headers),
            fetchRows(`${base}/rest/v1/chat_messages?select=user_id,role,created_at`, headers),
            fetchRows(`${base}/rest/v1/achievement_unlocks?select=user_id,unlock_key,unlocked_at`, headers),
            fetchRows(`${base}/rest/v1/usage_sessions?select=user_id,started_at,duration_seconds`, headers),
            fetchRows(`${base}/rest/v1/ai_usage?select=user_id,chat_count,vision_count&day=eq.${todayUtc()}`, headers),
            fetchRows(`${base}/rest/v1/profiles?select=id,role`, headers)
        ]);

        // ── Admin roles ──
        // Two sources of truth: the ADMIN_EMAILS env allowlist (the owner) and
        // profiles.role = 'admin' (promoted from this console). Either marks the
        // account as an admin so the dashboard can treat it specially.
        const adminEmails = getAdminEmails();
        const roleByUser = new Map();
        (profiles || []).forEach(p => roleByUser.set(p.id, p.role === 'admin' ? 'admin' : 'user'));

        // ── AI quota usage today ──
        const aiByUser = new Map();
        (aiUsage || []).forEach(r => {
            aiByUser.set(r.user_id, {
                chat: Number(r.chat_count) || 0,
                vision: Number(r.vision_count) || 0
            });
        });
        const aiLimits = {
            chat: intEnv('AI_CHAT_DAILY_LIMIT', 10),
            vision: intEnv('AI_VISION_DAILY_LIMIT', 8)
        };

        const modCount = countBy(modules, 'user_id');
        const chatCount = countBy(chat, 'user_id');
        const unlockCount = countBy(unlocks, 'user_id');

        // Time on app: per-user active seconds (all accounts, for the row
        // detail). The platform total is computed below from real users only.
        const usageByUser = new Map();
        (usage || []).forEach(u => {
            const s = Number(u.duration_seconds) || 0;
            if (s <= 0) return;
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
            const isOwner = adminEmails.includes((u.email || '').toLowerCase());
            const role = isOwner || roleByUser.get(u.id) === 'admin' ? 'admin' : 'user';
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
                is_owner: isOwner,
                role: role
            };
        });

        // Admins (the owner plus promoted admins) are not students, so keep them
        // out of every aggregate — user totals, active counts, signup trends and
        // all content metrics describe real users only. Admins still appear in
        // the users list itself.
        const adminIds = new Set(rows.filter(r => r.role === 'admin').map(r => r.id));
        const memberRows = rows.filter(r => r.role !== 'admin');

        // Content rows belonging to real users only.
        const memberModules = modules.filter(m => !adminIds.has(m.user_id));
        const memberChat = chat.filter(c => !adminIds.has(c.user_id));
        const memberUnlocks = unlocks.filter(u => !adminIds.has(u.user_id));
        const memberUsage = (usage || []).filter(u => !adminIds.has(u.user_id));

        // AI totals exclude admin activity; per-user data stays for the rows.
        const memberAi = new Map();
        let chatCallsToday = 0;
        let visionCallsToday = 0;
        aiByUser.forEach((v, uid) => {
            if (adminIds.has(uid)) return;
            memberAi.set(uid, v);
            chatCallsToday += v.chat;
            visionCallsToday += v.vision;
        });

        const totalTimeSeconds = memberUsage.reduce((s, u) => s + (Number(u.duration_seconds) || 0), 0);

        const activeCount = memberRows.filter(r => r.active).length;
        const engagedCount = memberRows.filter(r => r.engaged).length;

        // ── Performance & engagement ──
        const marks = memberModules.filter(m => m.mark != null && Number(m.mark) >= 0).map(m => Number(m.mark));
        const overallAverage = marks.length
            ? +(marks.reduce((s, x) => s + x, 0) / marks.length).toFixed(1)
            : null;

        const gradeDistribution = {};
        memberModules.forEach(m => {
            if (m.grade) gradeDistribution[String(m.grade)] = (gradeDistribution[String(m.grade)] || 0) + 1;
        });
        const gradeEntries = Object.entries(gradeDistribution).sort((a, b) => b[1] - a[1]);
        const mostCommonGrade = gradeEntries.length ? gradeEntries[0][0] : null;

        const moduleCounts = {};
        memberModules.forEach(m => {
            const name = String(m.name || '').trim();
            if (name) moduleCounts[name] = (moduleCounts[name] || 0) + 1;
        });
        const topModules = Object.entries(moduleCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([name, count]) => ({ name, count }));

        const achievementBreakdown = {};
        memberUnlocks.forEach(u => {
            const key = u.unlock_key || 'other';
            achievementBreakdown[key] = (achievementBreakdown[key] || 0) + 1;
        });

        // ── Average mark per academic year ──
        const byYear = {};
        memberModules.forEach(m => {
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

        // ── Time series (90 days) for signups, modules added, messages, usage ──
        const series = {
            signups: dailySeries(memberRows, 'created_at', 90),
            modules: dailySeries(memberModules, 'created_at', 90),
            messages: dailySeries(memberChat, 'created_at', 90),
            usage: dailyUsageSeries(memberUsage, 90)
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
        const dailyVisitors = Array.from(visitorMap.entries())
            .filter(([userId]) => !adminIds.has(userId))
            .map(([userId, info]) => {
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

        const users7d = countSince(memberRows, 7);
        const usersPrev7d = countSince(memberRows, 14) - users7d;
        const users30d = countSince(memberRows, 30);
        const usersPrev30d = countSince(memberRows, 60) - users30d;
        const modules7d = countSince(memberModules, 7);
        const modulesPrev7d = countSince(memberModules, 14) - modules7d;
        const messages7d = countSince(memberChat, 7);
        const messagesPrev7d = countSince(memberChat, 14) - messages7d;
        const usage7d = usageSince(memberUsage, 7);
        const usagePrev7d = usageSince(memberUsage, 14) - usage7d;

        res.status(200).json({
            totalUsers: memberRows.length,
            activeUsers: activeCount,
            activeUserPct: memberRows.length ? Math.round((activeCount / memberRows.length) * 100) : 0,
            engagedUsers: engagedCount,
            engagedUserPct: memberRows.length ? Math.round((engagedCount / memberRows.length) * 100) : 0,
            aiCallsToday: chatCallsToday + visionCallsToday,
            aiChatCallsToday: chatCallsToday,
            aiVisionCallsToday: visionCallsToday,
            aiUsersToday: memberAi.size,
            aiAtLimitCount: memberRows.filter(r => r.ai_at_limit).length,
            aiLimits: aiLimits,
            adminCount: rows.filter(r => r.role === 'admin').length,
            totalModules: memberModules.length,
            totalChatMessages: memberChat.length,
            totalAchievements: memberUnlocks.length,
            totalTimeSeconds,
            avgSecondsPerActiveUser: engagedCount ? Math.round(totalTimeSeconds / engagedCount) : 0,
            overallAverage,
            mostCommonGrade,
            gradeDistribution,
            topModules,
            achievementBreakdown,
            averageMarkByYear,
            avgMessagesPerActiveUser: engagedCount ? +(memberChat.length / engagedCount).toFixed(1) : 0,
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
        });
    } catch (error) {
        console.error('[admin-stats] failed:', error.message);
        res.status(500).json({ error: 'Failed to load admin statistics.' });
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

async function fetchRows(url, headers) {
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    return res.json();
}

function todayUtc() {
    return new Date().toISOString().slice(0, 10);
}

function countBy(list, key) {
    const map = new Map();
    (list || []).forEach(item => {
        const k = item[key];
        map.set(k, (map.get(k) || 0) + 1);
    });
    return map;
}
