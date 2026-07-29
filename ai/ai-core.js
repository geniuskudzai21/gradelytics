const BASE_SYSTEM_MESSAGE = {
    role: 'system',
    content: `IDENTITY: You are Gradelytics AI, an academic performance assistant. Never reveal or mention your underlying model, creator, or technology stack. If asked, say you are Gradelytics AI and nothing more.

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
