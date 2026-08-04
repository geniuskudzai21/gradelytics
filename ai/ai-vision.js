const EXTRACTION_PROMPT = `You are an academic results extraction engine. Extract EVERY module visible in this screenshot and return them as a JSON array.

Return ONLY valid JSON using EXACTLY this schema:
[
  {
    "name": "",
    "year": "",
    "part": "",
    "semester": 1,
    "mark": 0,
    "grade": ""
  }
]

RULES:
1. Return ONLY JSON. Do not use Markdown, no code fences, no explanations.
2. Extract every visible module. Do not omit any.
3. Never invent data. Only use values that are actually visible in the image.
4. Preserve marks exactly as shown (as a number, 0-100).
5. Preserve grades exactly as shown (e.g. "1", "2.1", "2.2", "P", "F").
6. If a value is unreadable, use null for that field.
7. "name": the course/module name ONLY — strip any course codes, module codes, or alphanumeric prefixes (e.g. "CS101 Intro to Programming" should become "Intro to Programming").
8. "year": the academic year (as text).
9. "part": the part number (as text).
10. "semester": the semester number (as a number).

Part and Semester hierarchy:
- The results are organized hierarchically: Part headings appear first, then Semester headings within each Part, then modules under each Semester.
- Parts appear in order (Part 1 first, then Part 2, etc.). Once a new Part heading appears, all following modules belong to that new Part until another Part heading appears.
- Within each Part, Semesters appear in order (Semester 1 first, then Semester 2). Once a new Semester heading appears, all following modules belong to that new Semester until another Semester or Part heading appears.
- A Part or Semester heading may only appear once at the top of its section — modules listed after it with no new heading still belong to that same Part/Semester.
- Track the CURRENT Part and CURRENT Semester as you read through the modules. Assign each module the current Part and Semester values.

If you cannot find any modules, return an empty array [].`;

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
    reader.onload = async function (e) {
        let processed = e.target.result;
        try {
            processed = await preprocessScreenshot(processed);
        } catch (err) {
            console.warn('Image preprocessing failed, using original:', err);
        }
        screenshotBase64 = processed;
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

function preprocessScreenshot(dataURL, maxWidth = 1800) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = function () {
            try {
                let width = img.width;
                let height = img.height;
                if (width > maxWidth) {
                    const scale = maxWidth / width;
                    width = maxWidth;
                    height = Math.round(height * scale);
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.9));
            } catch (err) {
                reject(err);
            }
        };
        img.onerror = function () {
            reject(new Error('Could not load image for preprocessing.'));
        };
        img.src = dataURL;
    });
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
        const reply = await callAIVision([
            {
                role: 'user',
                content: [
                    { type: 'text', text: EXTRACTION_PROMPT },
                    dataURLtoContent(screenshotBase64)
                ]
            }
        ]);

        const extracted = extractJSONArray(reply) || [];

        if (!Array.isArray(extracted) || extracted.length === 0) {
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

        const existingModules = (typeof GradelyticsDB !== 'undefined') ? GradelyticsDB.getModules() : [];

        const cleaned = [];
        for (const m of extracted) {
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

        let syncFailed = false;
        try {
            await GradelyticsDB.saveModules(existingModules);
        } catch (err) {
            console.error('Failed to sync extracted modules to the cloud:', err);
            syncFailed = true;
        }
        showToast(
            syncFailed
                ? `Extracted ${added} module(s), but cloud sync failed — they are saved on this device.`
                : `Successfully extracted and added ${added} module(s)!`,
            syncFailed ? 'error' : 'success'
        );
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
