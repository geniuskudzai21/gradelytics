/* ═══════════════════════════════════════════════════════════════════════════
   Gradelytics — Admin Console
   Sidebar-based monitoring & management dashboard. Every request is gated
   server-side by the ADMIN_PASSWORD env var. Requires a stored admin credential
   (set when logging in as an admin from the app); otherwise it bounces to the
   app.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    let adminPassword = '';
    let stats = null;
    let currentUserId = null;
    let currentView = 'overview';
    let signupPeriod = 30;
    let autoRefreshTimer = null;

    /* ── Theme ── */
    try {
        const savedTheme = localStorage.getItem('gradelytics-theme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);
    } catch (e) { /* ignore */ }

    const ACHIEVEMENT_LABELS = {
        gold: 'Gold',
        silver: 'Silver',
        bronze: 'Bronze',
        best_semester: 'Best Semester Ever',
        super_distinction: 'Super Distinction',
        highest_mark: 'Highest Module Mark',
        perfect_semester: 'Perfect Semester',
        elite_scholar: 'Elite Scholar'
    };

    const VIEW_META = {
        overview: { title: 'Overview', subtitle: 'High-level health and activity across your platform.' },
        analytics: { title: 'Analytics', subtitle: 'Deep-dive into engagement, results and growth trends.' },
        users: { title: 'Users', subtitle: 'Browse, inspect, edit and remove accounts.' },
        'user-detail': { title: 'User details', subtitle: '' }
    };

    const loaders = {};

    /* ── Chart theme helpers ── */

    function isDark() {
        return document.documentElement.getAttribute('data-theme') === 'dark';
    }

    function chartTextColor() {
        return isDark() ? '#9CA3AF' : '#505768';
    }

    function chartGridColor() {
        return isDark() ? 'rgba(255,255,255,0.08)' : 'rgba(30,30,46,0.10)';
    }

    function chartPanelBg() {
        return isDark() ? '#14171A' : '#B8BEC6';
    }

    function tooltipTheme() {
        return {
            backgroundColor: isDark() ? '#1A1D21' : '#FFFFFF',
            titleColor: isDark() ? '#E2E5EA' : '#0F1217',
            bodyColor: isDark() ? '#9CA3AF' : '#23272F',
            borderColor: isDark() ? 'rgba(255,255,255,0.12)' : 'rgba(30,30,46,0.15)',
            borderWidth: 1,
            padding: 10
        };
    }

    const PALETTE = ['#1D6FE0', '#14C9AE', '#22A64C', '#F0A83D', '#8B95A3', '#DC2626', '#B07AE0', '#E07A9C', '#7AB8E0', '#4E7A6B'];

    function colorFor(label) {
        let h = 0;
        const s = String(label);
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        return PALETTE[h % PALETTE.length];
    }

    function gradeColor(g) {
        const key = String(g).trim();
        const map = {
            '1': '#22A64C',
            '2.1': '#14C9AE',
            '2.2': '#1D6FE0',
            '3': '#F0A83D',
            'Distinction': '#22A64C',
            'Merit': '#14C9AE',
            'Pass': '#1D6FE0',
            'Fail': '#DC2626'
        };
        return map[key] || colorFor(key);
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

    function fmt(n) {
        if (n == null || isNaN(Number(n))) return '\u2014';
        return Number(n).toLocaleString('en-GB');
    }

    function shortDay(iso) {
        return String(iso || '').slice(5);
    }

    function trimLabel(name, max) {
        const s = String(name == null ? '' : name);
        const len = max || 24;
        return s.length > len ? s.slice(0, len - 1) + '\u2026' : s;
    }

    function closeModal(id) {
        const el = document.getElementById(id);
        if (el) el.hidden = true;
    }

    function findUser(id) {
        return ((stats && stats.users) || []).find(u => u.id === id) || null;
    }

    function cumulative(arr) {
        let acc = 0;
        return (arr || []).map(x => { acc += x; return acc; });
    }

    function seriesData(key) {
        return (stats && stats.series && stats.series[key]) || [];
    }

    function sliceSeries(key, days) {
        return seriesData(key).slice(-(days || 30));
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

    async function fetchStats() {
        showStatus('Loading data\u2026');
        try {
            stats = await fetchJSON('/api/admin-stats');
            setLastUpdated();
            showStatus('');
            return stats;
        } catch (err) {
            showStatus(err.message, 'error');
            return null;
        }
    }

    function setLastUpdated() {
        if (!stats || !stats.generatedAt) return;
        const el = document.getElementById('last-updated');
        if (el) el.textContent = 'Updated ' + new Date(stats.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    }

    /* ── Views ── */

    function switchView(name, sidebarKey) {
        currentView = name;
        document.querySelectorAll('.view').forEach(v => {
            v.hidden = (v.id !== 'view-' + name);
        });
        const key = sidebarKey || name;
        document.querySelectorAll('.sidebar-link').forEach(l => {
            l.classList.toggle('active', l.dataset.view === key);
        });
        const meta = VIEW_META[name];
        if (meta) {
            setText('page-title', meta.title);
            setText('page-subtitle', meta.subtitle);
        }
        destroyAllCharts();
        const loader = loaders[name];
        if (loader) loader();
    }

    function refreshCurrent() {
        const loader = loaders[currentView];
        if (loader) loader();
    }

    function renderCurrent() {
        if (!stats) return;
        if (currentView === 'overview') {
            renderKPIs();
            renderSignups();
            renderActivity();
            renderGrade();
            renderModules();
            renderOverviewUsers((stats.users || []).slice()
                .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
                .slice(0, 8));
        } else if (currentView === 'analytics') {
            renderInsights();
            renderAvgYear();
            renderAchievements();
            renderGradeDetail();
            renderGrowth();
        } else if (currentView === 'users') {
            const search = document.getElementById('users-search');
            renderUsers(search ? search.value : '');
        }
    }

    loaders.overview = async function () {
        if (await fetchStats()) renderCurrent();
    };
    loaders.analytics = async function () {
        if (await fetchStats()) renderCurrent();
    };
    loaders.users = async function () {
        if (await fetchStats()) renderCurrent();
    };

    /* ── Charts ── */

    const charts = {};

    function makeChart(id, config) {
        const canvas = document.getElementById(id);
        if (!canvas) return;
        if (charts[id]) {
            try { charts[id].destroy(); } catch (e) { /* ignore */ }
            delete charts[id];
        }
        charts[id] = new Chart(canvas.getContext('2d'), config);
    }

    function destroyAllCharts() {
        Object.keys(charts).forEach(id => {
            try { charts[id].destroy(); } catch (e) { /* ignore */ }
            delete charts[id];
        });
    }

    function baseOptions(extra) {
        extra = extra || {};
        const o = {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: extra.legend
                    ? { position: 'top', labels: { color: chartTextColor(), boxWidth: 10, usePointStyle: true, padding: 12 } }
                    : { display: false },
                tooltip: tooltipTheme()
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: chartTextColor(), maxTicksLimit: 12, maxRotation: 0 }
                },
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0, color: chartTextColor() },
                    grid: { color: chartGridColor() }
                }
            }
        };
        if (extra.y2) {
            o.scales.y1 = {
                beginAtZero: true,
                position: 'right',
                ticks: { precision: 0, color: chartTextColor() },
                grid: { drawOnChartArea: false }
            };
        }
        return o;
    }

    function horizontalOptions() {
        return {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: tooltipTheme()
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: { precision: 0, color: chartTextColor() },
                    grid: { color: chartGridColor() }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: chartTextColor(), font: { size: 11 } }
                }
            }
        };
    }

    function doughnutOptions() {
        return {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '62%',
            plugins: {
                legend: {
                    position: 'right',
                    labels: { color: chartTextColor(), boxWidth: 10, usePointStyle: true, padding: 10 }
                },
                tooltip: tooltipTheme()
            }
        };
    }

    function doughnutBorder() {
        return chartPanelBg();
    }

    /* ── KPI cards ── */

    function deltaChip(delta) {
        const d = Number(delta) || 0;
        const icon = d > 0 ? 'bx-trending-up' : (d < 0 ? 'bx-trending-down' : 'bx-minus');
        const cls = d > 0 ? 'kpi-chip--up' : (d < 0 ? 'kpi-chip--down' : '');
        return '<span class="kpi-chip ' + cls + '"><i class="bx ' + icon + '"></i>' + (d > 0 ? '+' : '') + d + '%</span>';
    }

    function renderKPIs() {
        const grid = document.getElementById('kpi-grid');
        if (!grid || !stats) return;
        const t = stats.trends || {};
        const signups = seriesData('signups').map(r => r.count);
        const modulesS = seriesData('modules').map(r => r.count);
        const messagesS = seriesData('messages').map(r => r.count);
        const avgYears = (stats.averageMarkByYear || []).map(y => y.average);

        const cards = [
            {
                id: 'users',
                icon: 'bxs-user-account',
                label: 'Total Users',
                value: fmt(stats.totalUsers),
                delta: deltaChip(t.users7dDelta),
                sub: (t.users7d != null ? t.users7d : 0) + ' new this week',
                spark: signups,
                color: '#1D6FE0'
            },
            {
                id: 'active',
                icon: 'bx-user-check',
                label: 'Active Users',
                value: fmt(stats.activeUsers),
                delta: '<span class="kpi-chip kpi-chip--neutral">' + (stats.activeUserPct || 0) + '%</span>',
                sub: 'of all accounts are engaged',
                spark: messagesS,
                color: '#14C9AE'
            },
            {
                id: 'newusers',
                icon: 'bx-user-plus',
                label: 'New Users (30d)',
                value: fmt(t.users30d),
                delta: deltaChip(t.users30dDelta),
                sub: 'vs previous 30 days',
                spark: signups,
                color: '#22A64C'
            },
            {
                id: 'modules',
                icon: 'bx-book',
                label: 'Modules',
                value: fmt(stats.totalModules),
                delta: deltaChip(t.modules7dDelta),
                sub: (t.modules7d != null ? t.modules7d : 0) + ' added this week',
                spark: modulesS,
                color: '#1D6FE0'
            },
            {
                id: 'chat',
                icon: 'bx-chat',
                label: 'Chat Messages',
                value: fmt(stats.totalChatMessages),
                delta: deltaChip(t.messages7dDelta),
                sub: (t.messages7d != null ? t.messages7d : 0) + ' this week',
                spark: messagesS,
                color: '#14C9AE'
            },
            {
                id: 'average',
                icon: 'bx-target-lock',
                label: 'Average Mark',
                value: stats.overallAverage == null ? '\u2014' : stats.overallAverage + '%',
                delta: stats.mostCommonGrade
                    ? '<span class="kpi-chip kpi-chip--neutral">Grade ' + escapeHtml(stats.mostCommonGrade) + '</span>'
                    : '',
                sub: 'across ' + fmt(stats.totalModules) + ' module records',
                spark: avgYears,
                color: '#F0A83D'
            }
        ];

        grid.innerHTML = cards.map(c => '' +
            '<div class="kpi-card">' +
                '<div class="kpi-head">' +
                    '<span class="kpi-icon"><i class="bx ' + c.icon + '"></i></span>' +
                    '<span class="kpi-label">' + c.label + '</span>' +
                '</div>' +
                '<div class="kpi-value-row">' +
                    '<strong class="kpi-value" id="kpi-value-' + c.id + '">' + c.value + '</strong>' +
                    (c.delta ? c.delta : '') +
                '</div>' +
                '<div class="kpi-spark"><canvas id="spark-' + c.id + '"></canvas></div>' +
                '<span class="kpi-sub">' + c.sub + '</span>' +
            '</div>'
        ).join('');

        cards.forEach(c => {
            if (c.spark && c.spark.length) renderSpark('spark-' + c.id, c.spark, c.color);
        });
    }

    function renderSpark(id, data, color) {
        makeChart(id, {
            type: 'line',
            data: {
                labels: data.map((_, i) => i),
                datasets: [{
                    data,
                    borderColor: color,
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.4,
                    fill: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                scales: { x: { display: false }, y: { display: false, beginAtZero: true } },
                elements: { point: { radius: 0 } }
            }
        });
    }

    /* ── Overview charts ── */

    function renderSignups() {
        if (!stats) return;
        const rows = sliceSeries('signups', signupPeriod);
        const labels = rows.map(r => shortDay(r.day));
        const counts = rows.map(r => r.count);
        const cum = cumulative(counts);
        makeChart('chart-signups', {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        type: 'bar',
                        label: 'New users',
                        data: counts,
                        backgroundColor: 'rgba(29,111,224,0.55)',
                        borderRadius: 3,
                        maxBarThickness: 18,
                        yAxisID: 'y'
                    },
                    {
                        type: 'line',
                        label: 'Cumulative',
                        data: cum,
                        borderColor: '#14C9AE',
                        backgroundColor: isDark() ? 'rgba(20,201,174,0.12)' : 'rgba(20,201,174,0.10)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        borderWidth: 2,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: baseOptions({ legend: true, y2: true })
        });
    }

    function renderActivity() {
        if (!stats) return;
        const rows = sliceSeries('modules', 30);
        const labels = rows.map(r => shortDay(r.day));
        const modules = rows.map(r => r.count);
        const messages = sliceSeries('messages', 30).map(r => r.count);
        makeChart('chart-activity', {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        type: 'bar',
                        label: 'Modules added',
                        data: modules,
                        backgroundColor: 'rgba(29,111,224,0.55)',
                        borderRadius: 3,
                        maxBarThickness: 14,
                        yAxisID: 'y'
                    },
                    {
                        type: 'line',
                        label: 'Chat messages',
                        data: messages,
                        borderColor: '#14C9AE',
                        tension: 0.35,
                        pointRadius: 0,
                        borderWidth: 2,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: baseOptions({ legend: true, y2: true })
        });
    }

    function renderGrade() {
        if (!stats) return;
        const dist = stats.gradeDistribution || {};
        const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
        makeChart('chart-grade', {
            type: 'doughnut',
            data: {
                labels: entries.map(e => e[0]),
                datasets: [{
                    data: entries.map(e => e[1]),
                    backgroundColor: entries.map(e => gradeColor(e[0])),
                    borderColor: doughnutBorder(),
                    borderWidth: 2
                }]
            },
            options: doughnutOptions()
        });
    }

    function renderModules() {
        if (!stats) return;
        const list = (stats.topModules || []).slice().reverse();
        makeChart('chart-modules', {
            type: 'bar',
            data: {
                labels: list.map(m => trimLabel(m.name, 22)),
                datasets: [{
                    label: 'Records',
                    data: list.map(m => m.count),
                    backgroundColor: 'rgba(29,111,224,0.65)',
                    borderRadius: 4,
                    maxBarThickness: 16
                }]
            },
            options: horizontalOptions()
        });
    }

    /* ── Analytics ── */

    function renderInsights() {
        const row = document.getElementById('insight-row');
        if (!row || !stats) return;
        const items = [
            { icon: 'bx-trophy', label: 'Most common grade', value: stats.mostCommonGrade || '\u2014' },
            { icon: 'bx-target-lock', label: 'Overall average', value: stats.overallAverage == null ? '\u2014' : stats.overallAverage + '%' },
            { icon: 'bx-chat', label: 'Messages / active user', value: stats.avgMessagesPerActiveUser || '0' },
            { icon: 'bx-user-plus', label: 'New users (30d)', value: fmt((stats.trends || {}).users30d) },
            { icon: 'bx-user-check', label: 'Engagement', value: (stats.activeUserPct || 0) + '%' },
            { icon: 'bx-medal', label: 'Achievements', value: fmt(stats.totalAchievements) }
        ];
        row.innerHTML = items.map(i => '' +
            '<div class="insight-card">' +
                '<span class="insight-icon"><i class="bx ' + i.icon + '"></i></span>' +
                '<div class="insight-body">' +
                    '<span class="insight-label">' + i.label + '</span>' +
                    '<strong class="insight-value">' + i.value + '</strong>' +
                '</div>' +
            '</div>'
        ).join('');
    }

    function renderAvgYear() {
        if (!stats) return;
        const list = stats.averageMarkByYear || [];
        makeChart('chart-avg-year', {
            type: 'bar',
            data: {
                labels: list.map(y => y.year),
                datasets: [{
                    label: 'Average mark %',
                    data: list.map(y => y.average),
                    backgroundColor: list.map(y => {
                        const v = y.average;
                        return v >= 80 ? 'rgba(34,166,76,0.75)' : (v >= 65 ? 'rgba(20,201,174,0.75)' : (v >= 50 ? 'rgba(29,111,224,0.75)' : 'rgba(220,38,38,0.65)'));
                    }),
                    borderRadius: 4,
                    maxBarThickness: 42
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: Object.assign(tooltipTheme(), {
                        callbacks: {
                            afterBody: function (items) {
                                const i = items && items[0] && items[0].dataIndex;
                                const row = list[i];
                                return row ? 'Based on ' + row.count + ' module record' + (row.count === 1 ? '' : 's') : '';
                            }
                        }
                    })
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: chartTextColor() }
                    },
                    y: {
                        beginAtZero: true,
                        suggestedMax: 100,
                        ticks: { precision: 0, color: chartTextColor(), callback: function (v) { return v + '%'; } },
                        grid: { color: chartGridColor() }
                    }
                }
            }
        });
    }

    function renderAchievements() {
        if (!stats) return;
        const breakdown = stats.achievementBreakdown || {};
        const keys = Object.keys(breakdown).sort((a, b) => breakdown[b] - breakdown[a]);
        makeChart('chart-achievements', {
            type: 'doughnut',
            data: {
                labels: keys.map(k => ACHIEVEMENT_LABELS[k] || k),
                datasets: [{
                    data: keys.map(k => breakdown[k]),
                    backgroundColor: keys.map(k => colorFor(ACHIEVEMENT_LABELS[k] || k)),
                    borderColor: doughnutBorder(),
                    borderWidth: 2
                }]
            },
            options: doughnutOptions()
        });
    }

    function renderGradeDetail() {
        if (!stats) return;
        const dist = stats.gradeDistribution || {};
        const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
        makeChart('chart-grade-detail', {
            type: 'bar',
            data: {
                labels: entries.map(e => e[0]),
                datasets: [{
                    label: 'Module records',
                    data: entries.map(e => e[1]),
                    backgroundColor: entries.map(e => gradeColor(e[0])),
                    borderRadius: 4,
                    maxBarThickness: 42
                }]
            },
            options: baseOptions({ legend: true })
        });
    }

    function renderGrowth() {
        if (!stats) return;
        const rows = seriesData('signups');
        const labels = rows.map(r => shortDay(r.day));
        const cum = cumulative(rows.map(r => r.count));
        makeChart('chart-growth', {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Total users',
                    data: cum,
                    borderColor: '#1D6FE0',
                    backgroundColor: isDark() ? 'rgba(29,111,224,0.18)' : 'rgba(29,111,224,0.10)',
                    fill: true,
                    tension: 0.35,
                    pointRadius: 0,
                    borderWidth: 2
                }]
            },
            options: baseOptions({ legend: true })
        });
    }

    /* ── Overview users ── */

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

    /* ── Auto refresh ── */

    function setAutoRefresh(on) {
        if (autoRefreshTimer) {
            clearInterval(autoRefreshTimer);
            autoRefreshTimer = null;
        }
        if (on) {
            autoRefreshTimer = setInterval(function () {
                if (currentView === 'user-detail') return;
                refreshCurrent();
            }, 60000);
        }
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
                switchView(link.dataset.view);
            });
        });

        document.querySelectorAll('[data-goto]').forEach(el => {
            el.addEventListener('click', function (e) {
                e.preventDefault();
                switchView(el.dataset.goto);
            });
        });

        document.getElementById('global-refresh').addEventListener('click', refreshCurrent);

        const autoRefreshInput = document.getElementById('auto-refresh');
        autoRefreshInput.addEventListener('change', function () {
            setAutoRefresh(autoRefreshInput.checked);
        });

        document.querySelectorAll('#signup-period .segmented-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                signupPeriod = Number(btn.dataset.period);
                document.querySelectorAll('#signup-period .segmented-btn').forEach(b => {
                    b.classList.toggle('active', b === btn);
                });
                renderSignups();
            });
        });

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
                    return;
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

        document.getElementById('admin-lock').addEventListener('click', async function () {
            try { sessionStorage.removeItem('gradelytics_admin_password'); } catch (e) { /* ignore */ }
            if (typeof GradelyticsDB !== 'undefined' && GradelyticsDB.signOut) {
                try { await GradelyticsDB.signOut(); } catch (err) { console.error('Sign out failed:', err); }
            }
            window.location.href = 'auth.html';
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
                destroyAllCharts();
                renderCurrent();
            });
        }

        switchView('overview');
    });
})();
