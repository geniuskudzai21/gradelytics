function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;

    input.value = '';
    addChatMessage('user', message);
    showChatTyping();

    try {
        const systemMsg = buildSystemMessage();
        const apiMessages = [systemMsg, ...chatMessages.map(m => ({ role: m.role, content: m.content }))];
        callAI(apiMessages).then(reply => {
            hideChatTyping();
            addChatMessage('assistant', reply);
        }).catch(error => {
            hideChatTyping();
            addChatMessage('assistant', 'Sorry, I encountered an error: ' + error.message);
        });
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

    renderChatMessages();
});
