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
    document.getElementById('whatif-mark').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') simulateWhatIf();
    });

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
function computeNextPrediction(modules) {
    const groups = {};
    modules.forEach(m => {
        const key = `${m.year}-P${m.part}-Sem${m.semester}`;
        if (!groups[key]) groups[key] = { sum: 0, count: 0, order: parseInt(m.year) * 100 + parseInt(m.part) * 10 + parseInt(m.semester) };
        groups[key].sum += m.mark;
        groups[key].count++;
    });

    const keys = Object.keys(groups).sort((a, b) => groups[a].order - groups[b].order);
    const avgs = keys.map(k => groups[k].sum / groups[k].count);

    let predicted;
    if (avgs.length === 1) {
        predicted = avgs[0];
    } else {
        const n = avgs.length;
        const xMean = (n - 1) / 2;
        const yMean = avgs.reduce((s, v) => s + v, 0) / n;
        let num = 0, den = 0;
        for (let i = 0; i < n; i++) {
            num += (i - xMean) * (avgs[i] - yMean);
            den += (i - xMean) * (i - xMean);
        }
        const slope = den !== 0 ? num / den : 0;
        predicted = yMean + slope * n;
    }

    predicted = Math.max(0, Math.min(100, predicted));
    return predicted;
}

async function predictNextSemester() {
    const modules = JSON.parse(localStorage.getItem('modules') || '[]');
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
function simulateWhatIf() {
    const markInput = document.getElementById('whatif-mark');
    const mark = parseFloat(markInput.value);
    const resultEl = document.getElementById('whatif-result');

    if (isNaN(mark) || mark < 0 || mark > 100) {
        resultEl.classList.add('show');
        resultEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--danger)"><i class="bx bx-error-circle" style="font-size:24px"></i><p>Please enter a valid mark between 0 and 100.</p></div>';
        return;
    }

    let classLabel, classIcon, color, bgColor;
    if (mark >= 70) {
        classLabel = 'First Class (1st)';
        classIcon = '<i class="bx bx-trophy" style="color:#22A64C"></i>';
        color = '#22A64C';
        bgColor = 'rgba(34, 166, 76, 0.1)';
    } else if (mark >= 60) {
        classLabel = 'Upper Second Class (2:1)';
        classIcon = '<i class="bx bx-like" style="color:#1D6FE0"></i>';
        color = '#1D6FE0';
        bgColor = 'rgba(29, 111, 224, 0.1)';
    } else if (mark >= 50) {
        classLabel = 'Lower Second Class (2:2)';
        classIcon = '<i class="bx bx-minus-circle" style="color:#F0A83D"></i>';
        color = '#F0A83D';
        bgColor = 'rgba(240, 168, 61, 0.1)';
    } else if (mark >= 40) {
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

    resultEl.classList.add('show');
    resultEl.innerHTML = `
        <div class="whatif-class" style="background:${bgColor}; border-left: 4px solid ${color};">
            <div class="whatif-class-icon">${classIcon}</div>
            <div class="whatif-class-info">
                <h4 style="color:${color}">${classLabel}</h4>
                <p>With an average mark of <strong>${mark}%</strong></p>
            </div>
            <div style="margin-left:auto">
                <span class="whatif-badge" style="background:${color};color:white">${mark}%</span>
            </div>
        </div>
        <div class="pred-section">
            <div class="pred-section-title"><i class='bx bx-info-circle'></i> What This Means</div>
            <div class="pred-assessment">
                ${mark >= 70 ? 'Excellent performance! You are on track for a First Class degree with distinction-level work.' :
                  mark >= 60 ? 'Great work! A 2:1 is a strong degree classification that opens many career opportunities.' :
                  mark >= 50 ? 'A 2:2 is a solid degree classification. Focus on improving key modules to reach the next bracket.' :
                  mark >= 40 ? 'A Pass is acceptable, but aiming higher will improve your career prospects significantly.' :
                  'A Fail means the module needs to be retaken. Seek academic support and review your study strategies.'}
            </div>
        </div>
        <div class="pred-section">
            <div class="pred-section-title"><i class='bx bx-line-chart'></i> To Reach Next Class</div>
            <div class="pred-assessment">
                ${mark < 40 ? `You need <strong>${(40 - mark).toFixed(1)}%</strong> more to reach a Pass.` :
                  mark < 50 ? `You need <strong>${(50 - mark).toFixed(1)}%</strong> more to reach a 2:2.` :
                  mark < 60 ? `You need <strong>${(60 - mark).toFixed(1)}%</strong> more to reach a 2:1.` :
                  mark < 70 ? `You need <strong>${(70 - mark).toFixed(1)}%</strong> more to reach a First.` :
                  'You are already at the highest classification. Maintain this excellent standard!'}
            </div>
        </div>
    `;
}

/* ─────────────────────────────────────────────
   Weak Area Detection
   ───────────────────────────────────────────── */
async function detectWeakAreas() {
    const modules = JSON.parse(localStorage.getItem('modules') || '[]');
    const resultEl = document.getElementById('weakness-result');
    if (modules.length === 0) {
        resultEl.innerHTML = '<div class="pred-section" style="padding:16px;text-align:center;color:var(--text-light)"><i class="bx bx-info-circle" style="font-size:24px"></i><p>No academic data found. Add modules in the Input Details section first.</p></div>';
        return;
    }
    resultEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-light)"><div class="typing-indicator" style="display:inline-flex"><span></span><span></span><span></span></div><p style="margin-top:8px">Analyzing your weak areas...</p></div>';

    const prompt = `Based on the completed modules, identify areas where the student performed below 60% or significantly below their average.

For each weak area found, list it with the module name, the actual mark, and one specific actionable suggestion to improve.

Respond using EXACTLY this format:

WEAK_AREAS:
- Module: <name> | Mark: <mark> | Suggestion: <1 sentence improvement tip>

If no weak areas exist (all marks above 60%), respond with:
NO_WEAK_AREAS: Keep up the great work! All modules are performing well.`;

    try {
        const systemMsg = buildSystemMessage();
        const response = await callAI([
            systemMsg,
            { role: 'user', content: prompt }
        ]);
        resultEl.innerHTML = formatWeakAreas(response);
    } catch (error) {
        resultEl.innerHTML = '<div class="pred-section" style="padding:16px;text-align:center;color:var(--danger)"><i class="bx bx-error-circle" style="font-size:24px"></i><p>Analysis failed: ' + error.message + '</p></div>';
    }
}

function formatWeakAreas(text) {
    const lines = text.split('\n');
    let items = [];
    let noWeak = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (/^NO_WEAK_AREAS/i.test(trimmed)) {
            noWeak = true;
        } else if (/^[-*]\s*Module:/i.test(trimmed)) {
            const nameMatch = trimmed.match(/Module:\s*([^|]+)/i);
            const markMatch = trimmed.match(/Mark:\s*(\d+(\.\d+)?)/i);
            const suggestionMatch = trimmed.match(/Suggestion:\s*(.+)/i);
            items.push({
                name: nameMatch ? nameMatch[1].trim() : 'Unknown',
                mark: markMatch ? parseFloat(markMatch[1]) : null,
                suggestion: suggestionMatch ? suggestionMatch[1].trim() : 'Review your study approach for this module.'
            });
        }
    }

    if (noWeak && items.length === 0) {
        return `<div class="pred-section" style="padding:16px;text-align:center">
            <i class="bx bx-check-circle" style="font-size:40px;color:var(--color-growth)"></i>
            <h4 style="margin:8px 0 0;color:var(--ink)">No Weak Areas Detected</h4>
            <p style="color:var(--text-light);font-size:13px">Keep up the great work! All your modules are performing well.</p>
        </div>`;
    }

    if (items.length === 0) {
        return formatMarkdown(text);
    }

    let html = `<div class="pred-section"><div class="pred-section-title"><i class='bx bx-error-circle'></i> Areas for Improvement</div>`;
    items.forEach(item => {
        const markColor = item.mark < 40 ? '#DC2626' : item.mark < 50 ? '#F0A83D' : '#8B95A3';
        html += `
            <div class="weak-item" style="background:rgba(220,38,38,0.06);border-left:3px solid ${markColor}">
                <div class="weak-item-icon"><i class="bx bx-error" style="color:${markColor}"></i></div>
                <div class="weak-item-content">
                    <h4 style="color:var(--ink)">${item.name} <span style="color:${markColor};font-weight:700">(${item.mark}%)</span></h4>
                    <p>${item.suggestion}</p>
                </div>
            </div>`;
    });
    html += `</div>`;
    return html;
}

/* ─────────────────────────────────────────────
   Career Recommendations
   ───────────────────────────────────────────── */
async function getCareerRecommendations() {
    const modules = JSON.parse(localStorage.getItem('modules') || '[]');
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
    const modules = JSON.parse(localStorage.getItem('modules') || '[]');
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
        return formatMarkdown(text);
    }

    let html = `<div class="pred-section"><div class="pred-section-title"><i class='bx bx-book-open'></i> Personalized Study Tips</div>`;
    items.forEach(item => {
        html += `
            <div class="tip-item">
                <div class="tip-item-icon"><i class="bx bx-bulb"></i></div>
                <div class="tip-item-content">
                    <h4>${item.name}</h4>
                    <p>${item.detail}</p>
                </div>
            </div>`;
    });
    html += `</div>`;
    return html;
}
