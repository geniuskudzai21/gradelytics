export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'NVIDIA_API_KEY not configured' });
    }

    try {
        const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(req.body)
        });

        const text = await response.text();
        res.writeHead(response.status, { 'Content-Type': 'application/json' });
        res.end(text);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
