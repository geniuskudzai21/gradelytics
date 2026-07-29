const AI_API_URL = '/api/chat';
const CHAT_STORAGE_KEY = 'ai_chat_messages';

let chatMessages = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY)) || [];
chatMessages = chatMessages.filter(m => m.role !== 'system');

let screenshotBase64 = null;
