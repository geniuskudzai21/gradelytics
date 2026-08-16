document.addEventListener('DOMContentLoaded', function () {

    /* ── Tab Switching ── */
    const tabs = document.querySelectorAll('.ai-tab');
    const panels = document.querySelectorAll('.ai-panel');

    tabs.forEach(tab => {
        tab.addEventListener('click', function () {
            const target = this.dataset.panel;

            tabs.forEach(t => t.classList.remove('active'));
            this.classList.add('active');

            panels.forEach(p => p.classList.remove('active'));
            const panel = document.getElementById('ai-panel-' + target);
            if (panel) panel.classList.add('active');
        });
    });

    /* ── Predict Next Semester ── */
    document.getElementById('predict-btn').addEventListener('click', predictNextSemester);

    /* ── What-If Simulation ── */
    document.getElementById('whatif-btn').addEventListener('click', simulateWhatIf);
    document.querySelectorAll('#whatif-form input').forEach(input => {
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') simulateWhatIf();
        });
    });
    prefillWhatIf();

    /* ── Weak Areas ── */
    document.getElementById('weakness-btn').addEventListener('click', detectWeakAreas);

    /* ── Career ── */
    document.getElementById('career-btn').addEventListener('click', getCareerRecommendations);

    /* ── Study Tips ── */
    document.getElementById('tips-btn').addEventListener('click', getStudyTips);
});

/* ─────────────────────────────────────────────
   Predict Next Semester
   ───────────────────────────────────────────── */
async function predictNextSemester() {
    const modules = (typeof GradelyticsDB !== 'undefined') ? GradelyticsDB.getModules() : [];
    const resultEl = document.getElementById('predict-result');
    if (modules.length === 0) {
        resultEl.innerHTML = '<div class="pred-section" style="padding:16px;text-align:center;color:var(--text-light)"><i class="bx bx-info-circle" style="font-size:24px"></i><p>No academic data found. Add modules in the Input Details section first.</p></div>';
        return;
    }
    resultEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-light)"><div class="typing-indicator" style="display:inline-flex"><span></span><span></span><span></span></div><p style="margin-top:8px">Analyzing your academic performance...</p></div>';

    const avg = (modules.reduce((s, m) => s + m.mark, 0) / modules.length).toFixed(1);
    const predicted = computeNextPrediction(modules);
    const low = Math.max(0, Math.round(predicted - 1.5));
    const high = Math.min(100, Math.round(predicted + 1.5));
    const predictedRange = `${low}-${high}`;

    const prompt = `PREDICTED_RANGE: ${predictedRange}
STRENGTHS:
STRATEGIES:
ASSESSMENT:`;

    try {
        const systemMsg = buildSystemMessage();
        const prediction = await callAI([
            systemMsg,
            { role: 'user', content: prompt }
        ]);
        resultEl.innerHTML = renderPrediction(prediction, avg);
    } catch (error) {
        resultEl.innerHTML = '<div class="pred-section" style="padding:16px;text-align:center;color:var(--danger)"><i class="bx bx-error-circle" style="font-size:24px"></i><p>Prediction failed: ' + error.message + '</p></div>';
    }
}

/* ─────────────────────────────────────────────
   What-If Simulation
   ───────────────────────────────────────────── */
function prefillWhatIf() {
    const modules = (typeof GradelyticsDB !== 'undefined') ? GradelyticsDB.getModules() : [];
    const groups = {};
    modules.forEach(m => {
        if (!groups[m.part]) groups[m.part] = { sum: 0, count: 0 };
        groups[m.part].sum += m.mark;
        groups[m.part].count++;
    });
    ['2', '3', '4'].forEach(p => {
        const input = document.getElementById('whatif-p' + p);
        if (input && groups[p]) {
            input.placeholder = (groups[p].sum / groups[p].count).toFixed(1);
            input.value = (groups[p].sum / groups[p].count).toFixed(1);
        }
    });
}

function simulateWhatIf() {
    const weights = { 2: 0.2, 3: 0.3, 4: 0.5 };
    const resultEl = document.getElementById('whatif-result');
    const inputs = {};
    let hasValue = false;

    for (const part of ['2', '3', '4']) {
        const input = document.getElementById('whatif-p' + part);
        const val = parseFloat(input.value);
        if (!isNaN(val) && val >= 0 && val <= 100) {
            inputs[part] = val;
            hasValue = true;
        } else if (input.value.trim() !== '') {
            resultEl.classList.add('show');
            resultEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--danger)"><i class="bx bx-error-circle" style="font-size:24px"></i><p>Enter valid marks (0-100) for the parts you want to simulate.</p></div>';
            return;
        }
    }

    if (!hasValue) {
        resultEl.classList.add('show');
        resultEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-light)"><i class="bx bx-calculator" style="font-size:24px"></i><p>Enter at least one hypothetical average mark above.</p></div>';
        return;
    }

    let totalWeight = 0;
    let weightedSum = 0;
    for (const part of ['2', '3', '4']) {
        if (inputs[part] !== undefined) {
            weightedSum += inputs[part] * weights[part];
            totalWeight += weights[part];
        }
    }
    const finalMark = totalWeight > 0 ? (weightedSum / totalWeight) : 0;
    const finalDisplay = finalMark.toFixed(1);

    let classLabel, classIcon, color, bgColor;
    if (finalMark >= 75) {
        classLabel = 'First Class (1st)';
        classIcon = '<i class="bx bx-trophy" style="color:#22A64C"></i>';
        color = '#22A64C';
        bgColor = 'rgba(34, 166, 76, 0.1)';
    } else if (finalMark >= 60) {
        classLabel = 'Upper Second Class (2:1)';
        classIcon = '<i class="bx bx-like" style="color:#1D6FE0"></i>';
        color = '#1D6FE0';
        bgColor = 'rgba(29, 111, 224, 0.1)';
    } else if (finalMark >= 50) {
        classLabel = 'Lower Second Class (2:2)';
        classIcon = '<i class="bx bx-minus-circle" style="color:#F0A83D"></i>';
        color = '#F0A83D';
        bgColor = 'rgba(240, 168, 61, 0.1)';
    } else if (finalMark >= 40) {
        classLabel = 'Third Class (Pass)';
        classIcon = '<i class="bx bx-check" style="color:#8B95A3"></i>';
        color = '#8B95A3';
        bgColor = 'rgba(139, 149, 163, 0.1)';
    } else {
        classLabel = 'Fail';
        classIcon = '<i class="bx bx-x-circle" style="color:#DC2626"></i>';
        color = '#DC2626';
        bgColor = 'rgba(220, 38, 38, 0.1)';
    }

    let breakdownHtml = '';
    let totalWeightUsed = 0;
    for (const part of ['2', '3', '4']) {
        if (inputs[part] !== undefined) {
            const pct = weights[part] * 100;
            totalWeightUsed += weights[part];
            breakdownHtml += `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px">
                <span style="color:var(--text-light)">Part ${part} (${pct}%)</span>
                <span style="font-weight:600;color:var(--ink)">${inputs[part]}%</span>
            </div>`;
        }
    }

    resultEl.classList.add('show');
    resultEl.innerHTML = `
        <div class="whatif-class" style="background:${bgColor}; border-left: 4px solid ${color};">
            <div class="whatif-class-icon">${classIcon}</div>
            <div class="whatif-class-info">
                <h4 style="color:${color}">${classLabel}</h4>
                <p>Weighted final mark: <strong>${finalDisplay}%</strong></p>
            </div>
            <div style="margin-left:auto">
                <span class="whatif-badge" style="background:${color};color:white">${finalDisplay}%</span>
            </div>
        </div>
        <div class="pred-section">
            <div class="pred-section-title"><i class='bx bx-calculator'></i> Breakdown</div>
            <div class="pred-assessment" style="padding:8px 14px">
                ${breakdownHtml}
                <div style="display:flex;justify-content:space-between;padding:6px 0 0;border-top:1px solid var(--border);margin-top:4px;font-size:14px">
                    <span style="font-weight:700;color:var(--ink)">Weighted Total (${(totalWeightUsed * 100).toFixed(0)}%)</span>
                    <span style="font-weight:800;color:${color}">${finalDisplay}%</span>
                </div>
            </div>
        </div>
        <div class="pred-section">
            <div class="pred-section-title"><i class='bx bx-info-circle'></i> What This Means</div>
            <div class="pred-assessment">
                ${finalMark >= 75 ? 'Excellent! A First Class degree is the highest classification. You\'re on track for top-tier graduate opportunities.' :
                  finalMark >= 60 ? 'Great work! A 2:1 is a strong degree that opens many career paths. Aim higher to reach First Class (75%+).' :
                  finalMark >= 50 ? 'A 2:2 is a solid degree. Focus on improving your marks to reach the 2:1 threshold (60%).' :
                  finalMark >= 40 ? 'A Pass is acceptable. Consider where you can improve to strengthen your final classification.' :
                  'A Fail means the module needs to be retaken. Seek academic support.'}
            </div>
        </div>
        <div class="pred-section">
            <div class="pred-section-title"><i class='bx bx-line-chart'></i> To Reach Next Class</div>
            <div class="pred-assessment">
                ${finalMark < 40 ? `You need <strong>${(40 - finalMark).toFixed(1)}%</strong> more in your weighted average to reach a Pass.` :
                  finalMark < 50 ? `You need <strong>${(50 - finalMark).toFixed(1)}%</strong> more to reach a 2:2.` :
                  finalMark < 60 ? `You need <strong>${(60 - finalMark).toFixed(1)}%</strong> more to reach a 2:1.` :
                  finalMark < 75 ? `You need <strong>${(75 - finalMark).toFixed(1)}%</strong> more to reach First Class.` :
                  'You\'re already at First Class level. Maintain this excellent standard!'}
            </div>
        </div>
    `;
}

/* ─────────────────────────────────────────────
   Weak Area Detection
   ───────────────────────────────────────────── */
async function detectWeakAreas() {
    const modules = (typeof GradelyticsDB !== 'undefined') ? GradelyticsDB.getModules() : [];
    const resultEl = document.getElementById('weakness-result');
    if (modules.length === 0) {
        resultEl.innerHTML = '<div class="pred-section" style="padding:16px;text-align:center;color:var(--text-light)"><i class="bx bx-info-circle" style="font-size:24px"></i><p>No academic data found. Add modules in the Input Details section first.</p></div>';
        return;
    }

    const weakModules = modules.filter(m => m.mark < 60);
    if (weakModules.length === 0) {
        resultEl.innerHTML = `<div class="pred-section" style="padding:16px;text-align:center">
            <i class="bx bx-check-circle" style="font-size:40px;color:var(--color-growth)"></i>
            <h4 style="margin:8px 0 0;color:var(--ink)">No Weak Areas Detected</h4>
            <p style="color:var(--text-light);font-size:13px">All your modules are above 60%. Keep up the great work!</p>
        </div>`;
        return;
    }

    resultEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-light)"><div class="typing-indicator" style="display:inline-flex"><span></span><span></span><span></span></div><p style="margin-top:8px">Analyzing your weak areas...</p></div>';

    const weakContext = weakModules.map((m, i) =>
        `${i + 1}. ${m.name} | P${m.part} Sem${m.semester} | ${m.mark}/100`
    ).join('\n');

    const prompt = `Below are the student's modules that scored below 60%. Identify patterns in these weak areas (e.g. programming-heavy, theoretical, quantitative) and suggest study strategies for handling similar types of modules in the future.

Weak modules:
${weakContext}

Respond using EXACTLY this format:
WEAK_PATTERNS:
- <pattern 1>
- <pattern 2>

FUTURE_STRATEGIES:
- <strategy 1>
- <strategy 2>`;

    try {
        const systemMsg = buildSystemMessage();
        const response = await callAI([
            systemMsg,
            { role: 'user', content: prompt }
        ]);
        resultEl.innerHTML = formatWeakAreas(response, weakModules);
    } catch (error) {
        resultEl.innerHTML = '<div class="pred-section" style="padding:16px;text-align:center;color:var(--danger)"><i class="bx bx-error-circle" style="font-size:24px"></i><p>Analysis failed: ' + error.message + '</p></div>';
    }
}

function formatWeakAreas(text, weakModules) {
    const lines = text.split('\n');
    let patterns = [];
    let strategies = [];
    let currentSection = '';

    for (const line of lines) {
        const trimmed = line.trim();
        if (/^WEAK_PATTERNS/i.test(trimmed)) {
            currentSection = 'patterns';
        } else if (/^FUTURE_STRATEGIES/i.test(trimmed)) {
            currentSection = 'strategies';
        } else if (currentSection === 'patterns' && /^[-*]\s/.test(trimmed)) {
            patterns.push(trimmed.replace(/^[-*]\s+/, ''));
        } else if (currentSection === 'strategies' && /^[-*]\s/.test(trimmed)) {
            strategies.push(trimmed.replace(/^[-*]\s+/, ''));
        }
    }

    const weakList = weakModules.map(m => {
        const markColor = m.mark < 40 ? '#DC2626' : '#F0A83D';
        return `<div class="weak-item" style="background:rgba(220,38,38,0.06);border-left:3px solid ${markColor}">
            <div class="weak-item-icon"><i class="bx bx-error" style="color:${markColor}"></i></div>
            <div class="weak-item-content">
                <h4 style="color:var(--ink)">${m.name} <span style="color:${markColor};font-weight:700">(${m.mark}%)</span></h4>
                <p style="font-size:12px;color:var(--muted)">Part ${m.part} &middot; Semester ${m.semester}</p>
            </div>
        </div>`;
    }).join('');

    let html = `<div class="pred-section"><div class="pred-section-title"><i class='bx bx-error-circle'></i> Low-Scoring Modules (Below 60%)</div>${weakList}</div>`;

    if (patterns.length > 0) {
        html += `<div class="pred-section"><div class="pred-section-title"><i class='bx bx-trending-up'></i> Common Patterns</div>`;
        patterns.forEach(p => {
            html += `<div class="pred-item pred-strategy" style="margin-bottom:6px">${p}</div>`;
        });
        html += `</div>`;
    }

    if (strategies.length > 0) {
        html += `<div class="pred-section"><div class="pred-section-title"><i class='bx bx-bulb'></i> Strategies for Future Modules</div>`;
        strategies.forEach(s => {
            html += `<div class="pred-item pred-strategy" style="margin-bottom:6px">${s}</div>`;
        });
        html += `</div>`;
    }

    if (!patterns.length && !strategies.length) {
        html += formatMarkdown(text);
    }

    return html;
}

/* ─────────────────────────────────────────────
   Career Recommendations
   ───────────────────────────────────────────── */
async function getCareerRecommendations() {
    const modules = (typeof GradelyticsDB !== 'undefined') ? GradelyticsDB.getModules() : [];
    const resultEl = document.getElementById('career-result');
    if (modules.length === 0) {
        resultEl.innerHTML = '<div class="pred-section" style="padding:16px;text-align:center;color:var(--text-light)"><i class="bx bx-info-circle" style="font-size:24px"></i><p>No academic data found. Add modules in the Input Details section first.</p></div>';
        return;
    }
    resultEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-light)"><div class="typing-indicator" style="display:inline-flex"><span></span><span></span><span></span></div><p style="margin-top:8px">Generating career recommendations...</p></div>';

    const prompt = `Based on the student's completed module list, suggest 3-4 career paths that align with their strongest subjects and academic performance.

For each career path, provide:
- Career name
- Why it fits (based on module strengths)
- One recommended next step

Respond using EXACTLY this format:

CAREERS:
- Career: <name> | Fit: <1 sentence why> | Next: <1 sentence action>`;

    try {
        const systemMsg = buildSystemMessage();
        const response = await callAI([
            systemMsg,
            { role: 'user', content: prompt }
        ]);
        resultEl.innerHTML = formatCareers(response);
    } catch (error) {
        resultEl.innerHTML = '<div class="pred-section" style="padding:16px;text-align:center;color:var(--danger)"><i class="bx bx-error-circle" style="font-size:24px"></i><p>Failed to get recommendations: ' + error.message + '</p></div>';
    }
}

function formatCareers(text) {
    const lines = text.split('\n');
    let items = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (/^[-*]\s*Career:/i.test(trimmed)) {
            const nameMatch = trimmed.match(/Career:\s*([^|]+)/i);
            const fitMatch = trimmed.match(/Fit:\s*(.+?)(?:\||$)/i);
            const nextMatch = trimmed.match(/Next:\s*(.+)/i);
            items.push({
                name: nameMatch ? nameMatch[1].trim() : 'Unknown',
                fit: fitMatch ? fitMatch[1].trim() : 'Aligned with your academic strengths.',
                next: nextMatch ? nextMatch[1].trim() : 'Research this career path further.'
            });
        }
    }

    if (items.length === 0) {
        return formatMarkdown(text);
    }

    let html = `<div class="pred-section"><div class="pred-section-title"><i class='bx bx-briefcase'></i> Recommended Career Paths</div>`;
    items.forEach(item => {
        html += `
            <div class="career-item">
                <div class="career-item-icon"><i class="bx bx-briefcase"></i></div>
                <div class="career-item-content">
                    <h4>${item.name}</h4>
                    <p><strong>Why it fits:</strong> ${item.fit}</p>
                    <p style="margin-top:4px"><strong>Next step:</strong> ${item.next}</p>
                </div>
            </div>`;
    });
    html += `</div>`;
    return html;
}

/* ─────────────────────────────────────────────
   Study Tips
   ───────────────────────────────────────────── */
async function getStudyTips() {
    const modules = (typeof GradelyticsDB !== 'undefined') ? GradelyticsDB.getModules() : [];
    const resultEl = document.getElementById('tips-result');
    if (modules.length === 0) {
        resultEl.innerHTML = '<div class="pred-section" style="padding:16px;text-align:center;color:var(--text-light)"><i class="bx bx-info-circle" style="font-size:24px"></i><p>No academic data found. Add modules in the Input Details section first.</p></div>';
        return;
    }
    resultEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-light)"><div class="typing-indicator" style="display:inline-flex"><span></span><span></span><span></span></div><p style="margin-top:8px">Generating personalized study tips...</p></div>';

    const prompt = `Based on the student's completed module list, provide 4 specific, actionable study tips tailored to their academic performance pattern.

Focus on:
- Areas where they scored lower
- Study techniques suited to their module types
- Time management advice
- Exam preparation strategies

Respond using EXACTLY this format:

TIPS:
- Tip: <tip title> | Detail: <1-2 sentence explanation>`;

    try {
        const systemMsg = buildSystemMessage();
        const response = await callAI([
            systemMsg,
            { role: 'user', content: prompt }
        ]);
        resultEl.innerHTML = formatTips(response);
    } catch (error) {
        resultEl.innerHTML = '<div class="pred-section" style="padding:16px;text-align:center;color:var(--danger)"><i class="bx bx-error-circle" style="font-size:24px"></i><p>Failed to get study tips: ' + error.message + '</p></div>';
    }
}

function formatTips(text) {
    const lines = text.split('\n');
    let items = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (/^[-*]\s*Tip:/i.test(trimmed)) {
            const nameMatch = trimmed.match(/Tip:\s*([^|]+)/i);
            const detailMatch = trimmed.match(/Detail:\s*(.+)/i);
            items.push({
                name: nameMatch ? nameMatch[1].trim() : 'Study Tip',
                detail: detailMatch ? detailMatch[1].trim() : 'Focus on consistent study habits.'
            });
        }
    }

    if (items.length === 0) {
        for (const line of lines) {
            const trimmed = line.trim();
            const bulletMatch = trimmed.match(/^[-*]\s*\*?\*?(.+?)\*?\*?\s*[:\u2014\u2013-]\s*(.+)/);
            const numMatch = trimmed.match(/^\d+[.)]\s*\*?\*?(.+?)\*?\*?\s*[:\u2014\u2013-]\s*(.+)/);
            const m = bulletMatch || numMatch;
            if (m) {
                items.push({
                    name: m[1].replace(/\*\*/g, '').trim(),
                    detail: m[2].trim()
                });
            }
        }
    }

    if (items.length === 0) {
        return formatMarkdown(text);
    }

    const tipIcons = ['bx-target-lock', 'bx-book', 'bx-time-five', 'bx-check-circle', 'bx-brain', 'bx-line-chart'];
    let html = `<div class="pred-section"><div class="pred-section-title"><i class='bx bx-book-open'></i> Personalized Study Tips</div>`;
    items.forEach(function (item, i) {
        const icon = tipIcons[i % tipIcons.length];
        html += `
            <div class="tip-item tip-item--numbered">
                <div class="tip-item-num">${i + 1}</div>
                <div class="tip-item-icon"><i class="bx ${icon}"></i></div>
                <div class="tip-item-content">
                    <h4>${item.name}</h4>
                    <p>${item.detail}</p>
                </div>
            </div>`;
    });
    html += `</div>`;
    return html;
}
