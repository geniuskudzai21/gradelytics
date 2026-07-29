async function predictNextSemester() {
    const modules = JSON.parse(localStorage.getItem('modules') || '[]');
    const resultEl = document.getElementById('prediction-result');
    if (modules.length === 0) {
        resultEl.textContent = 'No academic data found. Add modules in the Input Details section first.';
        return;
    }
    resultEl.textContent = 'Analyzing your academic performance...';

    let prompt = `Predict the next semester average as a range of 3 points (e.g., "78-80"). Analyze the trend of the completed modules above.

Respond using EXACTLY these headers:

PREDICTED_RANGE: <range like 78-80>

STRENGTHS:
- <strength 1>
- <strength 2>

STRATEGIES:
- <strategy 1>
- <strategy 2>

ASSESSMENT: <one short sentence>

Do NOT invent module names. Be concise.`;

    const avg = (modules.reduce((s, m) => s + m.mark, 0) / modules.length).toFixed(1);

    try {
        const systemMsg = buildSystemMessage();
        const prediction = await callAI([
            systemMsg,
            { role: 'user', content: prompt }
        ]);
        resultEl.innerHTML = renderPrediction(prediction, avg);
    } catch (error) {
        resultEl.textContent = 'Prediction failed: ' + error.message;
    }
}

function renderPrediction(text, currentAvg) {
    const sections = { average: '', strengths: [], strategies: [], assessment: '' };
    const lines = text.split('\n');
    let currentSection = '';
    for (const line of lines) {
        const trimmed = line.trim();
        if (/^PREDICTED_RANGE/i.test(trimmed) || /^PREDICTED_AVERAGE/i.test(trimmed)) {
            sections.average = trimmed.replace(/^[^:]*:\s*/, '').trim();
            currentSection = '';
        } else if (/^STRENGTHS/i.test(trimmed)) {
            currentSection = 'strengths';
        } else if (/^STRATEGIES/i.test(trimmed)) {
            currentSection = 'strategies';
        } else if (/^ASSESSMENT/i.test(trimmed)) {
            currentSection = 'assessment';
            const rest = trimmed.replace(/^[^:]*:\s*/, '');
            if (rest) sections.assessment = rest;
        } else if (currentSection === 'strengths' && /^[-*]\s/.test(trimmed)) {
            sections.strengths.push(trimmed.replace(/^[-*]\s+/, ''));
        } else if (currentSection === 'strategies' && /^[-*]\s/.test(trimmed)) {
            sections.strategies.push(trimmed.replace(/^[-*]\s+/, ''));
        } else if (currentSection === 'assessment' && trimmed) {
            sections.assessment += (sections.assessment ? ' ' : '') + trimmed;
        }
    }

    let html = '';
    if (sections.average) {
        const firstNum = parseFloat(sections.average.match(/\d+(\.\d+)?/)?.[0] || '0');
        const color = firstNum >= 70 ? 'var(--color-growth)' : firstNum >= 50 ? 'var(--color-gold)' : '#e53e3e';
        html += `<div class="pred-hero">
            <div class="pred-avg" style="--avg-color:${color}">${sections.average}<span class="pred-avg-unit">%</span></div>
            <div class="pred-label">Predicted Next Semester Average</div>
            <div class="pred-compare">Current: ${currentAvg}%</div>
        </div>`;
    }
    if (sections.strengths.length) {
        html += `<div class="pred-section"><div class="pred-section-title"><i class='bx bx-trophy'></i> Top Strengths</div><div class="pred-items">`;
        sections.strengths.forEach(s => { html += `<div class="pred-item pred-strength">${s}</div>`; });
        html += `</div></div>`;
    }
    if (sections.strategies.length) {
        html += `<div class="pred-section"><div class="pred-section-title"><i class='bx bx-bulb'></i> Study Strategies</div><div class="pred-items">`;
        sections.strategies.forEach(s => { html += `<div class="pred-item pred-strategy">${s}</div>`; });
        html += `</div></div>`;
    }
    if (sections.assessment) {
        html += `<div class="pred-section"><div class="pred-section-title"><i class='bx bx-message-square-detail'></i> Assessment</div><div class="pred-assessment">${sections.assessment}</div></div>`;
    }
    return html || formatMarkdown(text);
}

document.addEventListener('DOMContentLoaded', function () {
    const predictBtn = document.getElementById('train-predict-btn');
    if (predictBtn) {
        predictBtn.addEventListener('click', predictNextSemester);
    }
});
