/* Shared AI quota limits. Env-tunable; used by /api/chat to enforce the cap
   and by /api/ai-limits to tell the client what the cap is so it can show a
   friendly "here's your daily allowance" toast. */
function intEnv(name, fallback) {
    const n = parseInt(process.env[name], 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getAiLimits() {
    return {
        chat: {
            day: intEnv('AI_CHAT_DAILY_LIMIT', 20),
            minute: intEnv('AI_CHAT_MINUTE_LIMIT', 6)
        },
        vision: {
            day: intEnv('AI_VISION_DAILY_LIMIT', 8),
            minute: intEnv('AI_VISION_MINUTE_LIMIT', 3)
        }
    };
}
