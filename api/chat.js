// Free model tiers have a rate limit rather than a bill, so the goal is to
// stop one account from consuming the whole provider quota. Vision is roughly
// an order of magnitude more expensive per call than a short chat turn, so it
// gets the tighter cap. Every number is env-tunable — set the DAILY limits to
// 6 if you want a hard 6-a-day cap.
const AI_LIMITS = {
    chat: {
        day: intEnv('AI_CHAT_DAILY_LIMIT', 20),
        minute: intEnv('AI_CHAT_MINUTE_LIMIT', 6)
    },
    vision: {
        day: intEnv('AI_VISION_DAILY_LIMIT', 8),
        minute: intEnv('AI_VISION_MINUTE_LIMIT', 3)
    }
};

// Burst guard. Best-effort only: on serverless this resets on cold start, which
// is fine because the daily counter in Postgres is the real limit.
const burstHits = new Map();

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const body = { ...req.body };
        const isVision = body.requestType === 'vision';
        delete body.requestType;

        const gate = await enforceQuota(req, isVision);
        if (gate) {
            res.writeHead(gate.status, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(gate.body));
        }

        // Prefer Gemini for vision. If it fails (rate limit, outage, etc.)
        // fall back to the NVIDIA vision model (VISION_MODEL) so extraction
        // never surfaces an error when Gemini is busy.
        if (isVision && process.env.GEMINI_API_KEY && process.env.GOOGLE_MODEL) {
            try {
                const gemini = await proxyToGemini(body, {
                    apiKey: process.env.GEMINI_API_KEY,
                    model: process.env.GOOGLE_MODEL
                });
                if (gemini.status === 200) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(gemini.text);
                }
                console.error('[chat] Gemini vision failed, falling back to NVIDIA:', gemini.status, gemini.text);
            } catch (err) {
                console.error('[chat] Gemini vision threw, falling back to NVIDIA:', err.message);
            }
        }

        const nvidia = await proxyToNvidia(body, isVision);
        if (nvidia.status === 200 || isVision || !process.env.GEMINI_API_KEY || !process.env.GOOGLE_MODEL) {
            res.writeHead(nvidia.status, { 'Content-Type': 'application/json' });
            return res.end(nvidia.text);
        }
        console.error('[chat] NVIDIA chat failed, falling back to Gemini:', nvidia.status, nvidia.text);
        const geminiReply = await proxyToGemini(body, {
            apiKey: process.env.GEMINI_API_KEY,
            model: process.env.GOOGLE_MODEL
        });
        res.writeHead(geminiReply.status, { 'Content-Type': 'application/json' });
        return res.end(geminiReply.text);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

async function proxyToNvidia(body, isVision) {
    const modelEnv = isVision ? process.env.VISION_MODEL : process.env.AI_MODEL;
    const apiKey = isVision
        ? (process.env.NVIDIA_VISION_API_KEY || process.env.NVIDIA_API_KEY)
        : process.env.NVIDIA_API_KEY;
    const payload = { ...body };
    if (modelEnv) payload.model = modelEnv;
    if (!isVision) payload.chat_template_kwargs = { ...(payload.chat_template_kwargs || {}), enable_thinking: false };

    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    const text = await response.text();
    return { status: response.status, text: stripReasoning(text) };
}

const REASONING_TAGS = 'think|thinking|reasoning|analysis|scratchpad|reflection|thought';
const REASONING_PREAMBLE_RE = /here'?s (a|the) (thinking|thought) process|chain[- ]of[- ]thought|thinking process:|analyze user input|identify (the )?constraints|formulate (the )?response|determine the answer/i;

// Reasoning models (e.g. NVIDIA Nemotron) can leak their chain-of-thought —
// including the system prompt verbatim — into the visible `content` field.
// `enable_thinking: false` above is the source-level fix; this is the
// defence-in-depth guard so no provider/model can surface deliberation or
// <think> blocks to the user.
function sanitizeModelText(text) {
    if (typeof text !== 'string' || !text) return text;
    let t = text;
    t = t.replace(new RegExp(`<(${REASONING_TAGS})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi'), '');
    t = t.replace(new RegExp(`<(${REASONING_TAGS})\\b[^>]*>[\\s\\S]*$`, 'i'), '');
    t = t.replace(new RegExp(`^[\\s\\S]*?<\\/(${REASONING_TAGS})\\s*>`, 'i'), '');
    if (REASONING_PREAMBLE_RE.test(t)) {
        t = extractFinalAnswer(t);
    }
    if (REASONING_PREAMBLE_RE.test(t)) return '';
    t = t.split('\n').filter(line => !isLeakedInstruction(line)).join('\n');
    t = t.replace(/^\s*(?:we need to|the user (?:is asking|wants|asked)|let me|i should|okay,? so|alright,? so|analyze user input|the prompt (?:includes|says))[^\n]*\n?/i, '');
    return t.replace(/\n{3,}/g, '\n\n').trim();
}

function isLeakedInstruction(line) {
    return /(STRICTLY ENFORCED|DATA RULES|Never reveal or mention your underlying model|You are Gradelytics AI, an academic performance assistant|You ONLY help with academic performance analysis|NEVER output deliberation|invent, fabricate, guess, or assume|You CANNOT see anything else|Precomputed Averages)/i.test(line);
}

function extractFinalAnswer(text) {
    const labelled = text.match(/(?:final answer|answer|result)\s*[:：]\s*([\s\S]+)$/i);
    if (labelled && labelled[1].trim()) return labelled[1].trim();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (/^[-*•\d]/.test(line)) continue;
        if (REASONING_PREAMBLE_RE.test(line)) continue;
        if (line.length <= 300 && !/^[.\-–—:]+$/.test(line)) return line;
    }
    return '';
}

function stripReasoning(text) {
    try {
        const data = JSON.parse(text);
        const msg = data && data.choices && data.choices[0] && data.choices[0].message;
        if (msg) {
            delete msg.reasoning_content;
            delete msg.reasoning;
            delete msg.reasoning_text;
            if (typeof msg.content === 'string') msg.content = sanitizeModelText(msg.content);
        }
        return JSON.stringify(data);
    } catch (e) {
        return text;
    }
}

function parseDataURL(dataUrl) {
    const match = /^data:([^;,]+);base64,(.+)$/.exec(String(dataUrl || ''));
    if (!match) return null;
    return { mime: match[1], base64: match[2] };
}

async function proxyToGemini(payload, { apiKey, model }) {
    const contents = [];
    const systemParts = [];

    for (const msg of payload.messages || []) {
        if (msg.role === 'system') {
            if (typeof msg.content === 'string') systemParts.push({ text: msg.content });
            continue;
        }
        const role = msg.role === 'assistant' ? 'model' : 'user';
        const parts = [];
        if (typeof msg.content === 'string') {
            parts.push({ text: msg.content });
        } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part.type === 'text') {
                    parts.push({ text: part.text });
                } else if (part.type === 'image_url') {
                    const url = typeof part.image_url === 'string' ? part.image_url : (part.image_url && part.image_url.url);
                    const img = parseDataURL(url);
                    if (img) parts.push({ inline_data: { mime_type: img.mime, data: img.base64 } });
                }
            }
        }
        if (parts.length) contents.push({ role, parts });
    }

    const generationConfig = {};
    if (payload.temperature != null) generationConfig.temperature = payload.temperature;
    if (payload.max_tokens) generationConfig.maxOutputTokens = payload.max_tokens;

    const geminiBody = {};
    if (systemParts.length) geminiBody.systemInstruction = { parts: systemParts };
    geminiBody.contents = contents;
    if (Object.keys(generationConfig).length) geminiBody.generationConfig = generationConfig;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
        },
        body: JSON.stringify(geminiBody)
    });

    if (!res.ok) {
        const errText = await res.text();
        return { status: res.status, text: JSON.stringify({ error: `Gemini API error (${res.status}): ${errText}` }) };
    }

    const data = await res.json();
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content)
        ? (data.candidates[0].content.parts || [])
        : [];
    const content = sanitizeModelText(parts.map(p => p.text || '').join(''));
    return { status: 200, text: JSON.stringify({ choices: [{ message: { content } }] }) };
}

/* ── Per-user AI quota ── */

function intEnv(name, fallback) {
    const n = parseInt(process.env[name], 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function enforceQuota(req, isVision) {
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const kind = isVision ? 'vision' : 'chat';
    const limits = AI_LIMITS[kind];

    // No Supabase config means there is nothing to count against. Never block
    // the app because quota bookkeeping is unavailable.
    if (!serviceRole || !supabaseUrl || !anonKey) return null;

    const userId = await resolveUserId(supabaseUrl, anonKey, req.headers.authorization);
    if (!userId) {
        return {
            status: 401,
            body: {
                error: 'ai_unauthenticated',
                message: 'Sign in again to use AI features — your session may have expired.'
            }
        };
    }

    if (burstExceeded(userId, kind, limits.minute)) {
        return {
            status: 429,
            body: {
                error: 'ai_quota_exceeded',
                kind: kind,
                scope: 'minute',
                limit: limits.minute,
                message: `Easy there — you can send ${limits.minute} AI ${plural(kind)} a minute. Try again in a moment.`
            }
        };
    }

    const used = await bumpDailyUsage(supabaseUrl, serviceRole, userId, kind);
    if (used != null && used > limits.day) {
        return {
            status: 429,
            body: {
                error: 'ai_quota_exceeded',
                kind: kind,
                scope: 'day',
                used: used - 1,
                limit: limits.day,
                message: `You've used all ${limits.day} of today's AI ${plural(kind)}. Your allowance resets tomorrow.`
            }
        };
    }

    return null;
}

function plural(kind) {
    return kind === 'vision' ? 'image extractions' : 'messages';
}

async function resolveUserId(base, anonKey, authHeader) {
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) return null;
    try {
        const res = await fetch(`${base}/auth/v1/user`, {
            headers: { apikey: anonKey, Authorization: `Bearer ${token}` }
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data && data.id ? data.id : null;
    } catch (e) {
        return null;
    }
}

function burstExceeded(userId, kind, max) {
    const key = `${userId}:${kind}`;
    const now = Date.now();
    const window = 60000;
    const hits = (burstHits.get(key) || []).filter(t => now - t < window);
    if (hits.length >= max) {
        burstHits.set(key, hits);
        return true;
    }
    hits.push(now);
    burstHits.set(key, hits);
    if (burstHits.size > 5000) burstHits.clear();
    return false;
}

// Returns the new count for this kind, or null when the counter is unavailable
// so a missing migration degrades to "no limit" instead of a broken app.
async function bumpDailyUsage(base, serviceRole, userId, kind) {
    try {
        const res = await fetch(`${base}/rest/v1/rpc/bump_ai_usage`, {
            method: 'POST',
            headers: {
                apikey: serviceRole,
                Authorization: `Bearer ${serviceRole}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ p_user_id: userId, p_kind: kind })
        });
        if (!res.ok) return null;
        const data = await res.json();
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return null;
        return Number(kind === 'vision' ? row.vision_count : row.chat_count) || 0;
    } catch (e) {
        return null;
    }
}
