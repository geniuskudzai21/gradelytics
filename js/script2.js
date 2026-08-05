
/* ═══════════════════════════════════════════════════════
   Achievements
   ═══════════════════════════════════════════════════════ */

const ACHIEVEMENT_UNLOCK_KEY = 'achievementUnlocks';

function achievementStorageKey() {
    return (window.GradelyticsDB && typeof GradelyticsDB.getCacheKey === 'function')
        ? GradelyticsDB.getCacheKey(ACHIEVEMENT_UNLOCK_KEY)
        : ACHIEVEMENT_UNLOCK_KEY;
}

function getUnlockedState() {
    return JSON.parse(localStorage.getItem(achievementStorageKey())) || {};
}

function saveUnlockedState(state) {
    localStorage.setItem(achievementStorageKey(), JSON.stringify(state));
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

/* Clears the scoped unlock history and record baselines so the Milestones
   section re-locks completely. Called by GradelyticsDB.resetAchievements()
   when every module is deleted. */
function resetAchievementProgress() {
    ['achievementUnlocks', 'achievement_best_sem_avg', 'achievement_best_mark']
        .forEach(key => {
            const scoped = (window.GradelyticsDB && typeof GradelyticsDB.getCacheKey === 'function')
                ? GradelyticsDB.getCacheKey(key)
                : key;
            localStorage.removeItem(scoped);
        });
}

function formatUnlockDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function updateAchievements() {
    const medalsGrid = document.getElementById('achievement-medals');
    const kpiStrip = document.getElementById('achievement-kpi-strip');
    const nextUpEl = document.getElementById('achievement-next-up');
    const medalsSection = document.getElementById('achievement-medals-section');
    if (!medalsGrid) return;

    medalsGrid.innerHTML = '';

    const sortedModules = [...modules].sort((a, b) => b.mark - a.mark);
    // With no modules there can be no milestones: ignore any persisted unlock
    // history (it may still linger in the cloud if the reset delete is
    // blocked) so the section always shows a clean slate after a full wipe.
    const unlockedState = modules.length === 0 ? {} : getUnlockedState();

    /* ── Semester stats ── */
    const semesterMap = {};
    modules.forEach(m => {
        const key = `${m.year}-${m.semester}`;
        if (!semesterMap[key]) semesterMap[key] = { marks: 0, count: 0, distinctions: 0 };
        semesterMap[key].marks += Number(m.mark) || 0;
        semesterMap[key].count++;
        if (m.grade === '1') semesterMap[key].distinctions++;
    });
    const semesterStats = Object.keys(semesterMap).map(key => {
        const d = semesterMap[key];
        return { key, avg: d.marks / d.count, count: d.count, distinctions: d.distinctions };
    });
    const semesterAverages = semesterStats.map(s => s.avg);

    /* Record-style achievements remember the user's best values (scoped per
       account) so they unlock exactly once — the first time a previous best
       is beaten. The very first evaluation just sets the baseline. */
    function trackKey(name) {
        return (window.GradelyticsDB && typeof GradelyticsDB.getCacheKey === 'function')
            ? GradelyticsDB.getCacheKey('achievement_' + name)
            : 'achievement_' + name;
    }

    function beatRecord(name, current) {
        const stored = parseFloat(localStorage.getItem(trackKey(name)));
        if (!Number.isFinite(stored)) {
            localStorage.setItem(trackKey(name), String(current));
            return null;
        }
        if (current > stored) {
            localStorage.setItem(trackKey(name), String(current));
        }
        return { prev: stored };
    }

    const achievementDefs = [
        { key: 'best_semester',      label: 'Best Semester Ever',  criteria: 'Record your best-ever semester average',            icon: 'bx-star',           color: 'gold' },
        { key: 'super_distinction',  label: 'Super Distinction',   criteria: 'Score 90+ in any module',                           icon: 'bx-trophy',         color: 'purple' },
        { key: 'highest_mark',       label: 'Highest Module Mark', criteria: 'Beat your personal-best module mark',               icon: 'bx-diamond',        color: 'teal' },
        { key: 'perfect_semester',   label: 'Perfect Semester',    criteria: 'Earn all distinctions in a single semester',       icon: 'bx-bullseye',       color: 'green' },
        { key: 'elite_scholar',      label: 'Elite Scholar',       criteria: 'Semester average above 75%',                        icon: 'bx-graduation-cap', color: 'indigo' }
    ];

    /* Returns { earned, hint, distance } for one achievement. `earned` is the
       live condition only — persistence is handled by the caller. */
    function evaluate(def) {
        const top = sortedModules[0];
        const bestAvg = semesterAverages.length ? Math.max(...semesterAverages) : null;

        switch (def.key) {
            case 'best_semester': {
                if (bestAvg == null) return { earned: false, hint: '', distance: null };
                const rec = beatRecord('best_sem_avg', bestAvg);
                const diff = rec ? bestAvg - rec.prev : null;
                const bestSem = semesterStats.find(s => s.avg === bestAvg);
                return {
                    earned: !!rec && diff > 0,
                    hint: rec && diff < 0 ? `${(-diff).toFixed(1)} from your best semester of ${rec.prev.toFixed(1)}%` : '',
                    distance: rec && diff < 0 ? -diff : null,
                    refs: bestSem ? [{ name: bestSem.key, detail: bestAvg.toFixed(1) + '%' }] : []
                };
            }
            case 'super_distinction': {
                return {
                    earned: !!(top && top.mark >= 90),
                    hint: top && top.mark < 90
                        ? `${Math.ceil(90 - top.mark)} mark${Math.ceil(90 - top.mark) !== 1 ? 's' : ''} away — ${top.name} (${top.mark})`
                        : '',
                    distance: top && top.mark < 90 ? 90 - top.mark : null,
                    refs: sortedModules.filter(m => m.mark >= 90).map(m => ({ name: m.name, detail: m.mark }))
                };
            }
            case 'highest_mark': {
                if (!top) return { earned: false, hint: '', distance: null };
                const rec = beatRecord('best_mark', top.mark);
                const diff = rec ? top.mark - rec.prev : null;
                return {
                    earned: !!rec && diff > 0,
                    hint: rec && diff < 0 ? `${-diff} from your best mark of ${rec.prev}` : '',
                    distance: rec && diff < 0 ? -diff : null,
                    refs: sortedModules.filter(m => m.mark === top.mark).map(m => ({ name: m.name, detail: m.mark }))
                };
            }
            case 'perfect_semester': {
                const perfectSemesters = semesterStats.filter(s => s.count >= 2 && s.distinctions === s.count);
                return {
                    earned: perfectSemesters.length > 0,
                    hint: '',
                    distance: null,
                    refs: perfectSemesters.map(s => ({ name: s.key, detail: s.distinctions + ' distinctions' }))
                };
            }
            case 'elite_scholar': {
                const eliteSemesters = semesterStats.filter(s => s.avg > 75);
                return {
                    earned: !!(bestAvg != null && bestAvg > 75),
                    hint: bestAvg != null && bestAvg <= 75 ? `Best semester average: ${bestAvg.toFixed(1)}% (need 75%)` : '',
                    distance: bestAvg != null && bestAvg < 75 ? 75 - bestAvg : null,
                    refs: eliteSemesters.map(s => ({ name: s.key, detail: s.avg.toFixed(1) + '%' }))
                };
            }
        }
    }

    let totalAvailable = achievementDefs.length;
    let totalEarned = 0;
    let closestLocked = null;
    let closestDistance = Infinity;

    achievementDefs.forEach(def => {
        const result = evaluate(def);
        const alreadyUnlocked = !!unlockedState[def.key];
        const isEarned = alreadyUnlocked || result.earned;
        const firstUnlock = isEarned && markAchievementUnlocked(def.key);

        if (isEarned) totalEarned++;

        const card = document.createElement('div');
        card.className = `achievement-card achievement-card--${def.color} ${isEarned ? 'achievement-card--earned' : 'achievement-card--locked'}`;

        let detailHtml = '';
        if (isEarned) {
            if (result.refs && result.refs.length) {
                const chips = result.refs.map(r =>
                    `<span class="achievement-module-chip">${r.name} <strong>${r.detail}</strong></span>`
                ).join('');
                const more = result.refsMore ? `<span class="achievement-module-chip">+${result.refsMore} more</span>` : '';
                const unlockDate = unlockedState[def.key];
                detailHtml = `<div class="achievement-modules">${chips}${more}</div>${unlockDate ? `<span class="achievement-earned-date">Earned ${formatUnlockDate(unlockDate)}</span>` : ''}`;
            } else if (result.earnedDetail) {
                detailHtml = result.earnedDetail;
            } else {
                const unlockDate = unlockedState[def.key];
                if (unlockDate) {
                    detailHtml = `<span class="achievement-earned-date">Earned ${formatUnlockDate(unlockDate)}</span>`;
                }
            }
        } else {
            if (result.hint) {
                detailHtml = `<div class="achievement-proximity"><i class='bx bx-right-arrow-alt'></i> ${result.hint}</div>`;
            }
            if (result.distance != null && result.distance > 0 && result.distance < closestDistance) {
                closestDistance = result.distance;
                closestLocked = { label: def.label, hint: result.hint };
            }
        }

        card.innerHTML = `
            <div class="achievement-card-top">
                <div class="achievement-medal-badge achievement-medal-badge--${def.color}">
                    <i class='bx ${def.icon}'></i>
                </div>
                <div class="achievement-medal-info">
                    <h4 class="achievement-tier-name">${def.label}</h4>
                    <p class="achievement-criteria">${def.criteria}</p>
                </div>
                <span class="achievement-status-badge ${isEarned ? 'achievement-status-badge--earned' : 'achievement-status-badge--locked'}">${isEarned ? (result.earnedBadge || 'Earned') : 'Locked'}</span>
            </div>
            ${detailHtml}
        `;
        medalsGrid.appendChild(card);

        if (firstUnlock && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
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
    });

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
            card.innerHTML = `<i class='bx bx-chevron-right'></i> <strong>${closestLocked.label}</strong> — ${closestLocked.hint}`;
            nextUpEl.appendChild(card);
        }
    }

    /* ── Section visibility ── */
    if (medalsSection) medalsSection.style.display = '';
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
