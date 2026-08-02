/* ═══════════════════════════════════════════════════════════════════════════
   Gradelytics — Admin dashboard
   Loads aggregate user statistics from /api/admin-stats (server-side, gated by
   the ADMIN_EMAILS env var) and renders them on the page.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    const cfg = window.GRADELYTICS_SUPABASE || {};
    let client = null;

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

    async function load() {
        showStatus('Loading statistics...');
        const content = document.getElementById('admin-content');
        if (content) content.hidden = true;

        const { data, error } = await client.auth.getSession();
        if (error || !data.session) {
            showStatus('You must be signed in to view admin statistics. Sign in on the app first.', 'warn');
            return;
        }

        try {
            const res = await fetch('/api/admin-stats', {
                headers: { 'Authorization': 'Bearer ' + data.session.access_token }
            });
            const json = await res.json();
            if (!res.ok) {
                if (res.status === 403) {
                    showStatus('Access denied. Your account is not an admin.', 'error');
                } else {
                    showStatus(json.error || 'Failed to load statistics.', 'error');
                }
                return;
            }
            render(json);
            showStatus('');
            if (content) content.hidden = false;
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
        const signoutBtn = document.getElementById('admin-signout');

        if (refreshBtn) refreshBtn.addEventListener('click', load);

        if (signoutBtn) {
            signoutBtn.addEventListener('click', async function () {
                if (client) {
                    try { await client.auth.signOut(); } catch (e) { /* ignore */ }
                }
                window.location.href = 'dashboard.html';
            });
        }

        if (!cfg.url || !cfg.anonKey || cfg.anonKey.indexOf('YOUR_SUPABASE') !== -1) {
            showStatus('Admin dashboard is not configured.', 'error');
            return;
        }

        client = supabase.createClient(cfg.url, cfg.anonKey);
        load();
    });
})();
