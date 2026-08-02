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

    let sb = null;
    let configured = false;
    let currentDisplayName = 'Genius';
    let currentUserId = null;
    let resetAuthFormMode = null;

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
        localStorage.removeItem(cacheKey(LS_MODULES));
        localStorage.removeItem(cacheKey(LS_CHAT));
        localStorage.removeItem(cacheKey(LS_ACHIEVEMENTS));
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
        let query = sb.from('modules').select('id, name, year, part, semester, mark, grade');
        if (userId) query = query.eq('user_id', userId);
        const { data, error } = await query.order('created_at', { ascending: true });
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
        localStorage.setItem(cacheKey(LS_MODULES), JSON.stringify(list));
        return list;
    }

    /* Full reconciliation: delete the user's rows, then reinsert. Simple and
       always correct for the small datasets this app deals with. */
    async function saveModules(list) {
        localStorage.setItem(cacheKey(LS_MODULES), JSON.stringify(list));
        if (!sb) return;

        const userId = await getUserId();
        if (!userId) return;

        const { error: delError } = await sb.from('modules').delete().eq('user_id', userId);
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
            return JSON.parse(localStorage.getItem(cacheKey(LS_CHAT)) || '[]');
        }
        const userId = await getUserId();
        let query = sb.from('chat_messages').select('role, content');
        if (userId) query = query.eq('user_id', userId);
        const { data, error } = await query.order('created_at', { ascending: true });
        if (error) throw error;
        const list = (data || []).map(m => ({ role: m.role, content: m.content }));
        localStorage.setItem(cacheKey(LS_CHAT), JSON.stringify(list));
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
        let query = sb.from('achievement_unlocks').select('unlock_key, unlocked_at');
        if (userId) query = query.eq('user_id', userId);
        const { data, error } = await query.order('created_at', { ascending: true });
        if (error) throw error;

        const state = {};
        (data || []).forEach(row => {
            state[row.unlock_key] = row.unlocked_at;
        });
        localStorage.setItem(cacheKey(LS_ACHIEVEMENTS), JSON.stringify(state));
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
        return readLocalArray(cacheKey(LS_MODULES));
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
        await sb.from('chat_messages').delete().eq('user_id', userId);
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

    function renderDisplayName() {
        const el = document.getElementById('sidebar-username');
        if (el) el.innerHTML = `<i class='bx bx-user-circle'></i> ${currentDisplayName}`;
        const settingsName = document.getElementById('settings-display-name');
        if (settingsName) settingsName.value = currentDisplayName;
    }

    function setAuthedUI(session) {
        currentUserId = session && session.user ? session.user.id : null;
        const email = session && session.user ? session.user.email : '';
        const metaName = session && session.user && session.user.user_metadata
            ? session.user.user_metadata.display_name
            : '';
        const derived = email ? email.split('@')[0] : '';
        const rawName = (metaName && metaName.trim()) ? metaName : derived;
        const parts = rawName.replace(/[^a-zA-Z0-9 ]/g, '').trim();
        currentDisplayName = parts ? parts.charAt(0).toUpperCase() + parts.slice(1) : 'Genius';
        renderDisplayName();
        const greeting = document.getElementById('welcome-greeting');
        if (greeting && currentDisplayName !== 'Genius') {
            greeting.textContent = greeting.textContent.replace(/,\s*[^,]*$/, '') + `, ${currentDisplayName}`;
        }
        const settingsEmail = document.getElementById('settings-email');
        if (settingsEmail) settingsEmail.value = email;
    }

    function getDisplayName() {
        return currentDisplayName;
    }

    async function loadAllFromDB() {
        try {
            const [dbMods, dbMsgs, dbUnlocks] = await Promise.all([
                loadModules(),
                loadChatMessages(),
                loadAchievementUnlocks()
            ]);

            // Read this user's own scoped cache (data from a previous session
            // on this browser). It can only ever contain this user's rows.
            let localMods = readLocalArray(cacheKey(LS_MODULES));
            let localMsgs = readLocalArray(cacheKey(LS_CHAT));
            let localUnlocks = {};
            try {
                localUnlocks = JSON.parse(localStorage.getItem(cacheKey(LS_ACHIEVEMENTS)) || '{}');
            } catch (e) { /* ignore corrupt cache */ }

            // First sign-in migration: adopt the shared pre-account (offline)
            // cache ONLY when this account is brand new (no cloud data) and has
            // no scoped cache yet, then clear the shared keys so they can never
            // be re-uploaded into another user's account later.
            const isNewAccount = dbMods.length === 0 && dbMsgs.length === 0 && Object.keys(dbUnlocks).length === 0;
            const hasUserCache = localMods.length > 0 || localMsgs.length > 0 || Object.keys(localUnlocks).length > 0;
            if (currentUserId && isNewAccount && !hasUserCache) {
                const preMods = readLocalArray(LS_MODULES);
                const preMsgs = readLocalArray(LS_CHAT);
                let preUnlocks = {};
                try {
                    preUnlocks = JSON.parse(localStorage.getItem(LS_ACHIEVEMENTS) || '{}');
                } catch (e) { /* ignore corrupt cache */ }

                if (preMods.length || preMsgs.length || Object.keys(preUnlocks).length) {
                    localMods = preMods;
                    localMsgs = preMsgs;
                    localUnlocks = preUnlocks;
                    localStorage.removeItem(LS_MODULES);
                    localStorage.removeItem(LS_CHAT);
                    localStorage.removeItem(LS_ACHIEVEMENTS);
                }
            }

            const mods = mergeModules(dbMods, localMods);
            const msgs = mergeChat(dbMsgs, localMsgs);
            const unlocks = Object.assign({}, dbUnlocks, localUnlocks);

            if (mods.length > dbMods.length) {
                await saveModules(mods); // persists merged list to DB + cache
            }
            setInMemoryModules(mods);

            setInMemoryChat(msgs);
            localStorage.setItem(cacheKey(LS_CHAT), JSON.stringify(msgs));

            if (msgs.length > dbMsgs.length) {
                await persistChat(msgs);
            }

            localStorage.setItem(cacheKey(LS_ACHIEVEMENTS), JSON.stringify(unlocks));
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
        setInMemoryModules(readLocalArray(cacheKey(LS_MODULES)));
        setInMemoryChat(readLocalArray(cacheKey(LS_CHAT)));
        rerender();
    }

    /* ── Auth modal UI ── */

    function showAuthModal() {
        const modal = document.getElementById('auth-modal');
        if (!modal) return;
        modal.style.display = 'flex';
        document.body.classList.add('auth-locked');
        // Clear any leftover credentials so a signed-out user's login
        // information is never left visible on the auth form.
        const emailInput = document.getElementById('auth-email');
        const passwordInput = document.getElementById('auth-password');
        if (emailInput) emailInput.value = '';
        if (passwordInput) passwordInput.value = '';
        if (typeof resetAuthFormMode === 'function') resetAuthFormMode();
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

        if (!form) return;

        let mode = 'login';
        resetAuthFormMode = () => setMode('login');

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
                    window.location.href = 'index.html';
                    return;
                }
                await signOut();
                showAuthModal();
                fallbackToLocal();
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
                    window.location.href = 'index.html';
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
        wireAuthModal();
        wireLogout();
        wireSettings();

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
                currentDisplayName = 'Genius';
                clearUserCache();
                currentUserId = null;
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
        getDisplayName: getDisplayName,
        getCacheKey: cacheKey,
        signUp: signUp,
        signIn: signIn,
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
        getModules: getInMemoryModules
    };
})();
