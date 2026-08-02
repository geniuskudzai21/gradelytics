/* ═══════════════════════════════════════════════════════════════════════════
   Gradelytics — Admin dashboard
   Loads aggregate user statistics from /api/admin-stats (server-side, gated by
   the ADMIN_PASSWORD env var) and renders them on the page.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    let adminPassword = '';

    function persistPassword() {
        try { sessionStorage.setItem('gradelytics_admin_password', adminPassword); } catch (e) { /* ignore */ }
    }

    function clearPassword() {
        try { sessionStorage.removeItem('gradelytics_admin_password'); } catch (e) { /* ignore */ }
    }

    function statusEl() {
        return document.getElementById('admin-status');
    }

    function showStatus(text, kind) {
        const el = statusEl();
        if (!el) return;
        el.textContent = text;
        el.className = 'admin-status' + (kind ? ' admin-status--' + kind : '');
    }

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function showLogin() {
        const login = document.getElementById('admin-login');
        const content = document.getElementById('admin-content');
        const input = document.getElementById('admin-password-input');
        const loginError = document.getElementById('admin-login-error');
        adminPassword = '';
        clearPassword();
        if (login) login.hidden = false;
        if (content) content.hidden = true;
        if (loginError) loginError.textContent = '';
        if (input) {
            input.value = '';
            input.focus();
        }
        showStatus('');
    }

    function showContent() {
        const login = document.getElementById('admin-login');
        const content = document.getElementById('admin-content');
        if (login) login.hidden = true;
        if (content) content.hidden = false;
    }

    async function load() {
        if (!adminPassword) return;
        showStatus('Loading statistics...');
        try {
            const res = await fetch('/api/admin-stats', {
                headers: { 'Authorization': 'Bearer ' + adminPassword }
            });
            const json = await res.json();
            if (res.status === 401 || res.status === 403) {
                showLogin();
                const loginError = document.getElementById('admin-login-error');
                if (loginError) loginError.textContent = 'Access denied. Invalid admin password.';
                return;
            }
            if (!res.ok) {
                showStatus(json.error || 'Failed to load statistics.', 'error');
                return;
            }
            render(json);
            showStatus('');
            showContent();
            persistPassword();
        } catch (err) {
            showStatus('Could not reach the statistics endpoint. Is the server running?', 'error');
        }
    }

    function render(data) {
        setText('stat-users', data.totalUsers);
        setText('stat-active', data.activeUsers);
        setText('stat-modules', data.totalModules);
        setText('stat-chat', data.totalChatMessages);
        setText('stat-achievements', data.totalAchievements);
        renderChart(data.signupsByDay || []);
        renderTable(data.users || []);
    }

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
                    y: { beginAtZero: true, ticks: { precision: 0 } }
                }
            }
        });
    }

    function renderTable(users) {
        const tbody = document.querySelector('#admin-users-table tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        users.forEach(u => {
            const tr = document.createElement('tr');
            const joined = u.created_at ? new Date(u.created_at).toLocaleDateString() : '\u2014';
            const status = u.active
                ? '<span class="badge badge--active">Active</span>'
                : '<span class="badge">Inactive</span>';
            tr.innerHTML =
                '<td>' + escapeHtml(u.email) + '</td>' +
                '<td>' + joined + '</td>' +
                '<td>' + u.modules + '</td>' +
                '<td>' + u.chat_messages + '</td>' +
                '<td>' + u.achievements + '</td>' +
                '<td>' + status + '</td>';
            tbody.appendChild(tr);
        });
    }

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    document.addEventListener('DOMContentLoaded', function () {
        const refreshBtn = document.getElementById('admin-refresh');
        const lockBtn = document.getElementById('admin-lock');
        const form = document.getElementById('admin-login-form');

        if (refreshBtn) refreshBtn.addEventListener('click', load);

        if (lockBtn) lockBtn.addEventListener('click', showLogin);

        if (form) {
            form.addEventListener('submit', async function (e) {
                e.preventDefault();
                const input = document.getElementById('admin-password-input');
                if (!input || !input.value) return;
                adminPassword = input.value;
                await load();
            });
        }

        // If the user already logged in as admin from the app, unlock directly.
        let stored = null;
        try { stored = sessionStorage.getItem('gradelytics_admin_password'); } catch (e) { /* ignore */ }
        if (stored) {
            adminPassword = stored;
            load();
        } else {
            showLogin();
        }
    });
})();
