/* ═══════════════════════════════════════════════════════════════════════════
   Gradelytics — Admin Console
   Sidebar-based management dashboard. Every request is gated server-side by
   the ADMIN_PASSWORD env var. Requires a stored admin credential (set when
   logging in as an admin from the app); otherwise it bounces to the app.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    let adminPassword = '';
    let stats = null;
    let currentUserId = null;

    // Apply the theme the app persists so light/dark stays consistent.
    try {
        const savedTheme = localStorage.getItem('gradelytics-theme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);
    } catch (e) { /* ignore */ }

    const ACHIEVEMENT_LABELS = {
        gold: 'Gold',
        silver: 'Silver',
        bronze: 'Bronze'
    };

    function isDark() {
        return document.documentElement.getAttribute('data-theme') === 'dark';
    }

    function chartTextColor() {
        return isDark() ? '#9CA3AF' : '#505768';
    }

    function chartGridColor() {
        return isDark() ? 'rgba(255,255,255,0.08)' : 'rgba(30,30,46,0.10)';
    }

    /* ── Helpers ── */

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function showStatus(text, kind) {
        const el = document.getElementById('admin-status');
        if (!el) return;
        el.textContent = text;
        el.className = 'admin-status' + (kind ? ' admin-status--' + kind : '');
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function formatDate(iso) {
        if (!iso) return '\u2014';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '\u2014';
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function initialsOf(u) {
        const name = (u && (u.display_name || u.email)) || '?';
        const parts = name.replace(/[^a-zA-Z0-9 ]/g, '').trim().split(/\s+/);
        return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
    }

    function average(modules) {
        if (!modules || !modules.length) return '\u2014';
        const total = modules.reduce((s, m) => s + (Number(m.mark) || 0), 0);
        return (total / modules.length).toFixed(1);
    }

    function closeModal(id) {
        const el = document.getElementById(id);
        if (el) el.hidden = true;
    }

    function findUser(id) {
        return ((stats && stats.users) || []).find(u => u.id === id) || null;
    }

    /* ── Auth ── */

    async function fetchJSON(url, options) {
        options = options || {};
        options.headers = Object.assign(
            { 'Authorization': 'Bearer ' + adminPassword },
            options.headers || {}
        );
        const res = await fetch(url, options);
        let json = null;
        try { json = await res.json(); } catch (e) { /* ignore */ }
        if (!res.ok) {
            const err = new Error((json && json.error) || ('Request failed: ' + res.status));
            err.status = res.status;
            throw err;
        }
        return json;
    }

    /* ── Views ── */

    function switchView(name, sidebarKey) {
        document.querySelectorAll('.view').forEach(v => {
            v.hidden = (v.id !== 'view-' + name);
        });
        const key = sidebarKey || name;
        document.querySelectorAll('.sidebar-link').forEach(l => {
            l.classList.toggle('active', l.dataset.view === key);
        });
    }

    /* ── Overview ── */

    async function loadOverview() {
        showStatus('Loading statistics...');
        try {
            stats = await fetchJSON('/api/admin-stats');
            setText('stat-users', stats.totalUsers);
            setText('stat-active', stats.activeUsers);
            setText('stat-modules', stats.totalModules);
            setText('stat-chat', stats.totalChatMessages);
            setText('stat-achievements', stats.totalAchievements);
            setText('stat-average', stats.overallAverage == null ? '\u2014' : stats.overallAverage + '%');
            setText('stat-grade', stats.mostCommonGrade || '\u2014');
            setText('stat-msg-active', stats.avgMessagesPerActiveUser || '0');
            renderChart(stats.signupsByDay || []);
            renderOverviewUsers((stats.users || [])
                .slice()
                .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
                .slice(0, 8));
            showStatus('');
        } catch (err) {
            showStatus(err.message, 'error');
        }
    }

    function renderOverviewUsers(list) {
        const tbody = document.getElementById('overview-users-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (!list.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted)">No users yet.</td></tr>';
            return;
        }
        list.forEach(u => {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            tr.addEventListener('click', () => openUserDetail(u.id));
            tr.innerHTML =
                '<td>' + userCell(u) + '</td>' +
                '<td>' + formatDate(u.created_at) + '</td>' +
                '<td>' + u.modules + '</td>' +
                '<td>' + u.chat_messages + '</td>' +
                '<td>' + u.achievements + '</td>' +
                '<td>' + statusBadge(u) + '</td>';
            tbody.appendChild(tr);
        });
    }

    /* ── Users list ── */

    async function loadUsers() {
        showStatus('Loading users...');
        try {
            stats = await fetchJSON('/api/admin-stats');
            renderUsers(document.getElementById('users-search').value);
            showStatus('');
        } catch (err) {
            showStatus(err.message, 'error');
        }
    }

    function renderUsers(filter) {
        const tbody = document.getElementById('users-table-body');
        if (!tbody) return;
        const list = (stats && stats.users) || [];
        const q = String(filter || '').trim().toLowerCase();
        const filtered = q
            ? list.filter(u =>
                (u.email || '').toLowerCase().includes(q) ||
                (u.display_name || '').toLowerCase().includes(q))
            : list;
        setText('users-count', filtered.length + ' of ' + list.length + ' users');
        tbody.innerHTML = '';

        if (!filtered.length) {
            tbody.innerHTML = '<tr><td colspan="8" style="color:var(--muted)">No matching users.</td></tr>';
            return;
        }

        filtered.forEach(u => {
            const tr = document.createElement('tr');
            tr.innerHTML =
                '<td>' + userCell(u) + '</td>' +
                '<td>' + escapeHtml(u.email) + '</td>' +
                '<td>' + formatDate(u.created_at) + '</td>' +
                '<td>' + u.modules + '</td>' +
                '<td>' + u.chat_messages + '</td>' +
                '<td>' + u.achievements + '</td>' +
                '<td>' + statusBadge(u) + '</td>' +
                '<td><div class="row-actions">' +
                '<button class="action-btn" data-action="view" data-id="' + u.id + '" title="View"><i class="bx bx-show"></i></button>' +
                '<button class="action-btn" data-action="edit" data-id="' + u.id + '" title="Edit"><i class="bx bx-pencil"></i></button>' +
                '<button class="action-btn action-btn--danger" data-action="delete" data-id="' + u.id + '" title="Delete"><i class="bx bx-trash"></i></button>' +
                '</div></td>';
            tbody.appendChild(tr);
        });
    }

    function userCell(u) {
        const name = (u.display_name || u.email || 'User');
        const sub = u.display_name ? escapeHtml(u.email) : '';
        return '<div class="user-cell">' +
            '<span class="user-avatar">' + escapeHtml(initialsOf(u)) + '</span>' +
            '<span class="user-cell-main">' +
            '<strong>' + escapeHtml(name) + '</strong>' +
            (sub ? '<span>' + sub + '</span>' : '') +
            '</span></div>';
    }

    function statusBadge(u) {
        return u.active
            ? '<span class="badge badge--active">Active</span>'
            : '<span class="badge">Inactive</span>';
    }

    /* ── User detail ── */

    async function openUserDetail(id) {
        currentUserId = id;
        switchView('user-detail', 'users');
        setText('detail-name', 'Loading\u2026');
        setText('detail-email', '');
        showStatus('Loading user...');
        try {
            const data = await fetchJSON('/api/admin-user?id=' + encodeURIComponent(id));
            const u = data.user;
            const name = u.display_name || (u.email || 'User');
            setText('detail-name', name);
            setText('detail-email', u.email || 'No email');
            setText('detail-stat-modules', data.modules.length);
            setText('detail-stat-chat', data.chat.length);
            setText('detail-stat-achievements', data.achievements.length);
            setText('detail-stat-average', average(data.modules));
            renderDetailModules(data.modules || []);
            renderDetailChat(data.chat || []);
            renderDetailAchievements(data.achievements || []);
            showStatus('');
        } catch (err) {
            showStatus(err.message, 'error');
        }
    }

    function renderDetailModules(modules) {
        const tbody = document.getElementById('detail-modules-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (!modules.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted)">No results recorded.</td></tr>';
            return;
        }
        modules.forEach(m => {
            const tr = document.createElement('tr');
            tr.innerHTML =
                '<td><strong>' + escapeHtml(m.name) + '</strong></td>' +
                '<td>' + escapeHtml(m.year == null ? '\u2014' : m.year) + '</td>' +
                '<td>' + escapeHtml(m.part == null ? '\u2014' : m.part) + '</td>' +
                '<td>' + escapeHtml(m.semester == null ? '\u2014' : m.semester) + '</td>' +
                '<td>' + escapeHtml(m.mark == null ? '\u2014' : m.mark) + '</td>' +
                '<td>' + escapeHtml(m.grade == null ? '\u2014' : m.grade) + '</td>';
            tbody.appendChild(tr);
        });
    }

    function renderDetailChat(chat) {
        const container = document.getElementById('detail-chat');
        if (!container) return;
        container.innerHTML = '';
        if (!chat.length) {
            container.innerHTML = '<div class="chat-empty">No messages.</div>';
            return;
        }
        chat.forEach(m => {
            const isUser = m.role === 'user';
            const bubble = document.createElement('div');
            bubble.className = 'chat-msg ' + (isUser ? 'chat-msg--user' : 'chat-msg--assistant');
            const time = m.created_at
                ? new Date(m.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                : '';
            bubble.innerHTML =
                '<span class="chat-msg-meta">' + (isUser ? 'User' : 'Assistant') + (time ? ' \u00b7 ' + time : '') + '</span>' +
                escapeHtml(m.content);
            container.appendChild(bubble);
        });
        container.scrollTop = container.scrollHeight;
    }

    function renderDetailAchievements(achievements) {
        const grid = document.getElementById('detail-achievements');
        if (!grid) return;
        grid.innerHTML = '';
        if (!achievements.length) {
            grid.innerHTML = '<div class="achievement-empty">No achievements unlocked.</div>';
            return;
        }
        achievements.forEach(a => {
            const label = ACHIEVEMENT_LABELS[a.unlock_key] || a.unlock_key;
            const chip = document.createElement('div');
            chip.className = 'achievement-chip';
            chip.innerHTML =
                '<i class="bx bx-trophy"></i>' +
                '<span>' + escapeHtml(label) + '</span>' +
                '<em>' + formatDate(a.unlocked_at) + '</em>';
            grid.appendChild(chip);
        });
    }

    /* ── Chart ── */

    let chart = null;

    function renderChart(rows) {
        const canvas = document.getElementById('admin-chart');
        if (!canvas) return;
        if (chart) chart.destroy();
        chart = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: rows.map(r => r.day.slice(5)),
                datasets: [{
                    label: 'New users',
                    data: rows.map(r => r.count),
                    backgroundColor: 'rgba(29, 111, 224, 0.55)',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: chartTextColor() }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { precision: 0, color: chartTextColor() },
                        grid: { color: chartGridColor() }
                    }
                }
            }
        });
    }

    /* ── Edit user ── */

    function openEditModal(id) {
        const u = findUser(id);
        document.getElementById('edit-user-id').value = id;
        document.getElementById('edit-display-name').value = (u && u.display_name) || '';
        document.getElementById('edit-email').value = (u && u.email) || '';
        document.getElementById('edit-password').value = '';
        document.getElementById('user-edit-error').textContent = '';
        document.getElementById('user-edit-modal').hidden = false;
        document.getElementById('edit-display-name').focus();
    }

    function openDeleteModal(id) {
        const u = findUser(id);
        document.getElementById('delete-user-name').textContent =
            (u && (u.display_name || u.email)) || 'this user';
        document.getElementById('delete-user-email').textContent = (u && u.email) || '';
        document.getElementById('user-delete-error').textContent = '';
        document.getElementById('user-delete-modal').dataset.id = id;
        document.getElementById('user-delete-modal').hidden = false;
    }

    async function refreshStats() {
        stats = await fetchJSON('/api/admin-stats');
    }

    /* ── Init ── */

    document.addEventListener('DOMContentLoaded', function () {
        try { adminPassword = sessionStorage.getItem('gradelytics_admin_password') || ''; } catch (e) { /* ignore */ }
        if (!adminPassword) {
            window.location.href = 'dashboard.html';
            return;
        }

        const sidebarLinks = document.querySelectorAll('.sidebar-link');
        sidebarLinks.forEach(link => {
            link.addEventListener('click', function (e) {
                e.preventDefault();
                const view = link.dataset.view;
                switchView(view);
                if (view === 'users') loadUsers();
                if (view === 'overview') loadOverview();
            });
        });

        document.querySelectorAll('[data-goto]').forEach(el => {
            el.addEventListener('click', function (e) {
                e.preventDefault();
                const view = el.dataset.goto;
                switchView(view);
                if (view === 'users') loadUsers();
            });
        });

        document.getElementById('overview-refresh').addEventListener('click', loadOverview);
        document.getElementById('users-refresh').addEventListener('click', loadUsers);

        const searchInput = document.getElementById('users-search');
        searchInput.addEventListener('input', function () {
            renderUsers(searchInput.value);
        });

        document.getElementById('users-table-body').addEventListener('click', function (e) {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const id = btn.dataset.id;
            if (btn.dataset.action === 'view') openUserDetail(id);
            if (btn.dataset.action === 'edit') openEditModal(id);
            if (btn.dataset.action === 'delete') openDeleteModal(id);
        });

        document.getElementById('detail-back').addEventListener('click', function () {
            currentUserId = null;
            switchView('users');
            renderUsers(searchInput.value);
        });

        document.getElementById('detail-edit').addEventListener('click', function () {
            if (currentUserId) openEditModal(currentUserId);
        });

        document.getElementById('detail-delete').addEventListener('click', function () {
            if (currentUserId) openDeleteModal(currentUserId);
        });

        /* Edit form */
        const editForm = document.getElementById('user-edit-form');
        editForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            const id = document.getElementById('edit-user-id').value;
            const errorEl = document.getElementById('user-edit-error');
            const submitBtn = editForm.querySelector('button[type="submit"]');
            errorEl.textContent = '';

            const payload = { id };
            const name = document.getElementById('edit-display-name').value.trim();
            const email = document.getElementById('edit-email').value.trim();
            const password = document.getElementById('edit-password').value;
            if (name) payload.display_name = name;
            if (email) payload.email = email;
            if (password) payload.password = password;

            submitBtn.disabled = true;
            try {
                await fetchJSON('/api/admin-user?id=' + encodeURIComponent(id), {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                await refreshStats();
                closeModal('user-edit-modal');
                renderUsers(searchInput.value);
                if (currentUserId === id) openUserDetail(id);
                showStatus('User updated.');
            } catch (err) {
                errorEl.textContent = err.message;
            } finally {
                submitBtn.disabled = false;
            }
        });

        /* Delete form */
        const deleteModal = document.getElementById('user-delete-modal');
        document.getElementById('user-delete-confirm').addEventListener('click', async function () {
            const id = deleteModal.dataset.id;
            const errorEl = document.getElementById('user-delete-error');
            const confirmBtn = document.getElementById('user-delete-confirm');
            errorEl.textContent = '';
            confirmBtn.disabled = true;
            try {
                await fetchJSON('/api/admin-user?id=' + encodeURIComponent(id), { method: 'DELETE' });
                await refreshStats();
                closeModal('user-delete-modal');
                if (currentUserId === id) {
                    currentUserId = null;
                    switchView('users');
                }
                renderUsers(searchInput.value);
                showStatus('User deleted.');
            } catch (err) {
                errorEl.textContent = err.message;
            } finally {
                confirmBtn.disabled = false;
            }
        });

        /* Close modals */
        document.querySelectorAll('[data-close-modal]').forEach(btn => {
            btn.addEventListener('click', function () {
                closeModal(btn.dataset.closeModal);
            });
        });
        document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
            backdrop.addEventListener('click', function (e) {
                if (e.target === backdrop) backdrop.hidden = true;
            });
        });

        document.getElementById('admin-lock').addEventListener('click', function () {
            try { sessionStorage.removeItem('gradelytics_admin_password'); } catch (e) { /* ignore */ }
            window.location.href = 'dashboard.html';
        });

        /* Theme toggle — mirrors the app's light/dark switcher */
        const themeToggle = document.getElementById('admin-theme-toggle');
        if (themeToggle) {
            const updateThemeToggle = function () {
                const icon = themeToggle.querySelector('i');
                if (icon) icon.className = isDark() ? 'bx bx-sun' : 'bx bx-moon';
            };
            updateThemeToggle();
            themeToggle.addEventListener('click', function () {
                const next = isDark() ? 'light' : 'dark';
                document.documentElement.setAttribute('data-theme', next);
                try { localStorage.setItem('gradelytics-theme', next); } catch (e) { /* ignore */ }
                updateThemeToggle();
                renderChart(stats ? stats.signupsByDay || [] : []);
            });
        }

        switchView('overview');
        loadOverview();
    });
})();
