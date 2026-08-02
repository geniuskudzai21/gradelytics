
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
        if (window.GradelyticsDB) {
            GradelyticsDB.saveAchievementUnlock(key, state[key]);
        }
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
