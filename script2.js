
(function () {
    'use strict';

    const GOALS_KEY = 'goals';
    let selectedGoalType = null;

    /* ── Helpers ── */

    function getGoals() {
        const raw = JSON.parse(localStorage.getItem(GOALS_KEY)) || [];
        return raw.map(g => migrateGoal(g));
    }

    function saveGoals(goals) {
        localStorage.setItem(GOALS_KEY, JSON.stringify(goals));
    }

    function migrateGoal(g) {
        if (typeof g === 'string') return { text: g, progress: 0, type: 'custom', current: 0, target: 100 };
        return {
            text: g.text || '',
            progress: g.progress || 0,
            type: g.type || 'custom',
            current: g.current != null ? g.current : 0,
            target: g.target || 100
        };
    }

    function overallAverage() {
        if (typeof modules === 'undefined' || modules.length === 0) return 0;
        const sum = modules.reduce((a, m) => a + m.mark, 0);
        return Math.round(sum / modules.length);
    }

    function getGoalStatus(goal) {
        const pct = goal.progress;
        if (pct >= 100) return { label: 'Achieved', cls: 'achieved', icon: 'bx-check-circle' };
        if (pct >= 50) return { label: 'On track', cls: 'on-track', icon: 'bx-check-circle' };
        return { label: 'Needs a push', cls: 'needs-push', icon: 'bx-error-circle' };
    }

    function shouldNudge(goal) {
        return goal.progress > 0 && goal.progress < 50;
    }

    /* ── Smart Suggestions ── */

    function renderSuggestions() {
        const container = document.getElementById('goal-suggestion-chips');
        if (!container) return;
        container.innerHTML = '';

        const avg = overallAverage();
        if (avg === 0) return;

        const suggestions = [];

        if (avg < 90) {
            const target = Math.min(avg + 5, 100);
            suggestions.push({
                icon: 'bx-target-lock',
                label: `Reach ${target}% average`,
                type: 'reach-average',
                target
            });
        }

        if (avg > 40) {
            const improved = Math.min(avg + 8, 100);
            suggestions.push({
                icon: 'bx-trending-up',
                label: `Improve by ${improved - avg}% (to ${improved}%)`,
                type: 'improve',
                target: improved
            });
        }

        if (avg >= 60 && avg < 70) {
            suggestions.push({
                icon: 'bx-award',
                label: 'Target a 2:1 classification',
                type: 'earn-grade',
                target: 70
            });
        } else if (avg >= 70 && avg < 80) {
            suggestions.push({
                icon: 'bx-award',
                label: 'Target a 1st classification',
                type: 'earn-grade',
                target: 80
            });
        }

        suggestions.forEach(s => {
            const chip = document.createElement('button');
            chip.className = 'goal-suggestion-chip';
            chip.innerHTML = `<i class='bx ${s.icon}'></i> ${s.label}`;
            chip.addEventListener('click', () => applySuggestion(s));
            container.appendChild(chip);
        });

        const wrapper = document.getElementById('goal-suggestions');
        wrapper.style.display = suggestions.length ? '' : 'none';
    }

    function applySuggestion(s) {
        selectGoalType(s.type);

        const fields = document.getElementById('goal-type-fields');
        if (s.type === 'reach-average') {
            fields.innerHTML = `
                <div class="field">
                    <label class="field-label">Target Average (%)</label>
                    <input type="number" id="goal-target" min="0" max="100" value="${s.target}" placeholder="e.g. 75">
                </div>`;
        } else if (s.type === 'improve') {
            fields.innerHTML = `
                <div class="field">
                    <label class="field-label">Target Average (%)</label>
                    <input type="number" id="goal-target" min="0" max="100" value="${s.target}" placeholder="e.g. 80">
                </div>`;
        } else if (s.type === 'earn-grade') {
            fields.innerHTML = `
                <div class="field">
                    <label class="field-label">Classification</label>
                    <select id="goal-grade-select">
                        <option value="1" ${s.target >= 80 ? 'selected' : ''}>1st (80%+)</option>
                        <option value="2.1" ${s.target >= 70 && s.target < 80 ? 'selected' : ''}>2:1 (70%+)</option>
                        <option value="2.2" ${s.target >= 60 && s.target < 70 ? 'selected' : ''}>2:2 (60%+)</option>
                    </select>
                </div>
                <div class="field">
                    <label class="field-label">Target Mark (%)</label>
                    <input type="number" id="goal-target" min="0" max="100" value="${s.target}" placeholder="e.g. 75">
                </div>`;
        }
        document.getElementById('goal-create-form').style.display = '';
    }

    /* ── Goal Type Selection ── */

    function selectGoalType(type) {
        selectedGoalType = type;
        document.querySelectorAll('.goal-type-chip').forEach(chip => {
            chip.classList.toggle('active', chip.dataset.type === type);
        });
    }

    function renderTypeFields(type) {
        const fields = document.getElementById('goal-type-fields');
        const avg = overallAverage();

        if (type === 'reach-average') {
            const suggested = avg > 0 ? Math.min(avg + 5, 100) : 75;
            fields.innerHTML = `
                <div class="field">
                    <label class="field-label">Target Average (%)</label>
                    <input type="number" id="goal-target" min="0" max="100" value="${suggested}" placeholder="e.g. 75">
                </div>`;
        } else if (type === 'improve') {
            const suggested = avg > 0 ? Math.min(avg + 10, 100) : 80;
            fields.innerHTML = `
                <div class="field">
                    <label class="field-label">Target Average (%)</label>
                    <input type="number" id="goal-target" min="0" max="100" value="${suggested}" placeholder="e.g. 80">
                </div>`;
        } else if (type === 'earn-grade') {
            fields.innerHTML = `
                <div class="field">
                    <label class="field-label">Classification</label>
                    <select id="goal-grade-select">
                        <option value="1">1st (80%+)</option>
                        <option value="2.1">2:1 (70%+)</option>
                        <option value="2.2">2:2 (60%+)</option>
                    </select>
                </div>
                <div class="field">
                    <label class="field-label">Target Mark (%)</label>
                    <input type="number" id="goal-target" min="0" max="100" value="75" placeholder="e.g. 75">
                </div>`;
        } else if (type === 'custom') {
            fields.innerHTML = `
                <div class="field">
                    <label class="field-label">Goal Description</label>
                    <input type="text" id="goal-custom-text" placeholder="e.g. Pass all modules this semester">
                </div>
                <div class="field">
                    <label class="field-label">Target (%)</label>
                    <input type="number" id="goal-target" min="0" max="100" value="100" placeholder="100">
                </div>`;
        }

        document.getElementById('goal-create-form').style.display = '';
    }

    /* ── Add Goal ── */

    function addGoal() {
        const goals = getGoals();
        let title = '';
        let current = 0;
        let target = 100;
        const type = selectedGoalType || 'custom';
        const avg = overallAverage();

        if (type === 'reach-average') {
            const t = parseInt(document.getElementById('goal-target')?.value) || 75;
            title = `Reach ${t}% average`;
            current = avg;
            target = t;
        } else if (type === 'improve') {
            const t = parseInt(document.getElementById('goal-target')?.value) || 80;
            title = `Improve to ${t}% average`;
            current = avg;
            target = t;
        } else if (type === 'earn-grade') {
            const grade = document.getElementById('goal-grade-select')?.value || '2.1';
            const t = parseInt(document.getElementById('goal-target')?.value) || 75;
            const gradeLabels = { '1': '1st', '2.1': '2:1', '2.2': '2:2' };
            title = `Achieve ${gradeLabels[grade] || grade} (${t}%)`;
            current = avg;
            target = t;
        } else {
            title = (document.getElementById('goal-custom-text')?.value || '').trim();
            target = parseInt(document.getElementById('goal-target')?.value) || 100;
            current = avg;
            if (!title) {
                if (typeof showToast === 'function') showToast('Please enter a goal description.', 'error');
                return;
            }
        }

        const progress = target > 0 ? Math.min(Math.round((current / target) * 100), 100) : 0;

        goals.push({ text: title, progress, type, current, target });
        saveGoals(goals);

        if (typeof showToast === 'function') showToast('Goal added!', 'success');
        loadGoals();
        resetGoalCreate();
    }

    function resetGoalCreate() {
        selectedGoalType = null;
        document.querySelectorAll('.goal-type-chip').forEach(c => c.classList.remove('active'));
        document.getElementById('goal-create-form').style.display = 'none';
        document.getElementById('goal-type-fields').innerHTML = '';
    }

    /* ── Update Progress ── */

    function updateProgress(index) {
        const goals = getGoals();
        const goal = goals[index];
        goal.progress = (goal.progress + 10) % 110;
        goal.current = Math.round((goal.progress / 100) * goal.target);
        saveGoals(goals);
        loadGoals();
    }

    /* ── Delete Goal ── */

    function deleteGoal(index) {
        const goals = getGoals();
        goals.splice(index, 1);
        saveGoals(goals);
        if (typeof showToast === 'function') showToast('Goal deleted.', 'success');
        loadGoals();
    }

    /* ── KPI Strip ── */

    function renderKPI(goals) {
        const strip = document.getElementById('goal-kpi-strip');
        if (!strip) return;

        const total = goals.length;
        const achieved = goals.filter(g => g.progress >= 100).length;
        const inProgress = total - achieved;

        strip.innerHTML = `
            <div class="kpi-card">
                <span class="kpi-label">Total Goals</span>
                <span class="kpi-value">${total}</span>
                <span class="kpi-unit">set</span>
            </div>
            <div class="kpi-card">
                <span class="kpi-label">Achieved</span>
                <span class="kpi-value">${achieved}</span>
                <span class="kpi-unit">completed</span>
            </div>
            <div class="kpi-card">
                <span class="kpi-label">In Progress</span>
                <span class="kpi-value">${inProgress}</span>
                <span class="kpi-unit">active</span>
            </div>`;
    }

    /* ── Motivation Message ── */

    function renderMotivation(goals) {
        const el = document.getElementById('goal-motivation');
        if (!el) return;

        if (goals.length === 0) {
            el.innerHTML = '';
            return;
        }

        const achieved = goals.filter(g => g.progress >= 100).length;
        const total = goals.length;
        const ratio = achieved / total;

        let msg = '';
        if (ratio >= 1) {
            msg = `<i class='bx bx-party'></i> You've achieved every goal — outstanding work!`;
        } else if (ratio >= 0.5) {
            msg = `<i class='bx bx-trending-up'></i> Over half your goals are complete — keep the momentum going!`;
        } else if (achieved > 0) {
            msg = `<i class='bx bx-heart'></i> ${achieved} down, ${total - achieved} to go — you're on your way!`;
        } else {
            msg = `<i class='bx bx-bulb'></i> Every achievement starts with a single goal — let's get going!`;
        }

        el.innerHTML = msg;
    }

    /* ── Load Goals ── */

    function loadGoals() {
        const grid = document.getElementById('goal-grid');
        if (!grid) return;
        grid.innerHTML = '';

        const goals = getGoals();

        renderKPI(goals);
        renderMotivation(goals);
        renderSuggestions();

        if (goals.length === 0) {
            grid.innerHTML = `
                <div class="goal-empty">
                    <div class="goal-empty-icon"><i class='bx bx-target-lock'></i></div>
                    <h3>Set your first goal</h3>
                    <p>Choose a goal type above to start tracking your academic progress and stay motivated.</p>
                </div>`;
            return;
        }

        goals.forEach((goal, index) => {
            const status = getGoalStatus(goal);
            const isAchieved = goal.progress >= 100;
            const nudge = shouldNudge(goal);
            const displayCurrent = goal.current || Math.round((goal.progress / 100) * goal.target);
            const displayTarget = goal.target || 100;

            const card = document.createElement('div');
            card.className = `goal-card ${isAchieved ? 'goal-card--achieved' : ''}`;

            card.innerHTML = `
                <div class="goal-card-header">
                    <div>
                        <h4 class="goal-card-title">${goal.text}</h4>
                    </div>
                    <span class="goal-card-type ${isAchieved ? 'goal-card-type--achieved' : ''}">${goal.type.replace('-', ' ')}</span>
                </div>
                <div class="goal-card-fraction">
                    <span class="goal-card-current">${displayCurrent}</span>
                    <span class="goal-card-target">/ ${displayTarget}</span>
                </div>
                <span class="goal-card-status goal-card-status--${status.cls}">
                    <i class='bx ${status.icon}'></i> ${status.label}
                </span>
                <div class="goal-progress-wrap">
                    <div class="goal-progress-track">
                        <div class="goal-progress-bar ${isAchieved ? 'goal-progress--achieved' : ''}" style="width:${goal.progress}%"></div>
                    </div>
                </div>
                ${nudge ? `<div class="goal-card-nudge"><i class='bx bx-error-circle'></i> You've barely started — try incrementing progress regularly.</div>` : ''}
                <div class="goal-card-actions">
                    <button class="btn-icon-sm btn-icon-sm--primary" data-action="update" data-index="${index}" title="Update progress (+10%)">
                        <i class='bx bx-plus'></i>
                    </button>
                    <button class="btn-icon-sm btn-icon-sm--delete" data-action="delete" data-index="${index}" title="Delete goal">
                        <i class='bx bx-trash'></i>
                    </button>
                </div>`;

            grid.appendChild(card);

            if (isAchieved) {
                triggerCelebration(card);
            }
        });
    }

    /* ── Celebration ── */

    function triggerCelebration(card) {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        card.classList.add('goal-card--celebrate');
        const emojis = ['🎉', '✨', '🏆', '⭐'];
        for (let i = 0; i < 4; i++) {
            const span = document.createElement('span');
            span.className = 'goal-confetti';
            span.textContent = emojis[i];
            span.style.left = `${20 + i * 20}%`;
            span.style.animationDelay = `${i * 0.1}s`;
            card.appendChild(span);
        }
        setTimeout(() => card.classList.remove('goal-card--celebrate'), 600);
    }

    /* ── Event Delegation ── */

    document.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-action]');
        if (btn) {
            const action = btn.dataset.action;
            const index = parseInt(btn.dataset.index, 10);
            if (action === 'update') updateProgress(index);
            else if (action === 'delete') deleteGoal(index);
        }
    });

    /* ── Type chip clicks ── */

    document.querySelectorAll('.goal-type-chip').forEach(chip => {
        chip.addEventListener('click', function () {
            const type = this.dataset.type;
            selectGoalType(type);
            renderTypeFields(type);
        });
    });

    /* ── Add goal button ── */

    document.getElementById('goal-add-btn')?.addEventListener('click', addGoal);

    /* ── Init ── */

    document.addEventListener('DOMContentLoaded', loadGoals);
})();

/* ═══════════════════════════════════════════════════════
   Achievements
   ═══════════════════════════════════════════════════════ */

const ACHIEVEMENT_UNLOCK_KEY = 'achievementUnlocks';

function getUnlockedState() {
    return JSON.parse(localStorage.getItem(ACHIEVEMENT_UNLOCK_KEY)) || {};
}

function saveUnlockedState(state) {
    localStorage.setItem(ACHIEVEMENT_UNLOCK_KEY, JSON.stringify(state));
}

function markAchievementUnlocked(key) {
    const state = getUnlockedState();
    if (!state[key]) {
        state[key] = new Date().toISOString();
        saveUnlockedState(state);
        return true;
    }
    return false;
}

function formatUnlockDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function updateAchievements() {
    const medalsGrid = document.getElementById('achievement-medals');
    const improvementsGrid = document.getElementById('achievement-improvements');
    const kpiStrip = document.getElementById('achievement-kpi-strip');
    const nextUpEl = document.getElementById('achievement-next-up');
    const medalsSection = document.getElementById('achievement-medals-section');
    const improvementsSection = document.getElementById('achievement-improvements-section');
    if (!medalsGrid || !improvementsGrid) return;

    medalsGrid.innerHTML = '';
    improvementsGrid.innerHTML = '';

    const sortedModules = [...modules].sort((a, b) => b.mark - a.mark);
    const unlockedState = getUnlockedState();

    const tiers = [
        { key: 'gold',   label: 'Gold',   criteria: 'Score 90+ in any module',   min: 90, badgeIcon: 'bx-trophy',  color: 'gold' },
        { key: 'silver', label: 'Silver', criteria: 'Score 80+ in any module',   min: 80, badgeIcon: 'bx-medal',   color: 'silver' },
        { key: 'bronze', label: 'Bronze', criteria: 'Score 75+ in any module',   min: 75, badgeIcon: 'bx-badge',   color: 'bronze' },
    ];

    let totalAvailable = tiers.length;
    let totalEarned = 0;
    let closestLocked = null;
    let closestDistance = Infinity;

    tiers.forEach(tier => {
        const earned = tier.key === 'gold'
            ? sortedModules.filter(m => m.mark >= tier.min)
            : tier.key === 'silver'
            ? sortedModules.filter(m => m.mark >= tier.min && m.mark < 90)
            : sortedModules.filter(m => m.mark >= tier.min && m.mark < 80);

        const isEarned = earned.length > 0;
        if (isEarned) totalEarned++;

        const card = document.createElement('div');
        const stateClass = isEarned ? 'achievement-card--earned' : 'achievement-card--locked';

        if (isEarned && unlockedState[tier.key]) {
            card.dataset.unlocked = unlockedState[tier.key];
        }

        card.className = `achievement-card achievement-card--${tier.key} ${stateClass}`;

        let modulesHtml = '';
        let earnedDateHtml = '';
        let proximityHtml = '';

        if (isEarned) {
            modulesHtml = `<div class="achievement-modules">` +
                earned.map(m => `<span class="achievement-module-chip">${m.name} <strong>${m.mark}</strong></span>`).join('') +
                `</div>`;
            const unlockDate = unlockedState[tier.key];
            if (unlockDate) {
                earnedDateHtml = `<span class="achievement-earned-date">Earned ${formatUnlockDate(unlockDate)}</span>`;
            }
        } else {
            let closestModule = null;
            let bestDiff = Infinity;
            sortedModules.forEach(m => {
                const diff = tier.min - m.mark;
                if (diff > 0 && diff < bestDiff) {
                    bestDiff = diff;
                    closestModule = m;
                }
            });

            if (closestModule) {
                proximityHtml = `<div class="achievement-proximity"><i class='bx bx-right-arrow-alt'></i> ${bestDiff} mark${bestDiff !== 1 ? 's' : ''} away — ${closestModule.name} (${closestModule.mark})</div>`;
                if (bestDiff < closestDistance) {
                    closestDistance = bestDiff;
                    closestLocked = { label: tier.label, module: closestModule, diff: bestDiff };
                }
            } else if (modules.length === 0) {
                modulesHtml = `<div class="achievement-locked-text">Add modules to start earning medals.</div>`;
            } else {
                modulesHtml = `<div class="achievement-locked-text">No modules near this tier yet.</div>`;
            }
        }

        card.innerHTML = `
            <div class="achievement-card-top">
                <div class="achievement-medal-badge achievement-medal-badge--${tier.color}">
                    <i class='bx ${tier.badgeIcon}'></i>
                </div>
                <div class="achievement-medal-info">
                    <h4 class="achievement-tier-name">${tier.label}</h4>
                    <p class="achievement-criteria">${tier.criteria}</p>
                </div>
                <span class="achievement-status-badge ${isEarned ? 'achievement-status-badge--earned' : 'achievement-status-badge--locked'}">${isEarned ? earned.length + ' earned' : 'Locked'}</span>
            </div>
            ${earnedDateHtml}
            ${proximityHtml}
            ${modulesHtml}
        `;
        medalsGrid.appendChild(card);

        if (isEarned) {
            const wasNew = markAchievementUnlocked(tier.key);
            if (wasNew && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                requestAnimationFrame(() => {
                    card.classList.add('achievement-card--unlock');
                    const badge = card.querySelector('.achievement-medal-badge');
                    if (badge) badge.classList.add('achievement-medal-badge--pulse');
                    setTimeout(() => {
                        card.classList.remove('achievement-card--unlock');
                        if (badge) badge.classList.remove('achievement-medal-badge--pulse');
                    }, 600);
                });
            }
        }
    });

    /* ── Improvement Awards ── */
    const semesterData = {};
    modules.forEach(module => {
        const key = `${module.year}-${module.semester}`;
        if (!semesterData[key]) semesterData[key] = { totalMarks: 0, count: 0 };
        semesterData[key].totalMarks += module.mark;
        semesterData[key].count++;
    });

    const semesterAverages = Object.keys(semesterData).map(key => {
        const data = semesterData[key];
        return { semester: key, avgMark: data.totalMarks / data.count };
    }).sort((a, b) => a.semester.localeCompare(b.semester));

    let improvements = [];
    for (let i = 1; i < semesterAverages.length; i++) {
        const prev = semesterAverages[i - 1];
        const curr = semesterAverages[i];
        const diff = curr.avgMark - prev.avgMark;
        if (diff >= 5) {
            improvements.push({ prev, curr, diff });
        }
    }

    totalAvailable += 1;

    if (improvements.length > 0) {
        totalEarned++;
        const card = document.createElement('div');
        card.className = 'achievement-card achievement-card--improvement achievement-card--earned';

        const wasNewImp = markAchievementUnlocked('improvement');
        if (wasNewImp && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            requestAnimationFrame(() => {
                card.classList.add('achievement-card--unlock');
                setTimeout(() => card.classList.remove('achievement-card--unlock'), 600);
            });
        }

        const detailHtml = improvements.map(imp =>
            `<div class="achievement-improvement-detail"><strong>+${imp.diff.toFixed(1)}</strong> marks — ${imp.prev.semester} → ${imp.curr.semester}</div>`
        ).join('');

        card.innerHTML = `
            <div class="achievement-card-top">
                <div class="achievement-improvement-badge">
                    <i class='bx bx-trending-up'></i>
                </div>
                <div class="achievement-medal-info">
                    <h4 class="achievement-tier-name">Rising Star</h4>
                    <p class="achievement-criteria">5+ mark improvement between semesters</p>
                </div>
                <span class="achievement-status-badge achievement-status-badge--earned">${improvements.length} earned</span>
            </div>
            ${detailHtml}
        `;
        improvementsGrid.appendChild(card);
    }

    /* ── KPI Strip ── */
    if (kpiStrip) {
        const pct = totalAvailable > 0 ? Math.round((totalEarned / totalAvailable) * 100) : 0;
        kpiStrip.innerHTML = `
            <div class="kpi-card">
                <span class="kpi-label">Earned</span>
                <span class="kpi-value">${totalEarned}</span>
                <span class="kpi-unit">achievements</span>
            </div>
            <div class="kpi-card">
                <span class="kpi-label">Available</span>
                <span class="kpi-value">${totalAvailable}</span>
                <span class="kpi-unit">total</span>
            </div>
            <div class="kpi-card">
                <span class="kpi-label">Completion</span>
                <span class="kpi-value">${pct}%</span>
                <span class="kpi-unit">complete</span>
            </div>`;
    }

    /* ── Next Up Card ── */
    if (nextUpEl) {
        nextUpEl.innerHTML = '';
        if (closestLocked && closestDistance <= 5) {
            const card = document.createElement('div');
            card.className = 'achievement-next-card';
            card.innerHTML = `<i class='bx bx-chevron-right'></i> <strong>${closestDistance} mark${closestDistance !== 1 ? 's' : ''} from ${closestLocked.label}</strong> — ${closestLocked.module.name} (${closestLocked.module.mark})`;
            nextUpEl.appendChild(card);
        }
    }

    /* ── Empty / Early State ── */
    if (modules.length === 0) {
        medalsGrid.innerHTML = `
            <div class="achievement-empty">
                <div class="achievement-empty-icon"><i class='bx bx-trophy'></i></div>
                <h3>Your first medal is waiting</h3>
                <p>Add your academic results and start earning medals for high scores.</p>
                <button class="btn btn-primary" onclick="document.querySelector('[href=\"#input\"]').click()">
                    <i class='bx bx-plus'></i> Add Modules
                </button>
            </div>`;
        improvementsGrid.innerHTML = '';
        if (medalsSection) medalsSection.style.display = '';
        if (improvementsSection) improvementsSection.style.display = 'none';
    } else {
        if (improvementsSection) improvementsSection.style.display = improvements.length > 0 ? '' : 'none';
    }
}

/* ═══════════════════════════════════════════════════════
   CSV Export
   ═══════════════════════════════════════════════════════ */

function downloadCSV() {
    const csvHeaders = ['Module Name', 'Part', 'Semester', 'Mark', 'Classification'];
    const csvRows = [];
    csvRows.push(csvHeaders.join(','));

    modules.forEach(module => {
        const row = [
            module.name,
            module.part,
            module.semester,
            module.mark,
            module.grade
        ];
        csvRows.push(row.join(','));
    });

    const csvData = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const csvUrl = URL.createObjectURL(csvData);

    const link = document.createElement('a');
    link.href = csvUrl;
    link.download = 'academic_details.csv';
    link.click();
    URL.revokeObjectURL(csvUrl);
}
