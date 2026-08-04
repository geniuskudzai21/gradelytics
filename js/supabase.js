/* ═══════════════════════════════════════════════════════════════════════════
   Gradelytics — Supabase data layer + authentication
   ───────────────────────────────────────────────────────────────────────────
   Exposes `window.GradelyticsDB`:

     Auth:
       init()                       create Supabase client (config-gated)
       isConfigured()               true when real Supabase credentials exist
       getSession()                 current Supabase auth session
       getUserId()                  current user id (or null)
       signUp(email, password)      create a new account
       signIn(email, password)      sign in with email + password
       signOut()                    sign out
       updatePassword(password)     change the signed-in user's password
       updateDisplayName(name)      save a display name to the user's profile
       deleteAccount()              permanently delete the account via /api/delete-account
       onAuthStateChange(cb)        subscribe to auth changes

     Data (modules / chat / achievements):
       loadModules()                [{name, year, part, semester, mark, grade}]
       saveModules(list)            full reconcile (delete + reinsert)
       loadChatMessages()           [{role, content}]
       addChatMessage(role, content)
       clearChatMessages()
       loadAchievementUnlocks()     {gold: iso, silver: iso, ...}
       saveAchievementUnlock(key, iso)

   When Supabase is NOT configured (placeholders still in supabase-config.js),
   every call transparently degrades to the original localStorage behaviour so
   the app keeps working fully offline during development.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    const LS_MODULES = 'modules';
    const LS_CHAT = 'ai_chat_messages';
    const LS_ACHIEVEMENTS = 'achievementUnlocks';
    /* Scoped flag set when the user wipes every module, so a failed/empty
       cloud delete can never resurrect those rows on a later refresh. */
    const LS_MODULES_TOMBSTONE = 'modules_cleared';

    let sb = null;
    let configured = false;
    let currentDisplayName = 'Genius';
    let currentUserId = null;
    let adminPromptActive = false;
    let authRedirectHandled = false;
    /* Bumped on every local data write (module saves, achievement resets).
       An in-flight loadAllFromDB() that started reading before a write can
       detect the change and bail, so a stale merge can never resurrect rows
       (or achievement progress) the user just deleted. */
    let syncVersion = 0;

    /* ── Client bootstrap ── */

    function init() {
        const cfg = (typeof window !== 'undefined' && window.GRADELYTICS_SUPABASE) || {};
        const url = cfg.url || '';
        const key = cfg.anonKey || '';
        const looksReal = url.startsWith('http') && key && key.indexOf('YOUR_SUPABASE') === -1;
        if (looksReal && typeof supabase !== 'undefined') {
            sb = supabase.createClient(url, key);
            configured = true;
        }
        return configured;
    }

    function isConfigured() {
        return configured;
    }

    /* ── User-scoped cache ──
       Every localStorage key is namespaced by the signed-in user id so that a
       different account on the same browser can never read (or re-upload)
       another user's cached data. When no one is signed in, the shared
       "pre-account" keys are used for offline/local mode. */
    function cacheKey(base) {
        return currentUserId ? base + ':' + currentUserId : base;
    }

    function clearUserCache() {
        syncVersion++;
        localStorage.removeItem(cacheKey(LS_MODULES));
        localStorage.removeItem(cacheKey(LS_CHAT));
        localStorage.removeItem(cacheKey(LS_ACHIEVEMENTS));
        localStorage.removeItem(cacheKey(LS_MODULES_TOMBSTONE));
    }

    /* ── Auth ── */

    async function getSession() {
        if (!sb) return { session: null };
        const { data, error } = await sb.auth.getSession();
        if (error) return { session: null };
        return { session: data.session };
    }

    async function getUserId() {
        if (!sb) return null;
        const { data, error } = await sb.auth.getUser();
        if (error || !data.user) return null;
        return data.user.id;
    }

    async function signUp(email, password) {
        if (!sb) return { error: { message: 'Supabase is not configured.' } };
        const { data, error } = await sb.auth.signUp({ email, password });
        return { user: data.user, session: data.session, error };
    }

    async function signIn(email, password) {
        if (!sb) return { error: { message: 'Supabase is not configured.' } };
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        return { user: data.user, error };
    }

    /* Google OAuth — redirects to Google, then back to this same page. The
       session is picked up from the URL by supabase-js on load and
       redirectAfterLogin() sends the user to the dashboard. The returned
       redirectTo URL must be added to Supabase → Authentication → URL
       Configuration → Redirect URLs. */
    async function signInWithGoogle() {
        if (!sb) return { error: { message: 'Supabase is not configured.' } };
        const redirectTo = window.location.origin + window.location.pathname;
        const { data, error } = await sb.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo }
        });
        return { data, error };
    }

    /* Admin emails sign in with the admin password (ADMIN_PASSWORD) and are
       routed to admin.html. Everyone else falls through to a normal Supabase
       account sign-in and lands on their user dashboard. When `opts.adminOnly`
       is set (Google sign-in for an admin email), a wrong password shows an
       error instead of falling through to the regular password sign-in. */
    async function loginWithAdminCheck(email, password, opts) {
        opts = opts || {};
        try {
            const res = await fetch('/api/admin-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            if (res.ok) {
                const data = await res.json().catch(() => null);
                if (data && data.role === 'admin') {
                    try { sessionStorage.setItem('gradelytics_admin_password', password); } catch (e) { /* ignore */ }
                    window.location.href = 'admin.html';
                    return { redirecting: true };
                }
            }
        } catch (err) {
            // Server unreachable — fall through to a normal Supabase sign-in.
        }
        if (opts.adminOnly) {
            return { error: { message: 'Incorrect admin password.' } };
        }
        return signIn(email, password);
    }

    async function signOut() {
        try { sessionStorage.removeItem('gradelytics_admin_password'); } catch (e) { /* ignore */ }
        if (!sb) return;
        await sb.auth.signOut();
    }

    async function updatePassword(newPassword) {
        if (!sb) return { error: { message: 'Supabase is not configured.' } };
        return sb.auth.updateUser({ password: newPassword });
    }

    async function updateDisplayName(name) {
        if (!sb) return { error: { message: 'Supabase is not configured.' } };
        const clean = String(name || '').replace(/[^a-zA-Z0-9 ]/g, '').trim();
        if (!clean) return { error: { message: 'Display name cannot be empty.' } };
        const { error } = await sb.auth.updateUser({ data: { display_name: clean } });
        if (!error) {
            currentDisplayName = clean;
            renderDisplayName();
        }
        return { error };
    }

    /* Permanently deletes the signed-in user on the server. The anon key can't
       do this, so we hand the access token to a serverless endpoint that calls
       the Supabase admin API with the service_role key. */
    async function deleteAccount() {
        if (!sb) return { error: { message: 'Supabase is not configured.' } };
        const { session } = await getSession();
        if (!session) return { error: { message: 'Not signed in.' } };
        try {
            const res = await fetch('/api/delete-account', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + session.access_token
                }
            });
            const data = await res.json();
            if (!res.ok) return { error: { message: data.error || 'Failed to delete account.' } };
            return { ok: true };
        } catch (err) {
            return { error: { message: err.message || 'Failed to delete account.' } };
        }
    }

    function onAuthStateChange(callback) {
        if (!sb) return function () { };
        const { data } = sb.auth.onAuthStateChange((event, session) => callback(event, session));
        return data.subscription.unsubscribe;
    }

    /* ── Modules ── */

    async function loadModules() {
        if (!sb) {
            return JSON.parse(localStorage.getItem(cacheKey(LS_MODULES)) || '[]');
        }
        const userId = await getUserId();
        if (!userId) throw new Error('Not signed in');
        const { data, error } = await sb.from('modules')
            .select('id, name, year, part, semester, mark, grade')
            .eq('user_id', userId)
            .order('created_at', { ascending: true });
        if (error) throw error;

        return (data || []).map(m => ({
            id: m.id,
            name: m.name,
            year: m.year,
            part: m.part,
            semester: Number(m.semester),
            mark: Number(m.mark),
            grade: m.grade
        }));
    }

    /* Normalise a module before it is written anywhere: coerce semester to a
       whole number, clamp mark to 0–100, strip whitespace. Returns null for
       rows that can't be stored (NaN marks, missing fields) so a single bad
       row — e.g. an AI extraction — can never fail the whole cloud sync. */
    function sanitizeModule(m) {
        const name = String(m.name == null ? '' : m.name).trim();
        const year = String(m.year == null ? '' : m.year).trim();
        const part = String(m.part == null ? '' : m.part).trim();
        const semester = Math.round(Number(m.semester));
        const mark = Math.min(100, Math.max(0, Number(m.mark)));
        const grade = String(m.grade == null ? '' : m.grade).trim();
        if (!name || !year || !part || !Number.isFinite(semester) || !Number.isFinite(mark) || !grade) {
            return null;
        }
        const clean = { name, year, part, semester, mark, grade };
        if (m && m.id != null) clean.id = m.id;
        return clean;
    }

    /* Full reconciliation: delete the user's rows, then reinsert. Simple and
       always correct for the small datasets this app deals with. The in-memory
       list is updated immediately; the scoped cache is mirrored so a refresh
       never loses data while the cloud is unreachable, and wiping every module
       leaves a tombstone so deleted rows can't be resurrected by a stale
       cloud. Returns { synced, error } — callers must surface a failed cloud
       write instead of pretending the delete/add succeeded. */
    async function saveModules(list) {
        syncVersion++;
        const seen = new Set();
        const cleaned = list.map(sanitizeModule).filter(Boolean).filter(m => {
            const key = moduleKey(m);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        setInMemoryModules(cleaned);

        if (cleaned.length === 0) {
            // User wiped every module — record it so a failed/empty cloud
            // delete can never restore these rows on a later refresh.
            localStorage.setItem(cacheKey(LS_MODULES_TOMBSTONE), '1');
        } else {
            localStorage.removeItem(cacheKey(LS_MODULES_TOMBSTONE));
        }

        if (!sb) {
            localStorage.setItem(cacheKey(LS_MODULES), JSON.stringify(cleaned));
            return { synced: true };
        }

        const userId = await getUserId();
        if (!userId) {
            localStorage.setItem(cacheKey(LS_MODULES), JSON.stringify(cleaned));
            return { synced: false, error: 'Not signed in' };
        }

        const { error: delError } = await sb.from('modules').delete().eq('user_id', userId);
        if (delError) {
            localStorage.setItem(cacheKey(LS_MODULES), JSON.stringify(cleaned));
            return { synced: false, error: delError.message };
        }

        if (cleaned.length === 0) {
            localStorage.setItem(cacheKey(LS_MODULES), JSON.stringify(cleaned));
            return { synced: true };
        }

        const rows = cleaned.map(m => ({
            user_id: userId,
            name: m.name,
            year: m.year,
            part: m.part,
            semester: m.semester,
            mark: m.mark,
            grade: m.grade
        }));

        const { data, error } = await sb.from('modules').insert(rows).select('id');
        if (error) {
            localStorage.setItem(cacheKey(LS_MODULES), JSON.stringify(cleaned));
            return { synced: false, error: error.message };
        }

        if (Array.isArray(data)) {
            data.forEach((row, i) => {
                if (row && cleaned[i]) cleaned[i].id = row.id;
            });
        }
        setInMemoryModules(cleaned);
        localStorage.setItem(cacheKey(LS_MODULES), JSON.stringify(cleaned));
        return { synced: true };
    }

    /* ── Chat messages ── */

    async function loadChatMessages() {
        if (!sb) {
            return JSON.parse(localStorage.getItem(cacheKey(LS_CHAT)) || '[]');
        }
        const userId = await getUserId();
        if (!userId) throw new Error('Not signed in');
        const { data, error } = await sb.from('chat_messages')
            .select('role, content')
            .eq('user_id', userId)
            .order('created_at', { ascending: true });
        if (error) throw error;
        const list = (data || []).map(m => ({ role: m.role, content: m.content }));
        return list;
    }

    async function addChatMessage(role, content) {
        if (!sb) return;
        const userId = await getUserId();
        if (!userId) return;
        const { error } = await sb.from('chat_messages').insert({ user_id: userId, role, content });
        if (error) console.error('[GradelyticsDB] chat save failed:', error.message);
    }

    async function clearChatMessages() {
        if (!sb) return;
        const userId = await getUserId();
        if (!userId) return;
        const { error } = await sb.from('chat_messages').delete().eq('user_id', userId);
        if (error) console.error('[GradelyticsDB] chat clear failed:', error.message);
    }

    /* ── Achievement unlocks ── */

    async function loadAchievementUnlocks() {
        if (!sb) {
            return JSON.parse(localStorage.getItem(cacheKey(LS_ACHIEVEMENTS)) || '{}');
        }
        const userId = await getUserId();
        if (!userId) throw new Error('Not signed in');
        const { data, error } = await sb.from('achievement_unlocks')
            .select('unlock_key, unlocked_at')
            .eq('user_id', userId)
            .order('unlocked_at', { ascending: true });
        if (error) throw error;

        const state = {};
        (data || []).forEach(row => {
            state[row.unlock_key] = row.unlocked_at;
        });
        return state;
    }

    async function saveAchievementUnlock(key, unlockedAt) {
        if (!sb) return;
        const userId = await getUserId();
        if (!userId) return;
        const { error } = await sb.from('achievement_unlocks').upsert(
            { user_id: userId, unlock_key: key, unlocked_at: unlockedAt },
            { onConflict: 'user_id,unlock_key' }
        );
        if (error) console.error('[GradelyticsDB] achievement save failed:', error.message);
    }

    /* Wipe the user's achievement progress — unlock history and record
       baselines — both locally and in the cloud. Called when every module is
       deleted so the Milestones section starts from a clean slate. */
    async function resetAchievements() {
        if (window.resetAchievementProgress) window.resetAchievementProgress();
        syncVersion++;
        if (!sb) return { synced: true };
        const userId = await getUserId();
        if (!userId) return { synced: false, error: 'Not signed in' };
        const { error } = await sb.from('achievement_unlocks').delete().eq('user_id', userId);
        return { synced: !error, error: error ? error.message : null };
    }

    /* ── Shared helpers ── */

    function readLocalArray(key) {
        try {
            const v = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(v) ? v : [];
        } catch (e) {
            return [];
        }
    }

    function getInMemoryModules() {
        if (typeof modules !== 'undefined' && Array.isArray(modules)) return modules;
        return readLocalArray(cacheKey(LS_MODULES));
    }

    function moduleKey(m) {
        return [m.name, m.year, m.part, m.semester, m.mark, m.grade].map(String).join('|');
    }

    function setInMemoryModules(list) {
        if (typeof modules !== 'undefined' && Array.isArray(modules)) {
            modules.splice(0, modules.length, ...list);
        }
    }

    function setInMemoryChat(list) {
        if (typeof chatMessages !== 'undefined' && Array.isArray(chatMessages)) {
            chatMessages.splice(0, chatMessages.length, ...list);
        }
    }

    function rerender() {
        if (typeof displayModules === 'function') displayModules();
        if (typeof updateStatistics === 'function') updateStatistics();
        if (typeof renderChatMessages === 'function') renderChatMessages();
        if (typeof prefillWhatIf === 'function') prefillWhatIf();
    }

    function renderDisplayName() {
        const el = document.getElementById('sidebar-username');
        if (el) el.innerHTML = `<i class='bx bx-user-circle'></i> ${currentDisplayName}`;
        const settingsName = document.getElementById('settings-display-name');
        if (settingsName) settingsName.value = currentDisplayName;
        const greeting = document.getElementById('welcome-greeting');
        if (greeting && currentDisplayName !== 'Genius') {
            greeting.textContent = greeting.textContent.replace(/,\s*[^,]*$/, '') + `, ${currentDisplayName}`;
        }
    }

    function setAuthedUI(session) {
        currentUserId = session && session.user ? session.user.id : null;
        const email = session && session.user ? session.user.email : '';
        const metaName = session && session.user && session.user.user_metadata
            ? (session.user.user_metadata.display_name || session.user.user_metadata.full_name || '')
            : '';
        const derived = email ? email.split('@')[0] : '';
        const rawName = (metaName && metaName.trim()) ? metaName : derived;
        const parts = rawName.replace(/[^a-zA-Z0-9 ]/g, '').trim();
        currentDisplayName = parts ? parts.charAt(0).toUpperCase() + parts.slice(1) : 'Genius';
        renderDisplayName();
        const settingsEmail = document.getElementById('settings-email');
        if (settingsEmail) settingsEmail.value = email;
    }

    function getDisplayName() {
        return currentDisplayName;
    }

    async function loadAllFromDB() {
        try {
            const versionAtStart = syncVersion;
            const [dbMods, dbMsgs, dbUnlocks] = await Promise.all([
                loadModules(),
                loadChatMessages(),
                loadAchievementUnlocks()
            ]);

            // A local write (add/edit/delete/reset) landed while the DB reads
            // were in flight. That write is authoritative and already synced,
            // so bail instead of painting stale data over the screen.
            if (syncVersion !== versionAtStart) return;

            // A wipe tombstone means the user deliberately deleted every module
            // on this device. Never let a failed/empty cloud delete resurrect
            // those rows — keep the list empty and re-attempt the cloud
            // cleanup so the tombstones clear once the backend catches up.
            const wiped = localStorage.getItem(cacheKey(LS_MODULES_TOMBSTONE)) === '1';

            let mods = dbMods;
            if (wiped) {
                mods = [];
                try {
                    const userId = await getUserId();
                    if (userId) {
                        const { error: delErr } = await sb.from('modules').delete().eq('user_id', userId);
                        const { error: achErr } = await sb.from('achievement_unlocks').delete().eq('user_id', userId);
                        if (!delErr && !achErr) localStorage.removeItem(cacheKey(LS_MODULES_TOMBSTONE));
                    }
                } catch (e) { /* heal is best-effort */ }
            } else if (mods.length === 0) {
                // Cloud is empty but this device has data (offline, or earlier
                // cloud writes never landed). Keep the local copy so a refresh
                // can never wipe the user's marks, and push it up best-effort.
                const localMods = readLocalArray(cacheKey(LS_MODULES));
                if (localMods.length > 0) {
                    mods = localMods;
                    saveModules(localMods);
                }
            }

            let msgs = dbMsgs;
            if (msgs.length === 0) {
                const localMsgs = readLocalArray(cacheKey(LS_CHAT));
                if (localMsgs.length > 0) msgs = localMsgs;
            }

            let unlocks = dbUnlocks;
            if (!Object.keys(unlocks).length) {
                let localUnlocks = {};
                try {
                    localUnlocks = JSON.parse(localStorage.getItem(cacheKey(LS_ACHIEVEMENTS)) || '{}');
                } catch (e) { /* ignore corrupt cache */ }
                if (Object.keys(localUnlocks).length) {
                    unlocks = localUnlocks;
                    Object.keys(localUnlocks).forEach(key => saveAchievementUnlock(key, localUnlocks[key]));
                }
            }

            setInMemoryModules(mods);
            setInMemoryChat(msgs);
            localStorage.setItem(cacheKey(LS_MODULES), JSON.stringify(mods));
            localStorage.setItem(cacheKey(LS_CHAT), JSON.stringify(msgs));
            localStorage.setItem(cacheKey(LS_ACHIEVEMENTS), JSON.stringify(unlocks));

            rerender();
        } catch (err) {
            console.error('[GradelyticsDB] failed to load from Supabase:', err);
            fallbackToLocal();
        }
    }

    function fallbackToLocal() {
        setInMemoryModules(readLocalArray(cacheKey(LS_MODULES)));
        setInMemoryChat(readLocalArray(cacheKey(LS_CHAT)));
        rerender();
    }

    /* ── Reveal the app once auth state is known. The dashboard hides itself
       with `html.auth-gate body { visibility: hidden; }` until this runs so an
       unauthenticated visitor never sees a flash of the dashboard before being
       redirected to the auth page. ── */
    function revealApp() {
        document.documentElement.classList.remove('auth-gate');
    }

    /* ── Auth page UI (pages/auth.html) ── */

    function redirectAfterLogin() {
        if (authRedirectHandled) return;
        authRedirectHandled = true;
        let adminPassword = null;
        try { adminPassword = sessionStorage.getItem('gradelytics_admin_password'); } catch (e) { /* ignore */ }
        if (adminPassword) {
            window.location.href = 'admin.html';
            return;
        }

        // Check whether the signed-in account is an admin email so Google
        // sign-in can still reach the admin console (gated by ADMIN_PASSWORD).
        getSession().then(function (res) {
            const session = res.session;
            if (session && session.access_token) {
                return fetch('/api/is-admin', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + session.access_token
                    }
                })
                    .then(r => r.json().catch(() => null))
                    .then(data => {
                        if (data && data.isAdmin) {
                            promptAdminPassword(session.user && session.user.email);
                            return;
                        }
                        window.location.href = 'dashboard.html';
                    });
            }
            window.location.href = 'dashboard.html';
        }).catch(function () {
            window.location.href = 'dashboard.html';
        });
    }

    /* Pre-fill the auth form for an admin who signed in via Google so they
       only have to type the admin password to open the admin console. */
    function promptAdminPassword(email) {
        adminPromptActive = true;
        const emailInput = document.getElementById('auth-email');
        const passwordInput = document.getElementById('auth-password');
        const errorEl = document.getElementById('auth-error');
        if (emailInput) emailInput.value = email || '';
        if (errorEl) {
            errorEl.textContent = 'Admin account detected. Enter the admin password to open the admin console.';
        }
        if (passwordInput) passwordInput.focus();
    }

    function wireAuthPage() {
        const tabs = document.querySelectorAll('.auth-tab');
        const form = document.getElementById('auth-form');
        const emailInput = document.getElementById('auth-email');
        const passwordInput = document.getElementById('auth-password');
        const errorEl = document.getElementById('auth-error');
        const submitBtn = document.getElementById('auth-submit');
        const titleEl = document.getElementById('auth-title');
        const subtitleEl = document.getElementById('auth-subtitle');
        const pwToggle = document.getElementById('auth-password-toggle');

        if (!form) return;

        if (pwToggle) {
            const icon = pwToggle.querySelector('i');
            pwToggle.addEventListener('click', () => {
                const show = passwordInput.type === 'password';
                passwordInput.type = show ? 'text' : 'password';
                if (icon) icon.className = show ? 'bx bx-hide' : 'bx bx-show';
                pwToggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
                passwordInput.focus();
            });
        }

        let mode = 'login';

        function setMode(next) {
            mode = next;
            tabs.forEach(t => t.classList.toggle('active', t.dataset.mode === next));
            submitBtn.textContent = mode === 'login' ? 'Sign In' : 'Create Account';
            if (titleEl) titleEl.textContent = mode === 'login' ? 'Welcome back' : 'Create your account';
            if (subtitleEl) {
                subtitleEl.textContent = mode === 'login'
                    ? 'Sign in to sync your academic data across devices.'
                    : 'Create a free account to back up and sync your data.';
            }
            errorEl.textContent = '';
        }

        setMode('login');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => setMode(tab.dataset.mode));
        });

        const googleBtn = document.getElementById('auth-google');
        if (googleBtn) {
            const originalHTML = googleBtn.innerHTML;
            googleBtn.addEventListener('click', async function () {
                errorEl.textContent = '';
                googleBtn.disabled = true;
                googleBtn.textContent = 'Redirecting to Google...';
                try {
                    const result = await signInWithGoogle();
                    if (result && result.error) {
                        errorEl.textContent = result.error.message || 'Google sign-in failed. Try again.';
                    }
                } catch (err) {
                    errorEl.textContent = err.message || 'Something went wrong. Try again.';
                } finally {
                    googleBtn.disabled = false;
                    googleBtn.innerHTML = originalHTML;
                }
            });
        }

        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            const email = emailInput.value.trim();
            const password = passwordInput.value;
            errorEl.textContent = '';

            if (!email || !password) {
                errorEl.textContent = 'Please enter your email and password.';
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = mode === 'login' ? 'Signing in...' : 'Creating account...';
            try {
                const result = mode === 'login'
                    ? await loginWithAdminCheck(email, password, adminPromptActive ? { adminOnly: true } : undefined)
                    : await signUp(email, password);

                if (result.redirecting) return;
                if (result.error) {
                    errorEl.textContent = result.error.message;
                    return;
                }
                if (mode === 'signup' && !result.session) {
                    errorEl.textContent = 'Check your inbox — we sent a confirmation link.';
                    return;
                }
                if (mode === 'login' && result.user) {
                    redirectAfterLogin();
                    return;
                }
                // Otherwise the signed-in redirect is handled by onAuthStateChange.
            } catch (err) {
                errorEl.textContent = err.message || 'Something went wrong. Try again.';
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = mode === 'login' ? 'Sign In' : 'Create Account';
            }
        });
    }

    function wireLogout() {
        const logoutBtn = document.getElementById('logout-btn');
        if (!logoutBtn) return;
        logoutBtn.addEventListener('click', async function () {
            if (!sb) {
                window.location.href = '../index.html';
                return;
            }
            await signOut();
            fallbackToLocal();
            window.location.href = 'auth.html';
        });
    }

    function wireSettings() {
        const passwordForm = document.getElementById('settings-password-form');
        const signoutBtn = document.getElementById('settings-signout-btn');
        const deleteBtn = document.getElementById('settings-delete-btn');
        const modal = document.getElementById('settings-confirm-modal');
        const closeBtn = document.getElementById('settings-confirm-close');
        const noBtn = document.getElementById('settings-confirm-no');
        const yesBtn = document.getElementById('settings-confirm-yes');

        function setMsg(text, isSuccess) {
            const el = document.getElementById('settings-password-msg');
            if (!el) return;
            el.textContent = text;
            el.classList.toggle('settings-msg--success', !!isSuccess);
        }

        const nameInput = document.getElementById('settings-display-name');
        const nameSaveBtn = document.getElementById('settings-name-save');
        const nameMsg = document.getElementById('settings-name-msg');
        if (nameInput && nameSaveBtn) {
            const originalHTML = nameSaveBtn.innerHTML;
            nameSaveBtn.addEventListener('click', async function () {
                const name = nameInput.value.trim();
                if (nameMsg) {
                    nameMsg.textContent = '';
                    nameMsg.classList.remove('settings-msg--success');
                }
                if (!sb) {
                    if (nameMsg) nameMsg.textContent = 'Sign in with an account to change your name.';
                    return;
                }
                if (!name) {
                    if (nameMsg) nameMsg.textContent = 'Display name cannot be empty.';
                    return;
                }
                nameSaveBtn.disabled = true;
                nameSaveBtn.textContent = 'Saving...';
                try {
                    const { error } = await updateDisplayName(name);
                    if (error) {
                        if (nameMsg) nameMsg.textContent = error.message || 'Failed to save name.';
                    } else if (nameMsg) {
                        nameMsg.textContent = 'Display name saved.';
                        nameMsg.classList.add('settings-msg--success');
                    }
                } catch (err) {
                    if (nameMsg) nameMsg.textContent = err.message || 'Something went wrong. Try again.';
                } finally {
                    nameSaveBtn.disabled = false;
                    nameSaveBtn.innerHTML = originalHTML;
                }
            });
        }

        if (passwordForm) {
            const newPasswordInput = document.getElementById('settings-new-password');
            const confirmInput = document.getElementById('settings-confirm-password');
            const submitBtn = document.getElementById('settings-password-btn');
            const originalHTML = submitBtn ? submitBtn.innerHTML : '';

            passwordForm.addEventListener('submit', async function (e) {
                e.preventDefault();
                setMsg('', false);
                if (!sb) {
                    setMsg('Sign in with an account to change your password.', false);
                    return;
                }
                const newPassword = newPasswordInput.value;
                if (newPassword.length < 6) {
                    setMsg('Password must be at least 6 characters.', false);
                    return;
                }
                if (newPassword !== confirmInput.value) {
                    setMsg('Passwords do not match.', false);
                    return;
                }
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Updating...';
                }
                try {
                    const { error } = await updatePassword(newPassword);
                    if (error) {
                        setMsg(error.message || 'Failed to update password.', false);
                    } else {
                        setMsg('Password updated successfully.', true);
                        passwordForm.reset();
                    }
                } catch (err) {
                    setMsg(err.message || 'Something went wrong. Try again.', false);
                } finally {
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = originalHTML;
                    }
                }
            });
        }

        if (signoutBtn) {
            signoutBtn.addEventListener('click', async function () {
                if (!sb) {
                    window.location.href = '../index.html';
                    return;
                }
                await signOut();
                fallbackToLocal();
                window.location.href = 'auth.html';
            });
        }

        if (deleteBtn && modal) {
            const errorEl = document.getElementById('settings-confirm-error');

            function openDeleteModal() {
                if (errorEl) errorEl.textContent = '';
                modal.classList.add('open');
            }
            function closeDeleteModal() {
                modal.classList.remove('open');
            }

            deleteBtn.addEventListener('click', openDeleteModal);
            if (closeBtn) closeBtn.addEventListener('click', closeDeleteModal);
            if (noBtn) noBtn.addEventListener('click', closeDeleteModal);
            modal.addEventListener('click', function (e) {
                if (e.target === modal) closeDeleteModal();
            });

            yesBtn.addEventListener('click', async function () {
                yesBtn.disabled = true;
                yesBtn.textContent = 'Deleting...';
                try {
                    const result = await deleteAccount();
                    if (result.error) {
                        if (errorEl) errorEl.textContent = result.error.message;
                        return;
                    }
                    try { await signOut(); } catch (err) { /* already deleted */ }
                    localStorage.clear();
                    window.location.href = '../index.html';
                } finally {
                    yesBtn.disabled = false;
                    yesBtn.textContent = 'Delete Account';
                }
            });
        }
    }

    /* ── App bootstrap ── */

    async function initApp() {
        const hasConfig = init();
        const isAuthPage = !!document.getElementById('auth-page');
        // Admin console guards itself with the stored admin password, so it
        // must never run the dashboard bootstrap or the auth redirects below.
        const isAdminPage = !!document.getElementById('admin-page');

        if (isAuthPage) {
            wireAuthPage();
        } else if (!isAdminPage) {
            wireLogout();
            wireSettings();
        }

        if (!hasConfig) {
            if (!isAuthPage && !isAdminPage) {
                fallbackToLocal();
                revealApp();
            }
            return;
        }

        onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN') {
                if (isAuthPage) {
                    redirectAfterLogin();
                } else if (!isAdminPage) {
                    setAuthedUI(session);
                    loadAllFromDB();
                    revealApp();
                }
            } else if (event === 'SIGNED_OUT') {
                currentDisplayName = 'Genius';
                clearUserCache();
                currentUserId = null;
                setInMemoryModules([]);
                setInMemoryChat([]);
                if (!isAuthPage && !isAdminPage) {
                    fallbackToLocal();
                    window.location.href = 'auth.html';
                }
            }
        });

        const { session } = await getSession();
        if (session) {
            if (isAuthPage) {
                redirectAfterLogin();
            } else if (!isAdminPage) {
                setAuthedUI(session);
                await loadAllFromDB();
                revealApp();
            }
        } else if (!isAuthPage && !isAdminPage) {
            window.location.href = 'auth.html';
        }
    }

    document.addEventListener('DOMContentLoaded', initApp);

    /* ── Public API ── */

    window.GradelyticsDB = {
        init: init,
        isConfigured: isConfigured,
        getSession: getSession,
        getUserId: getUserId,
        getDisplayName: getDisplayName,
        getCacheKey: cacheKey,
        signUp: signUp,
        signIn: signIn,
        signInWithGoogle: signInWithGoogle,
        signOut: signOut,
        updatePassword: updatePassword,
        updateDisplayName: updateDisplayName,
        deleteAccount: deleteAccount,
        onAuthStateChange: onAuthStateChange,
        loadModules: loadModules,
        saveModules: saveModules,
        loadChatMessages: loadChatMessages,
        addChatMessage: addChatMessage,
        clearChatMessages: clearChatMessages,
        loadAchievementUnlocks: loadAchievementUnlocks,
        saveAchievementUnlock: saveAchievementUnlock,
        resetAchievements: resetAchievements,
        getModules: getInMemoryModules
    };
})();
