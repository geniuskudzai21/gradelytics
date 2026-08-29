function predictNextSemester() {
    const modules = (typeof GradelyticsDB !== 'undefined') ? GradelyticsDB.getModules() : [];
    const resultEl = document.getElementById('prediction-result');
    if (modules.length === 0) {
        resultEl.textContent = 'No academic data found. Add modules in the Input Details section first.';
        return;
    }

    const avg = (modules.reduce((s, m) => s + m.mark, 0) / modules.length).toFixed(1);
    const predicted = computeNextPrediction(modules);
    const low = Math.max(0, Math.round(predicted - 1.5));
    const high = Math.min(100, Math.round(predicted + 1.5));

    resultEl.innerHTML = renderPrediction(`${low}-${high}`, avg);
}

function renderPrediction(text, currentAvg) {
    let range = String(text || '').trim();
    const labelMatch = /PREDICTED_RANGE\s*:\s*([^\n]+)/i.exec(range);
    if (labelMatch) range = labelMatch[1].trim();
    range = range.split('\n')[0].trim().replace(/^\D*(\d+\s*-\s*\d+)\D*$/, '$1');
    const firstNum = parseFloat(range.match(/\d+(\.\d+)?/)?.[0] || '0');
    const color = firstNum >= 70 ? 'var(--color-growth)' : firstNum >= 50 ? 'var(--color-gold)' : '#e53e3e';
    let html = `<div class="pred-hero">
        <div class="pred-avg" style="--avg-color:${color}">${range}<span class="pred-avg-unit">%</span></div>
        <div class="pred-label">Predicted Next Semester Average</div>
        <div class="pred-compare">Current: ${currentAvg}%</div>
    </div>`;
    return html;
}

document.addEventListener('DOMContentLoaded', function () {
    const predictBtn = document.getElementById('train-predict-btn');
    if (predictBtn) {
        predictBtn.addEventListener('click', predictNextSemester);
    }
});
