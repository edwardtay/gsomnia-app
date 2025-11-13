const statusEl = document.getElementById('status');
const listEl = document.getElementById('messages');
const statsEl = document.getElementById('stats');
const streamInfoEl = document.getElementById('stream-info');
const paginationEl = document.getElementById('pagination');

let allMessages = [];
let filteredMessages = [];
let currentPage = 1;
const messagesPerPage = 10;
let autoRefreshEnabled = true;
let autoRefreshInterval = null;
let totalGasUsed = 0;

// LocalStorage cache
const CACHE_KEY = 'gsomnia_messages';
const CACHE_TIMESTAMP_KEY = 'gsomnia_cache_time';

function loadFromCache() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    const cacheTime = localStorage.getItem(CACHE_TIMESTAMP_KEY);
    if (cached && cacheTime) {
      const age = Date.now() - parseInt(cacheTime);
      if (age < 60000) {
        allMessages = JSON.parse(cached);
        filteredMessages = [...allMessages];
        renderPage(1);
        return true;
      }
    }
  } catch (e) {}
  return false;
}

function saveToCache(messages) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(messages));
    localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
  } catch (e) {}
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => {
    toast.className = 'toast';
  }, 3000);
}

function shortAddress(addr) {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function copyToClipboard(text, label) {
  navigator.clipboard.writeText(text).then(() => {
    showToast(`${label} copied!`, 'success');
  }).catch(() => {
    showToast('Copy failed', 'error');
  });
}

function relativeTime(timestamp) {
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

async function fetchStreamInfo() {
  try {
    const resp = await fetch('/stream-info');
    if (!resp.ok) {
        streamInfoEl.innerHTML = '';
        return;
      }
    const info = await resp.json();
    const totalMsgs = allMessages.length;
    const milestones = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const rewardWinners = milestones.filter(m => totalMsgs >= m).map(m => {
      const msg = allMessages[allMessages.length - m];
      return { milestone: m, sender: msg.sender };
    });
    streamInfoEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div><span class="label">Network:</span> <span class="value">${info.network} | Chain ID: 50312 (0xc488)</span></div>
        <div><span class="label">Stream ID:</span> <span class="value">${shortAddress(info.streamId)}</span> <button class="copy-btn" onclick="copyToClipboard('${info.streamId}', 'Stream ID')">📋</button></div>
        <div><span class="label">Total Messages:</span> <span class="value">${totalMsgs}</span></div>
      </div>
    `;
    
    const milestoneWinnersEl = document.getElementById('milestone-winners');
    if (milestoneWinnersEl) {
      if (rewardWinners.length > 0) {
        milestoneWinnersEl.innerHTML = `<div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);padding:12px;border-radius:8px;"><div style="color:#10b981;font-weight:600;margin-bottom:8px;">🏆 NFT Reward Winners:</div>${rewardWinners.map(w => `<div style="margin-top:6px;color:#e2e8f0;display:flex;justify-content:space-between;align-items:center;padding:4px 0;"><span><strong>#${w.milestone}:</strong> ${shortAddress(w.sender)}</span><button class="copy-btn" onclick="copyToClipboard('${w.sender}', '#${w.milestone} winner')" style="color:#10b981;">📋 Copy</button></div>`).join('')}</div>`;
      } else {
        milestoneWinnersEl.innerHTML = '';
      }
    }
    
    // Check if connected user can claim
    const claimSectionEl = document.getElementById('claim-section');
    if (claimSectionEl && signerAddress) {
      const userWins = rewardWinners.filter(w => w.sender.toLowerCase() === signerAddress.toLowerCase());
      if (userWins.length > 0) {
        claimSectionEl.innerHTML = `<div style="background:rgba(16,185,129,0.15);border:2px solid rgba(16,185,129,0.4);padding:16px;border-radius:8px;text-align:center;"><div style="color:#10b981;font-weight:700;font-size:16px;margin-bottom:12px;">🎉 You Won! Claim Your NFT</div><div style="color:#e2e8f0;margin-bottom:12px;font-size:14px;">You sent milestone message(s): ${userWins.map(w => `#${w.milestone}`).join(', ')}</div>${userWins.map(w => `<button onclick="claimNFT(${w.milestone})" class="wallet-btn" style="margin:4px;">🏆 Claim #${w.milestone} NFT</button>`).join('')}</div>`;
      } else {
        claimSectionEl.innerHTML = '';
      }
    }
  } catch (err) {
    streamInfoEl.innerHTML = '';
  }
}

async function fetchStats() {
  try {
    const resp = await fetch('/stats');
    if (!resp.ok) return;
    const j = await resp.json();
    statsEl.textContent = `Unique senders: ${j.uniqueSenders}`;
  } catch (err) {
    // ignore
  }
}

async function fetchLeaderboard() {
  try {
    const resp = await fetch('/leaderboard');
    if (!resp.ok) return;
    const arr = await resp.json();
    const lb = document.getElementById('leaderboard');
    if (!lb) return;
    if (!arr || !arr.length) {
      lb.textContent = 'No preset usage yet.';
      return;
    }
    lb.innerHTML = '<strong>Preset leaderboard</strong>: ' + arr.map(a => `${a.preset} (${a.count})`).join(' • ');
  } catch (err) {
    // ignore
  }
}

function renderPage(page) {
  currentPage = page;
  listEl.innerHTML = '';
  
  const emptyState = document.getElementById('empty-state');
  if (filteredMessages.length === 0) {
    if (emptyState) emptyState.style.display = 'block';
    listEl.style.display = 'none';
    renderPagination();
    return;
  }
  
  if (emptyState) emptyState.style.display = 'none';
  listEl.style.display = 'block';
  
  const start = (page - 1) * messagesPerPage;
  const end = start + messagesPerPage;
  const pageItems = filteredMessages.slice(start, end);
  
  for (const it of pageItems) {
    const li = document.createElement('li');
    li.className = 'msg';
    const time = new Date(it.timestamp * 1000).toLocaleTimeString();
    const relTime = relativeTime(it.timestamp);
    const timeHtml = it.explorer ? `<a href="${it.explorer}" target="_blank" class="time-link" title="${time}">${relTime}</a>` : `<span title="${time}">${relTime}</span>`;
    const shortAddr = shortAddress(it.sender);
    const messageHtml = escapeHtml(it.message);
    li.innerHTML = `<div class="meta">${timeHtml} — <span class="sender" title="${it.sender}">${shortAddr}</span> <button class="copy-btn" onclick="copyToClipboard('${it.sender}', 'Address')">📋</button> ${it.tx ? `<button class="copy-btn" onclick="copyToClipboard('${it.tx}', 'Tx hash')">🔗</button>` : ''}</div><div class="text">${messageHtml}</div>`;
    listEl.appendChild(li);
  }
  
  renderPagination();
  fetchStreamInfo();
}

function renderPagination() {
  const totalPages = Math.ceil(filteredMessages.length / messagesPerPage);
  paginationEl.innerHTML = '';
  
  if (totalPages <= 1) return;
  
  const prevBtn = document.createElement('button');
  prevBtn.textContent = '← Prev';
  prevBtn.className = 'page-btn';
  prevBtn.disabled = currentPage === 1;
  prevBtn.onclick = () => renderPage(currentPage - 1);
  paginationEl.appendChild(prevBtn);
  
  const maxButtons = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  if (endPage - startPage < maxButtons - 1) startPage = Math.max(1, endPage - maxButtons + 1);
  
  if (startPage > 1) {
    const btn = document.createElement('button');
    btn.textContent = '1';
    btn.className = 'page-btn';
    btn.onclick = () => renderPage(1);
    paginationEl.appendChild(btn);
    if (startPage > 2) {
      const dots = document.createElement('span');
      dots.textContent = '...';
      dots.style.padding = '8px';
      dots.style.color = '#64748b';
      paginationEl.appendChild(dots);
    }
  }
  
  for (let i = startPage; i <= endPage; i++) {
    const btn = document.createElement('button');
    btn.textContent = i;
    btn.className = 'page-btn' + (i === currentPage ? ' active' : '');
    btn.onclick = () => renderPage(i);
    paginationEl.appendChild(btn);
  }
  
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      const dots = document.createElement('span');
      dots.textContent = '...';
      dots.style.padding = '8px';
      dots.style.color = '#64748b';
      paginationEl.appendChild(dots);
    }
    const btn = document.createElement('button');
    btn.textContent = totalPages;
    btn.className = 'page-btn';
    btn.onclick = () => renderPage(totalPages);
    paginationEl.appendChild(btn);
  }
  
  const nextBtn = document.createElement('button');
  nextBtn.textContent = 'Next →';
  nextBtn.className = 'page-btn';
  nextBtn.disabled = currentPage === totalPages;
  nextBtn.onclick = () => renderPage(currentPage + 1);
  paginationEl.appendChild(nextBtn);
}

function showSkeletons() {
  listEl.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton';
    listEl.appendChild(skeleton);
  }
}

async function loadHistorical() {
  try {
    const resp = await fetch('/messages');
    if (!resp.ok) return;
    const items = await resp.json();
    allMessages = items.slice().reverse();
    filteredMessages = [...allMessages];
    saveToCache(allMessages);
    applySearch();
  } catch (err) {
    console.error('failed to load historical messages', err);
  }
}

function applySearch() {
  const searchInput = document.getElementById('search');
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
  
  if (!query) {
    filteredMessages = [...allMessages];
  } else {
    filteredMessages = allMessages.filter(msg => 
      msg.message.toLowerCase().includes(query) || 
      msg.sender.toLowerCase().includes(query)
    );
  }
  
  renderPage(1);
}

// fetch stream info once
fetchStreamInfo();

// poll stats every 5s
fetchStats();
setInterval(fetchStats, 5000);

// load from cache first, then fetch
if (!loadFromCache()) {
  showSkeletons();
}
loadHistorical();

// auto-refresh setup
function startAutoRefresh() {
  if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  autoRefreshInterval = setInterval(() => {
    if (autoRefreshEnabled) loadHistorical();
  }, 10000);
}

startAutoRefresh();

// search handler
const searchInput = document.getElementById('search');
if (searchInput) {
  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(applySearch, 300);
  });
}

// auto-refresh toggle
const autoRefreshCheckbox = document.getElementById('auto-refresh');
if (autoRefreshCheckbox) {
  autoRefreshCheckbox.addEventListener('change', (e) => {
    autoRefreshEnabled = e.target.checked;
    showToast(autoRefreshEnabled ? 'Auto-refresh enabled' : 'Auto-refresh paused', 'success');
  });
}

// character counter
const msgInput = document.getElementById('msg');
const charCount = document.getElementById('char-count');
if (msgInput && charCount) {
  msgInput.addEventListener('input', () => {
    const len = msgInput.value.length;
    charCount.textContent = `${len}/280`;
    charCount.style.color = len > 250 ? '#ef4444' : '#64748b';
  });
}

// refresh button handler
const refreshBtn = document.getElementById('refresh-btn');
if (refreshBtn) {
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Loading...';
    showSkeletons();
    await loadHistorical();
    await updateBalance();
    refreshBtn.textContent = '🔄 Refresh Messages';
    refreshBtn.disabled = false;
    await updateBalance(true);
    showToast('Messages refreshed', 'success');
  });
}

// publish panel toggle
const publishToggleBtn = document.getElementById('publish-toggle-btn');
const publisherPanel = document.getElementById('publisher-panel');
if (publishToggleBtn && publisherPanel) {
  publishToggleBtn.addEventListener('click', () => {
    publisherPanel.style.display = publisherPanel.style.display === 'none' ? 'block' : 'none';
  });
}



function escapeHtml(s) {
  return (s + '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Publisher functionality
let signerAddress = null;
let provider = null;

const connectBtn = document.getElementById('connect');
const pubStatusEl = document.getElementById('pub-status');
const sendBtn = document.getElementById('send');
const msgEl = document.getElementById('msg');
const resultEl = document.getElementById('result');
const presetButtons = document.querySelectorAll('.preset-btn');

async function updateBalance(forceRefresh = false) {
  if (!signerAddress) return;
  try {
    const timestamp = forceRefresh ? `&t=${Date.now()}` : '';
    const resp = await fetch(`https://dream-rpc.somnia.network${timestamp}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [signerAddress, 'latest'], id: Date.now() })
    });
    const json = await resp.json();
    if (json.result) {
      const balanceInEth = (parseInt(json.result, 16) / 1e18).toFixed(4);
      pubStatusEl.innerHTML = `Connected: ${signerAddress} <span style="color:#10b981;margin-left:12px;">${balanceInEth} STT</span>`;
    } else {
      pubStatusEl.textContent = `Connected: ${signerAddress}`;
    }
  } catch (err) {
    if (provider) {
      try {
        const balance = await provider.request({ method: 'eth_getBalance', params: [signerAddress, 'latest'] });
        const balanceInEth = (parseInt(balance, 16) / 1e18).toFixed(4);
        pubStatusEl.innerHTML = `Connected: ${signerAddress} <span style="color:#10b981;margin-left:12px;">${balanceInEth} STT</span>`;
      } catch (e) {
        pubStatusEl.textContent = `Connected: ${signerAddress}`;
      }
    } else {
      pubStatusEl.textContent = `Connected: ${signerAddress}`;
    }
  }
}

if (connectBtn) {
  connectBtn.addEventListener('click', async () => {
    if (signerAddress) {
      signerAddress = null;
      provider = null;
      pubStatusEl.textContent = 'Not connected';
      connectBtn.textContent = 'Connect Wallet';
      return;
    }
    if (!window.ethereum) {
      pubStatusEl.textContent = 'No wallet found (install MetaMask)';
      return;
    }
    try {
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      provider = window.ethereum;
      const accounts = await provider.request({ method: 'eth_accounts' });
      signerAddress = accounts[0];
      connectBtn.textContent = 'Disconnect';
      await updateBalance(true);
    } catch (err) {
      pubStatusEl.textContent = 'Connection failed';
    }
  });
}

if (sendBtn) {
  sendBtn.addEventListener('click', async () => {
    if (!signerAddress) {
      resultEl.textContent = 'Connect wallet first';
      return;
    }
    const message = msgEl.value?.trim();
    if (!message) {
      resultEl.textContent = 'Enter a message';
      return;
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ message, timestamp });
    
    try {
      const toHex = (s) => '0x' + Array.from(new TextEncoder().encode(s)).map(b => b.toString(16).padStart(2, '0')).join('');
      let signature = null;
      const attempts = [
        { method: 'personal_sign', params: [payload, signerAddress] },
        { method: 'personal_sign', params: [toHex(payload), signerAddress] },
      ];
      for (const attempt of attempts) {
        try {
          signature = await provider.request(attempt);
          if (signature) break;
        } catch (err) {}
      }
      if (!signature) throw new Error('Failed to sign');
      
      resultEl.textContent = 'Publishing...';
      const PRESETS = ['gsomnia', '$SOMI to da moon', 'LFG somnia'];
      let usedPreset = null;
      for (const p of PRESETS) if (p === message) { usedPreset = p; break; }
      
      const resp = await fetch('/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, timestamp, signer: signerAddress, signature, preset: usedPreset }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        let errorMsg = json.details || json.error || JSON.stringify(json);
        if (errorMsg.includes('insufficient balance')) errorMsg = 'Insufficient gas';
        resultEl.textContent = `Failed: ${errorMsg}`;
        showToast(errorMsg, 'error');
      } else {
        const txHash = json.tx;
        if (txHash) {
          const explorerUrl = `https://shannon-explorer.somnia.network/tx/${txHash}`;
          resultEl.innerHTML = `Published — tx: <a href="${explorerUrl}" target="_blank" style="color:#60a5fa;">${shortAddress(txHash)}</a> <button class="copy-btn" onclick="copyToClipboard('${txHash}', 'Tx hash')">📋</button>`;
          totalGasUsed += 0.001;
          showToast('Message published!', 'success');
        } else {
          resultEl.textContent = 'Published';
          showToast('Message published!', 'success');
        }
        msgEl.value = '';
        if (charCount) charCount.textContent = '0/280';
        await updateBalance(true);
        setTimeout(async () => {
          await loadHistorical();
          const msgCount = allMessages.length;
          if (msgCount % 10 === 0 && msgCount > 0) {
            const winner = allMessages[allMessages.length - 1];
            if (winner.sender.toLowerCase() === signerAddress.toLowerCase()) {
              showToast(`🏆 Congratulations! You sent the ${msgCount}th message and won a reward!`, 'success');
              setTimeout(() => {
                alert(`🏆 MILESTONE WINNER!\n\nYou sent the ${msgCount}th message!\n\nYour winning address:\n${signerAddress}\n\nHOW TO CLAIM YOUR NFT:\n1. Copy your address above\n2. Verify on Somnia Explorer (check tx link)\n3. Contact team with proof\n4. Receive NFT airdrop to your address\n\nCongratulations! 🎉`);
              }, 1000);
            }
          }
        }, 2000);
      }
    } catch (err) {
      resultEl.textContent = `Error: ${String(err)}`;
    }
  });
}

if (presetButtons) {
  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.getAttribute('data-msg');
      if (v && msgEl) msgEl.value = v;
    });
  });
}

if (window.ethereum) {
  window.ethereum.request({ method: 'eth_accounts' }).then(async accounts => {
    if (accounts && accounts.length) {
      signerAddress = accounts[0];
      provider = window.ethereum;
      if (connectBtn) connectBtn.textContent = 'Disconnect';
      await updateBalance(true);
    }
  });
}

// Info popup
const infoBtn = document.getElementById('info-btn');
const infoPopup = document.getElementById('info-popup');
const closePopup = document.getElementById('close-popup');

if (infoBtn && infoPopup) {
  infoBtn.addEventListener('click', () => {
    infoPopup.style.display = 'flex';
  });
}

if (closePopup && infoPopup) {
  closePopup.addEventListener('click', () => {
    infoPopup.style.display = 'none';
  });
  infoPopup.addEventListener('click', (e) => {
    if (e.target === infoPopup) {
      infoPopup.style.display = 'none';
    }
  });
}

// AI Assistant
const aiBtn = document.getElementById('ai-btn');
const aiPanel = document.getElementById('ai-panel');
const closeAi = document.getElementById('close-ai');
const aiChat = document.getElementById('ai-chat');
const aiInput = document.getElementById('ai-input');
const aiSendBtn = document.getElementById('ai-send');

if (aiBtn && aiPanel) {
  aiBtn.addEventListener('click', () => {
    aiPanel.style.display = aiPanel.style.display === 'none' ? 'block' : 'none';
  });
}

if (closeAi && aiPanel) {
  closeAi.addEventListener('click', () => {
    aiPanel.style.display = 'none';
  });
}

function addAiMessage(text, isUser = false) {
  const msg = document.createElement('div');
  msg.className = `ai-message ${isUser ? 'user' : 'ai'}`;
  msg.textContent = text;
  aiChat.appendChild(msg);
  aiChat.scrollTop = aiChat.scrollHeight;
}

function analyzeMessages(question) {
  const q = question.toLowerCase();
  
  // Count messages
  if (q.includes('how many') || q.includes('count') || q.includes('total message')) {
    return `There are ${allMessages.length} total messages in the stream.`;
  }
  
  // Most active sender
  if (q.includes('most active') || q.includes('who sent') || q.includes('top sender')) {
    const senderCounts = {};
    allMessages.forEach(m => {
      senderCounts[m.sender] = (senderCounts[m.sender] || 0) + 1;
    });
    const sorted = Object.entries(senderCounts).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) return 'No messages yet.';
    const top = sorted.slice(0, 3).map(([addr, count]) => `${shortAddress(addr)} (${count} msgs)`).join(', ');
    return `Most active senders: ${top}`;
  }
  
  // Recent messages
  if (q.includes('recent') || q.includes('latest') || q.includes('last')) {
    const recent = allMessages.slice(0, 5);
    if (recent.length === 0) return 'No messages yet.';
    const summary = recent.map(m => `"${m.message}" by ${shortAddress(m.sender)}`).join(', ');
    return `Recent messages: ${summary}`;
  }
  
  // Summarize
  if (q.includes('summarize') || q.includes('summary') || q.includes('what are people')) {
    if (allMessages.length === 0) return 'No messages to summarize yet.';
    const uniqueSenders = new Set(allMessages.map(m => m.sender)).size;
    const commonWords = {};
    allMessages.forEach(m => {
      m.message.toLowerCase().split(/\s+/).forEach(word => {
        if (word.length > 3) commonWords[word] = (commonWords[word] || 0) + 1;
      });
    });
    const topWords = Object.entries(commonWords).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w).join(', ');
    return `${allMessages.length} messages from ${uniqueSenders} unique senders. Common topics: ${topWords || 'various'}.`;
  }
  
  // Search messages
  if (q.includes('find') || q.includes('search') || q.includes('contains')) {
    const searchTerm = q.replace(/find|search|contains|messages?|about/g, '').trim();
    if (!searchTerm) return 'What would you like me to search for?';
    const matches = allMessages.filter(m => m.message.toLowerCase().includes(searchTerm));
    if (matches.length === 0) return `No messages found containing "${searchTerm}".`;
    return `Found ${matches.length} messages containing "${searchTerm}". Recent: ${matches.slice(0, 3).map(m => `"${m.message}"`).join(', ')}`;
  }
  
  // Unique senders
  if (q.includes('unique') || q.includes('different') || q.includes('how many sender')) {
    const unique = new Set(allMessages.map(m => m.sender)).size;
    return `There are ${unique} unique senders in the stream.`;
  }
  
  // Time analysis
  if (q.includes('when') || q.includes('time') || q.includes('recent activity')) {
    if (allMessages.length === 0) return 'No messages yet.';
    const latest = allMessages[0];
    const oldest = allMessages[allMessages.length - 1];
    return `Latest message: ${relativeTime(latest.timestamp)}. Oldest: ${relativeTime(oldest.timestamp)}. Total: ${allMessages.length} messages.`;
  }
  
  // Default help
  return `I can help you analyze messages! Try asking:\n- "How many messages are there?"\n- "Who is most active?"\n- "Summarize recent messages"\n- "Find messages about [topic]"\n- "When was the last message?"`;
}

async function queryAI(question) {
  return analyzeMessages(question);
}

async function handleAiQuery() {
  const question = aiInput.value.trim();
  if (!question) return;
  
  addAiMessage(question, true);
  aiInput.value = '';
  aiSendBtn.disabled = true;
  aiSendBtn.textContent = 'Thinking...';
  
  const answer = await queryAI(question);
  addAiMessage(answer, false);
  
  aiSendBtn.disabled = false;
  aiSendBtn.textContent = 'Send';
}

if (aiSendBtn && aiInput) {
  aiSendBtn.addEventListener('click', handleAiQuery);
  aiInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAiQuery();
  });
}

// NFT Claim functionality
const NFT_CONTRACT = '0xd2b24B1a5345C17c0BCC022Ac0b2123353bd2122';
const NFT_ABI = [
  {
    "inputs": [{"internalType": "uint256", "name": "milestone", "type": "uint256"}],
    "name": "claim",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

window.claimNFT = async function(milestone) {
  if (!signerAddress || !provider) {
    showToast('Connect wallet first', 'error');
    return;
  }
  
  try {
    showToast('Claiming NFT...', 'success');
    
    const data = provider.request({
      method: 'eth_sendTransaction',
      params: [{
        from: signerAddress,
        to: NFT_CONTRACT,
        data: '0x379607f5' + milestone.toString(16).padStart(64, '0')
      }]
    });
    
    const tx = await data;
    showToast(`NFT claim submitted! Tx: ${tx.slice(0,10)}...`, 'success');
    
    setTimeout(() => {
      alert(`🎉 NFT Claimed!\n\nMilestone: #${milestone}\nTransaction: ${tx}\n\nView on explorer:\nhttps://shannon-explorer.somnia.network/tx/${tx}`);
    }, 1000);
  } catch (err) {
    console.error('Claim error:', err);
    showToast('Claim failed: ' + (err.message || String(err)), 'error');
  }
}
