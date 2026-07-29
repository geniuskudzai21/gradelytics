function handleScreenshot(file) {
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
        showToast('Please upload a PNG, JPEG, or WebP image.', 'error');
        return;
    }
    if (file.size > 20 * 1024 * 1024) {
        showToast('Image too large. Max 20MB.', 'error');
        return;
    }
    const reader = new FileReader();
    reader.onload = function (e) {
        screenshotBase64 = e.target.result;
        const preview = document.getElementById('screenshot-preview');
        const img = document.getElementById('screenshot-img');
        const extractBtn = document.getElementById('extract-btn');
        const dropzone = document.querySelector('.screenshot-dropzone');
        const status = document.getElementById('extract-status');
        if (img) img.src = screenshotBase64;
        if (preview) preview.style.display = 'block';
        if (extractBtn) extractBtn.disabled = false;
        if (dropzone) dropzone.style.display = 'none';
        if (status) status.textContent = '';
    };
    reader.readAsDataURL(file);
}

function removeScreenshot() {
    screenshotBase64 = null;
    const preview = document.getElementById('screenshot-preview');
    const dropzone = document.querySelector('.screenshot-dropzone');
    const input = document.getElementById('screenshot-input');
    const btn = document.getElementById('extract-btn');
    const status = document.getElementById('extract-status');
    if (preview) preview.style.display = 'none';
    if (btn) { btn.disabled = true; btn.innerHTML = 'Extract Results'; }
    if (dropzone) dropzone.style.display = 'flex';
    if (input) input.value = '';
    if (status) status.textContent = '';
}

async function extractFromScreenshot() {
    if (!screenshotBase64) return;
    const extractBtn = document.getElementById('extract-btn');
    extractBtn.disabled = true;
    extractBtn.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> Extracting...';

    try {
        const ocrText = await callAIVision([
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: 'Transcribe ALL text visible in this image exactly as it appears, preserving the structure, spacing, and section headers. Do not summarize or omit anything.'
                    },
                    dataURLtoContent(screenshotBase64)
                ]
            }
        ]);

        if (!ocrText || !ocrText.trim()) {
            showToast('Could not read any text from the image. Try a clearer screenshot.', 'error');
            extractBtn.disabled = false;
            extractBtn.innerHTML = 'Extract Results';
            return;
        }

        const reply = await callAI([
            { role: 'system', content: 'You extract structured module data from OCR text of academic results. Return ONLY a valid JSON array, no other text.' },
            { role: 'user', content: `Here is the extracted text from a screenshot of academic results:\n\n${ocrText}\n\nCRITICAL RULES for Part and Semester:\n1. The results are organized hierarchically: Part headings appear first, then Semester headings within each Part, then modules under each Semester.\n2. Parts appear in order (Part 1 first, then Part 2, etc.). Once a new Part heading appears, all following modules belong to that new Part until another Part heading appears.\n3. Within each Part, Semesters appear in order (Semester 1 first, then Semester 2). Once a new Semester heading appears, all following modules belong to that new Semester until another Semester or Part heading appears.\n4. A Part or Semester heading may only appear once at the top of its section — modules listed after it with no new heading still belong to that same Part/Semester.\n5. Track the CURRENT Part and CURRENT Semester as you read through the modules. Assign each module the current Part and Semester values.\n\nExtract ALL module entries and return them as a JSON array. Each entry must have these fields:\n- "name": the course/module name ONLY — strip any course codes, module codes, or alphanumeric prefixes (e.g. "CS101 Intro to Programming" should become "Intro to Programming")\n- "year": the academic year (as text)\n- "part": the current part number (as text)\n- "semester": the current semester number (as a number)\n- "mark": the mark/score (as a number, 0-100)\n- "grade": the classification/grade exactly as shown (one of: "1", "2.1", "2.2", "P", "F")\n\nReturn ONLY a valid JSON array with no other text, no markdown formatting, no code blocks.\nIf you cannot find any modules, return an empty array [].` }
        ]);

        let modules = extractJSONArray(reply) || [];

        if (!Array.isArray(modules) || modules.length === 0) {
            showToast('Could not extract any modules from the image. Try a clearer screenshot.', 'error');
            extractBtn.disabled = false;
            extractBtn.innerHTML = 'Extract Results';
            return;
        }

        function stripCourseCode(name) {
            return name.replace(/^\s*[A-Za-z]{2,5}\s*\d{2,4}[A-Za-z]?\s*[-–:]?\s*/, '').trim();
        }

        function isOnlyCourseCode(name) {
            return /^\s*[A-Za-z]{2,5}\s*\d{2,4}[A-Za-z]?\s*$/.test(name.trim());
        }

        const existingModules = JSON.parse(localStorage.getItem('modules') || '[]');

        const cleaned = [];
        for (const m of modules) {
            if (!m.name || !m.year || !m.part || m.semester == null || m.mark == null || !m.grade) continue;
            const rawName = String(m.name).trim();
            if (isOnlyCourseCode(rawName)) continue;
            const name = stripCourseCode(rawName) || rawName;
            const key = `${name}|${m.year}|${m.part}|${m.semester}|${m.mark}|${m.grade}`;
            const codeKey = `${rawName}|${m.year}|${m.part}|${m.semester}|${m.mark}|${m.grade}`;
            if (cleaned.some(c => c.key === key || c.key === codeKey)) continue;
            cleaned.push({
                key,
                module: {
                    name,
                    year: String(m.year).trim(),
                    part: String(m.part).trim(),
                    semester: Number(m.semester),
                    mark: Number(m.mark),
                    grade: String(m.grade).trim()
                }
            });
        }

        let added = 0;
        for (const c of cleaned) {
            existingModules.push(c.module);
            added++;
        }

        localStorage.setItem('modules', JSON.stringify(existingModules));
        showToast(`Successfully extracted and added ${added} module(s)!`, 'success');
        removeScreenshot();
        displayModules();
        updateStatistics();
    } catch (error) {
        showToast('Extraction failed: ' + error.message, 'error');
        extractBtn.disabled = false;
        extractBtn.innerHTML = 'Extract Results';
    }
}

document.addEventListener('DOMContentLoaded', function () {
    const screenshotInput = document.getElementById('screenshot-input');
    if (screenshotInput) {
        screenshotInput.addEventListener('change', function (e) {
            if (e.target.files.length > 0) handleScreenshot(e.target.files[0]);
        });
    }

    const extractBtn = document.getElementById('extract-btn');
    if (extractBtn) {
        extractBtn.addEventListener('click', extractFromScreenshot);
    }

    const removeBtn = document.getElementById('remove-screenshot-btn');
    if (removeBtn) {
        removeBtn.addEventListener('click', removeScreenshot);
    }
});
