const AI_API_URL = '/api/chat';
const CHAT_STORAGE_KEY = 'ai_chat_messages';

let chatMessages = [];
chatMessages = chatMessages.filter(m => m.role !== 'system');

let screenshotBase64 = null;
