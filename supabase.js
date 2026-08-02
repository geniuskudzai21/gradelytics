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

    let sb = null;
    let configured = false;

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

    async function signOut() {
        if (!sb) return;
        await sb.auth.signOut();
    }

    function onAuthStateChange(callback) {
        if (!sb) return function () { };
        const { data } = sb.auth.onAuthStateChange((event, session) => callback(event, session));
        return data.subscription.unsubscribe;
    }

    /* ── Modules ── */

    async function loadModules() {
        if (!sb) {
            return JSON.parse(localStorage.getItem(LS_MODULES) || '[]');
        }
        const { data, error } = await sb
            .from('modules')
            .select('id, name, year, part, semester, mark, grade')
            .order('created_at', { ascending: true });
        if (error) throw error;

        const list = (data || []).map(m => ({
            id: m.id,
            name: m.name,
            year: m.year,
            part: m.part,
            semester: Number(m.semester),
            mark: Number(m.mark),
            grade: m.grade
        }));
        localStorage.setItem(LS_MODULES, JSON.stringify(list));
        return list;
    }

    /* Full reconciliation: delete the user's rows, then reinsert. Simple and
       always correct for the small datasets this app deals with. */
    async function saveModules(list) {
        localStorage.setItem(LS_MODULES, JSON.stringify(list));
        if (!sb) return;

        const userId = await getUserId();
        if (!userId) return;

        const { error: delError } = await sb.from('modules').delete();
        if (delError) throw delError;

        if (list.length === 0) return;

        const rows = list.map(m => ({
            user_id: userId,
            name: m.name,
            year: String(m.year),
            part: String(m.part),
            semester: Number(m.semester),
            mark: Number(m.mark),
            grade: m.grade
        }));

        const { data, error } = await sb.from('modules').insert(rows).select('id');
        if (error) throw error;

        if (Array.isArray(data)) {
            data.forEach((row, i) => {
                if (row && list[i]) list[i].id = row.id;
            });
        }
    }

    /* ── Chat messages ── */

    async function loadChatMessages() {
        if (!sb) {
            return JSON.parse(localStorage.getItem(LS_CHAT) || '[]');
        }
        const { data, error } = await sb
            .from('chat_messages')
            .select('role, content')
            .order('created_at', { ascending: true });
        if (error) throw error;
        const list = (data || []).map(m => ({ role: m.role, content: m.content }));
        localStorage.setItem(LS_CHAT, JSON.stringify(list));
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
            return JSON.parse(localStorage.getItem(LS_ACHIEVEMENTS) || '{}');
        }
        const { data, error } = await sb
            .from('achievement_unlocks')
            .select('unlock_key, unlocked_at');
        if (error) throw error;

        const state = {};
        (data || []).forEach(row => {
            state[row.unlock_key] = row.unlocked_at;
        });
        localStorage.setItem(LS_ACHIEVEMENTS, JSON.stringify(state));
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
        return readLocalArray(LS_MODULES);
    }

    function moduleKey(m) {
        return [m.name, m.year, m.part, m.semester, m.mark, m.grade].map(String).join('|');
    }

    function mergeModules(dbMods, localMods) {
        const seen = new Set(dbMods.map(moduleKey));
        const merged = [...dbMods];
        localMods.forEach(m => {
            const key = moduleKey(m);
            if (!seen.has(key)) {
                merged.push(m);
                seen.add(key);
            }
        });
        return merged;
    }

    function mergeChat(dbMsgs, localMsgs) {
        const seen = new Set(dbMsgs.map(m => m.role + '|' + m.content));
        const merged = [...dbMsgs];
        localMsgs.forEach(m => {
            const key = m.role + '|' + m.content;
            if (!seen.has(key)) {
                merged.push(m);
                seen.add(key);
            }
        });
        return merged;
    }

    async function persistChat(msgs) {
        if (!sb) return;
        const userId = await getUserId();
        if (!userId) return;
        await sb.from('chat_messages').delete();
        if (msgs.length) {
            const { error } = await sb.from('chat_messages').insert(
                msgs.map(m => ({ user_id: userId, role: m.role, content: m.content }))
            );
            if (error) console.error('[GradelyticsDB] chat persist failed:', error.message);
        }
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

    function setAuthedUI(session) {
        const email = session && session.user ? session.user.email : '';
        const name = email ? email.split('@')[0] : 'Genius';
        const el = document.getElementById('sidebar-username');
        if (el) el.innerHTML = `<i class='bx bx-user-circle'></i> ${name}`;
        const greeting = document.getElementById('welcome-greeting');
        if (greeting && email) {
            const parts = name.replace(/[^a-zA-Z0-9 ]/g, '').trim();
            if (parts) {
                const capitalized = parts.charAt(0).toUpperCase() + parts.slice(1);
                greeting.textContent = greeting.textContent.replace(/Genius$/, capitalized);
            }
        }
    }

    async function loadAllFromDB() {
        try {
            // Capture local-only data BEFORE reading the cloud so we can adopt
            // it into the account on first sign-in (no data loss on migration).
            const localMods = readLocalArray(LS_MODULES);
            const localMsgs = readLocalArray(LS_CHAT);
            let localUnlocks = {};
            try {
                localUnlocks = JSON.parse(localStorage.getItem(LS_ACHIEVEMENTS) || '{}');
            } catch (e) { /* ignore corrupt cache */ }

            const [dbMods, dbMsgs, dbUnlocks] = await Promise.all([
                loadModules(),
                loadChatMessages(),
                loadAchievementUnlocks()
            ]);

            const mods = mergeModules(dbMods, localMods);
            const msgs = mergeChat(dbMsgs, localMsgs);
            const unlocks = Object.assign({}, dbUnlocks, localUnlocks);

            if (mods.length > dbMods.length) {
                await saveModules(mods); // persists merged list to DB + cache
            }
            setInMemoryModules(mods);

            setInMemoryChat(msgs);
            localStorage.setItem(LS_CHAT, JSON.stringify(msgs));

            if (msgs.length > dbMsgs.length) {
                await persistChat(msgs);
            }

            localStorage.setItem(LS_ACHIEVEMENTS, JSON.stringify(unlocks));
            Object.keys(localUnlocks).forEach(key => {
                if (!dbUnlocks[key]) saveAchievementUnlock(key, localUnlocks[key]);
            });

            rerender();
        } catch (err) {
            console.error('[GradelyticsDB] failed to load from Supabase:', err);
            fallbackToLocal();
        }
    }

    function fallbackToLocal() {
        setInMemoryModules(readLocalArray(LS_MODULES));
        setInMemoryChat(readLocalArray(LS_CHAT));
        rerender();
    }

    /* ── Auth modal UI ── */

    function showAuthModal() {
        const modal = document.getElementById('auth-modal');
        if (!modal) return;
        modal.style.display = 'flex';
        document.body.classList.add('auth-locked');
    }

    function hideAuthModal() {
        const modal = document.getElementById('auth-modal');
        if (modal) modal.style.display = 'none';
        document.body.classList.remove('auth-locked');
    }

    function wireAuthModal() {
        const modal = document.getElementById('auth-modal');
        if (!modal) return;

        const tabs = modal.querySelectorAll('.auth-tab');
        const form = document.getElementById('auth-form');
        const emailInput = document.getElementById('auth-email');
        const passwordInput = document.getElementById('auth-password');
        const errorEl = document.getElementById('auth-error');
        const submitBtn = document.getElementById('auth-submit');
        const titleEl = document.getElementById('auth-title');
        const subtitleEl = document.getElementById('auth-subtitle');
        const localBtn = document.getElementById('auth-local');

        if (!form) return;

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

        tabs.forEach(tab => {
            tab.addEventListener('click', () => setMode(tab.dataset.mode));
        });

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
                    ? await signIn(email, password)
                    : await signUp(email, password);

                if (result.error) {
                    errorEl.textContent = result.error.message;
                    return;
                }
                if (mode === 'signup' && !result.session) {
                    errorEl.textContent = 'Check your inbox — we sent a confirmation link.';
                    return;
                }
                // Successful sign-in is handled by onAuthStateChange below.
            } catch (err) {
                errorEl.textContent = err.message || 'Something went wrong. Try again.';
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = mode === 'login' ? 'Sign In' : 'Create Account';
            }
        });

        if (localBtn) {
            localBtn.addEventListener('click', function () {
                hideAuthModal();
                fallbackToLocal();
            });
        }
    }

    function wireLogout() {
        const logoutBtn = document.getElementById('logout-btn');
        if (!logoutBtn) return;
        logoutBtn.addEventListener('click', async function () {
            if (!sb) {
                window.location.href = 'index.html';
                return;
            }
            await signOut();
            showAuthModal();
            fallbackToLocal();
        });
    }

    /* ── App bootstrap ── */

    async function initApp() {
        const hasConfig = init();
        wireAuthModal();
        wireLogout();

        if (!hasConfig) {
            fallbackToLocal();
            return;
        }

        onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN') {
                hideAuthModal();
                setAuthedUI(session);
                loadAllFromDB();
            } else if (event === 'SIGNED_OUT') {
                setInMemoryModules([]);
                setInMemoryChat([]);
                showAuthModal();
                fallbackToLocal();
            }
        });

        const { session } = await getSession();
        if (session) {
            hideAuthModal();
            setAuthedUI(session);
            await loadAllFromDB();
        } else {
            showAuthModal();
        }
    }

    document.addEventListener('DOMContentLoaded', initApp);

    /* ── Public API ── */

    window.GradelyticsDB = {
        init: init,
        isConfigured: isConfigured,
        getSession: getSession,
        getUserId: getUserId,
        signUp: signUp,
        signIn: signIn,
        signOut: signOut,
        onAuthStateChange: onAuthStateChange,
        loadModules: loadModules,
        saveModules: saveModules,
        loadChatMessages: loadChatMessages,
        addChatMessage: addChatMessage,
        clearChatMessages: clearChatMessages,
        loadAchievementUnlocks: loadAchievementUnlocks,
        saveAchievementUnlock: saveAchievementUnlock,
        getModules: getInMemoryModules
    };
})();
