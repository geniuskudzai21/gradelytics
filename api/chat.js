export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const body = { ...req.body };
        const isVision = body.requestType === 'vision';
        delete body.requestType;

        if (isVision && process.env.GEMINI_API_KEY && process.env.GOOGLE_MODEL) {
            const gemini = await proxyToGemini(body, {
                apiKey: process.env.GEMINI_API_KEY,
                model: process.env.GOOGLE_MODEL
            });
            res.writeHead(gemini.status, { 'Content-Type': 'application/json' });
            return res.end(gemini.text);
        }

        const modelEnv = isVision ? process.env.VISION_MODEL : process.env.AI_MODEL;
        const apiKey = isVision
            ? (process.env.NVIDIA_VISION_API_KEY || process.env.NVIDIA_API_KEY)
            : process.env.NVIDIA_API_KEY;
        if (modelEnv) body.model = modelEnv;

        const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(body)
        });

        const text = await response.text();
        res.writeHead(response.status, { 'Content-Type': 'application/json' });
        res.end(text);
    } catch (error) {
        res.status(500).json({ error: error.message });
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
    const content = parts.map(p => p.text || '').join('');
    return { status: 200, text: JSON.stringify({ choices: [{ message: { content } }] }) };
}
