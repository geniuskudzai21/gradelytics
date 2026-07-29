const AI_API_URL = '/api/chat';
const CHAT_STORAGE_KEY = 'ai_chat_messages';

let chatMessages = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY)) || [];

chatMessages = chatMessages.filter(m => m.role !== 'system');

function formatMarkdown(text) {
    const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    let html = escaped
        .replace(/### (.+)/g, '<h5>$1</h5>')
        .replace(/## (.+)/g, '<h4>$1</h4>')
        .replace(/# (.+)/g, '<h3>$1</h3>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/^---+$/gm, '<hr>');
    const lines = html.split('\n');
    let result = [], inList = false, listType = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const ulMatch = line.match(/^[-*] (.+)/);
        const olMatch = line.match(/^(\d+)[.)] (.+)/);
        if (ulMatch) {
            if (!inList || listType !== 'ul') {
                if (inList) result.push('</' + listType + '>');
                result.push('<ul>');
                inList = true;
                listType = 'ul';
            }
            result.push('<li>' + ulMatch[1] + '</li>');
        } else if (olMatch) {
            if (!inList || listType !== 'ol') {
                if (inList) result.push('</' + listType + '>');
                result.push('<ol>');
                inList = true;
                listType = 'ol';
            }
            result.push('<li>' + olMatch[2] + '</li>');
        } else {
            if (inList) { result.push('</' + listType + '>'); inList = false; listType = null; }
            if (line.trim() === '') {
                result.push('');
            } else if (
                !line.startsWith('<h3') && !line.startsWith('<h4') && !line.startsWith('<h5') && !line.startsWith('<hr')
            ) {
                result.push('<p>' + line + '</p>');
            } else {
                result.push(line);
            }
        }
    }
    if (inList) result.push('</' + listType + '>');
    return result.join('\n');
}

const BASE_SYSTEM_MESSAGE = {
    role: 'system',
    content: `IDENTITY: You are Gradelytics AI, an academic performance assistant. You are NOT Nemotron, not NVIDIA, not any other model.

SCOPE: You ONLY help with academic performance analysis. You do NOT help with general knowledge, coding, creative writing, health, travel, or anything unrelated to academics.

DATA RULES - STRICTLY ENFORCED:
- The modules listed below are the ONLY data you have. You CANNOT see anything else.
- NEVER invent, fabricate, guess, or assume any module name, mark, grade, or any other data. If it is not explicitly listed in the modules below, it does not exist.
- When asked about a specific Part or Semester, ONLY use modules matching that exact Part and Semester from the data. Do NOT pull modules from other Parts or Semesters.
- When asked for an average, use the precomputed average provided in the data below. Do NOT recalculate it. Output ONLY the number.
- All modules listed are ALREADY COMPLETED. The student cannot redo them.

RULES:
- Keep ALL responses Short and direct.
- When asked to predict next semester, predict a realistic average in a range of 3 points (e.g., "78-80%") based on trend of past marks.
- Do NOT give unsolicited advice unless explicitly asked.
- When calculating averages, use exactly 1 decimal place. Do not round up or down. E.g. 73.456 becomes 73.4, not 73.5.
- No <think> tags. No explanations. No sign-offs.`
};

function buildSystemMessage() {
    const modules = JSON.parse(localStorage.getItem('modules') || '[]');
    let context = 'Modules:\n';
    if (modules.length === 0) {
        context += 'None yet.';
    } else {
        modules.forEach((m, i) => {
            context += `${i + 1}. ${m.name} | P${m.part} Sem${m.semester} | ${m.mark}/100 (${m.grade})\n`;
        });
        const avg = (modules.reduce((s, m) => s + m.mark, 0) / modules.length).toFixed(1);
        context += `Avg: ${avg}/100 | Total: ${modules.length} modules`;
    }
    return {
        role: 'system',
        content: BASE_SYSTEM_MESSAGE.content + '\n\n' + context
    };
}

async function callAI(messages) {
    const response = await fetch(AI_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            requestType: 'chat',
            messages: messages,
            temperature: 0.3,
            max_tokens: 500,
            stream: false
        })
    });
    if (!response.ok) {
        const errData = await response.text();
        throw new Error(`API error (${response.status}): ${errData}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
}

function extractJSONArray(text) {
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const start = cleaned.indexOf('[');
    if (start === -1) return null;
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < cleaned.length; i++) {
        const c = cleaned[i];
        if (escaped) { escaped = false; continue; }
        if (c === '\\') { escaped = true; continue; }
        if (c === '"' && !inString) { inString = true; continue; }
        if (c === '"' && inString && !escaped) { inString = false; continue; }
        if (inString) continue;
        if (c === '[') depth++;
        if (c === ']') {
            depth--;
            if (depth === 0) {
                try { return JSON.parse(cleaned.substring(start, i + 1)); }
                catch (e) { return null; }
            }
        }
    }
    return null;
}

async function callAIVision(messages, extraBody = {}) {
    const response = await fetch(AI_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            requestType: 'vision',
            messages: messages,
            temperature: 0.0,
            max_tokens: 4096,
            stream: false,
            ...extraBody
        })
    });
    if (!response.ok) {
        const errData = await response.text();
        throw new Error(`Vision API error (${response.status}): ${errData}`);
    }
    const data = await response.json();
    const raw = data.choices[0].message.content;
    if (typeof raw === 'string') return raw;
    return normalizeVisionResult(raw);
}

function normalizeVisionResult(raw) {
    if (typeof raw === 'string') {
        try { return normalizeVisionResult(JSON.parse(raw)); } catch (e) { return raw; }
    }
    if (Array.isArray(raw)) {
        return raw.map(e => {
            if (typeof e === 'string') return e;
            return e.text || '';
        }).filter(Boolean).join('\n');
    }
    if (raw && typeof raw === 'object') {
        if (raw.text) return raw.text;
        if (raw.content) return normalizeVisionResult(raw.content);
    }
    return String(raw || '');
}

function dataURLtoContent(dataURL) {
    const match = dataURL.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) throw new Error('Invalid image format');
    return {
        type: 'image_url',
        image_url: { url: dataURL }
    };
}

let screenshotBase64 = null;

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
            { role: 'user', content: `Here is the extracted text from a screenshot of academic results:\n\n${ocrText}\n\nCRITICAL RULES for Part and Semester:\n1. The results are organized hierarchically: Part headings appear first, then Semester headings within each Part, then modules under each Semester.\n2. Parts appear in order (Part 1 first, then Part 2, etc.). Once a new Part heading appears, all following modules belong to that new Part until another Part heading appears.\n3. Within each Part, Semesters appear in order (Semester 1 first, then Semester 2). Once a new Semester heading appears, all following modules belong to that new Semester until another Semester or Part heading appears.\n4. A Part or Semester heading may only appear once at the top of its section — modules listed after it with no new heading still belong to that same Part/Semester.\n5. Track the CURRENT Part and CURRENT Semester as you read through the modules. Assign each module the current Part and Semester values.\n\nExtract ALL module entries and return them as a JSON array. Each entry must have these fields:
- "name": the course/module name ONLY — strip any course codes, module codes, or alphanumeric prefixes (e.g. "CS101 Intro to Programming" should become "Intro to Programming")
- "year": the academic year (as text)
- "part": the current part number (as text)
- "semester": the current semester number (as a number)
- "mark": the mark/score (as a number, 0-100)
- "grade": the classification/grade exactly as shown (one of: "1", "2.1", "2.2", "P", "F")

Return ONLY a valid JSON array with no other text, no markdown formatting, no code blocks.
If you cannot find any modules, return an empty array [].` }
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

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;

    input.value = '';
    addChatMessage('user', message);
    showChatTyping();

    try {
        const systemMsg = buildSystemMessage();
        const apiMessages = [systemMsg, ...chatMessages.map(m => ({ role: m.role, content: m.content }))];
        const reply = await callAI(apiMessages);
        hideChatTyping();
        addChatMessage('assistant', reply);
    } catch (error) {
        hideChatTyping();
        addChatMessage('assistant', 'Sorry, I encountered an error: ' + error.message);
    }
}

function addChatMessage(role, content) {
    chatMessages.push({ role, content });
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chatMessages));
    renderChatMessages();
}

function renderChatMessages() {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    container.innerHTML = chatMessages.map(msg => `
        <div class="chat-message ${msg.role}">
            <div class="chat-bubble">${formatMarkdown(msg.content)}</div>
        </div>
    `).join('');
    container.scrollTop = container.scrollHeight;
}

function showChatTyping() {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    const typingEl = document.createElement('div');
    typingEl.className = 'chat-message assistant typing';
    typingEl.id = 'chat-typing';
    typingEl.innerHTML = '<div class="chat-bubble typing-indicator"><span></span><span></span><span></span></div>';
    container.appendChild(typingEl);
    container.scrollTop = container.scrollHeight;
}

function hideChatTyping() {
    const typing = document.getElementById('chat-typing');
    if (typing) typing.remove();
}

function clearChat() {
    pendingDeleteIndex = null;
    document.getElementById('confirm-message').textContent = 'Clear all chat messages?';
    document.getElementById('confirm-modal').classList.add('open');

    const yesBtn = document.getElementById('confirm-yes');
    const noBtn = document.getElementById('confirm-no');

    const cleanup = () => {
        yesBtn.removeEventListener('click', onYes);
        noBtn.removeEventListener('click', onNo);
    };
    const onYes = () => {
        cleanup();
        chatMessages = [];
        localStorage.removeItem(CHAT_STORAGE_KEY);
        renderChatMessages();
        document.getElementById('confirm-modal').classList.remove('open');
    };
    const onNo = () => {
        cleanup();
        document.getElementById('confirm-modal').classList.remove('open');
    };

    yesBtn.addEventListener('click', onYes);
    noBtn.addEventListener('click', onNo);
}

function insertSuggestedPrompt(prompt) {
    document.getElementById('chat-input').value = prompt;
    sendChatMessage();
}

document.addEventListener('DOMContentLoaded', function () {
    const predictBtn = document.getElementById('train-predict-btn');
    if (predictBtn) {
        predictBtn.addEventListener('click', predictNextSemester);
    }

    const sendBtn = document.getElementById('chat-send-btn');
    if (sendBtn) {
        sendBtn.addEventListener('click', sendChatMessage);
    }

    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChatMessage();
            }
        });
    }

    const clearChatBtn = document.getElementById('clear-chat-btn');
    if (clearChatBtn) {
        clearChatBtn.addEventListener('click', clearChat);
    }

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

    const fab = document.getElementById('chat-fab');
    const modal = document.getElementById('chat-modal');
    const modalClose = document.getElementById('chat-modal-close');
    if (fab && modal) {
        fab.addEventListener('click', function () {
            modal.classList.toggle('open');
            if (modal.classList.contains('open')) {
                setTimeout(() => document.getElementById('chat-input').focus(), 300);
            }
        });
    }
    if (modalClose && modal) {
        modalClose.addEventListener('click', function () {
            modal.classList.remove('open');
        });
    }

    renderChatMessages();

    const fabEl = document.getElementById('chat-fab');
    if (fabEl) {
        fabEl.classList.add('chat-fab-glow');
    }
});
