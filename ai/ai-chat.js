function chatStorageKey() {
    return (window.GradelyticsDB && typeof GradelyticsDB.getCacheKey === 'function')
        ? GradelyticsDB.getCacheKey(CHAT_STORAGE_KEY)
        : CHAT_STORAGE_KEY;
}

/* ── AI quota lock ──
   Once the daily AI allowance is spent the server keeps rejecting prompts, so
   the composer is disabled instead of letting the user fire requests that can
   only fail. Day locks persist for the current UTC day; per-minute burst locks
   clear themselves after 60s. */
const CHAT_LOCK_KEY = 'ai_chat_lock';
const CHAT_LOCK_DAY_MESSAGE = "You've reached today's AI message limit. It resets tomorrow.";
let chatLocked = false;
let chatUnlockTimer = null;

function utcDayKey() {
    return new Date().toISOString().slice(0, 10);
}

function chatLockStorageKey() {
    return (window.GradelyticsDB && typeof GradelyticsDB.getCacheKey === 'function')
        ? GradelyticsDB.getCacheKey(CHAT_LOCK_KEY)
        : CHAT_LOCK_KEY;
}

function setChatLocked(locked, notice) {
    chatLocked = locked;
    const sendBtn = document.getElementById('chat-send-btn');
    const input = document.getElementById('chat-input');
    if (sendBtn) {
        sendBtn.disabled = locked;
        if (locked) {
            sendBtn.setAttribute('title', notice || 'AI limit reached');
            sendBtn.setAttribute('aria-disabled', 'true');
        } else {
            sendBtn.removeAttribute('title');
            sendBtn.removeAttribute('aria-disabled');
        }
    }
    if (input) {
        input.placeholder = locked ? (notice || 'AI limit reached') : 'Ask Gradelytics AI...';
    }
}

function restoreChatQuotaLock() {
    let stored = null;
    try { stored = localStorage.getItem(chatLockStorageKey()); } catch (e) { stored = null; }
    if (!stored) return;
    if (stored === utcDayKey()) {
        setChatLocked(true, CHAT_LOCK_DAY_MESSAGE);
    } else {
        try { localStorage.removeItem(chatLockStorageKey()); } catch (e) { /* ignore */ }
    }
}

function applyQuotaLock(err) {
    if (!err || !err.isQuota) return;
    if (err.quotaScope === 'day') {
        try { localStorage.setItem(chatLockStorageKey(), utcDayKey()); } catch (e) { /* ignore */ }
        setChatLocked(true, CHAT_LOCK_DAY_MESSAGE);
        return;
    }
    if (chatUnlockTimer) clearTimeout(chatUnlockTimer);
    setChatLocked(true, 'Too many requests — you can send again in a moment.');
    chatUnlockTimer = setTimeout(function () { setChatLocked(false); }, 60000);
}

function sendChatMessage() {
    if (chatLocked) return;
    if (typeof GradelyticsDB !== 'undefined' && !GradelyticsDB.requireAuth('Sign in to chat with Gradelytics AI.')) {
        return;
    }
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
        }).catch(err => {
            hideChatTyping();
            addChatMessage('assistant', aiFailureMessage(err));
            applyQuotaLock(err);
        });
    } catch (err) {
        hideChatTyping();
        addChatMessage('assistant', aiFailureMessage(err));
        applyQuotaLock(err);
    }
}

function aiFailureMessage(err) {
    if (err && (err.isQuota || err.isAuth)) return err.message;
    return 'Lots of users are accessing the app right now. Please try again in a moment.';
}

function addChatMessage(role, content) {
    chatMessages.push({ role, content });
    localStorage.setItem(chatStorageKey(), JSON.stringify(chatMessages));
    if (window.GradelyticsDB) {
        GradelyticsDB.addChatMessage(role, content);
    }
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
    restoreChatQuotaLock();
}

function showChatTyping() {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    const typingEl = document.createElement('div');
    typingEl.className = 'chat-message assistant typing';
    typingEl.id = 'chat-typing';
    typingEl.innerHTML = '<div class="chat-bubble chat-bubble-loading"><div class="typing-indicator"><span></span><span></span><span></span></div><span class="chat-status-word"></span></div>';
    container.appendChild(typingEl);
    container.scrollTop = container.scrollHeight;
    startStatusLoader(typingEl.querySelector('.chat-status-word'), [
        'Sleuthing', 'Contemplating', 'Deciphering', 'Analyzing',
        'Crunching', 'Scanning', 'Reading', 'Composing'
    ]);
}

function hideChatTyping() {
    stopStatusLoader();
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
        localStorage.removeItem(chatStorageKey());
        if (window.GradelyticsDB) {
            GradelyticsDB.clearChatMessages();
        }
        renderChatMessages();
        document.getElementById('confirm-modal').classList.remove('open');
        showToast('Chat messages cleared.', 'success');
    };
    const onNo = () => {
        cleanup();
        document.getElementById('confirm-modal').classList.remove('open');
    };

    yesBtn.addEventListener('click', onYes);
    noBtn.addEventListener('click', onNo);
}

function insertSuggestedPrompt(prompt) {
    if (chatLocked) return;
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
