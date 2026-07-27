export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const body = { ...req.body };
        const isVision = body.requestType === 'vision';
        const modelEnv = isVision ? process.env.VISION_MODEL : process.env.AI_MODEL;
        const apiKey = isVision
            ? (process.env.NVIDIA_VISION_API_KEY || process.env.NVIDIA_API_KEY)
            : process.env.NVIDIA_API_KEY;
        if (modelEnv) body.model = modelEnv;
        delete body.requestType;

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
