const connectBtn = document.getElementById('connect');
const statusEl = document.getElementById('pub-status');
const sendBtn = document.getElementById('send');
const msgEl = document.getElementById('msg');
const resultEl = document.getElementById('result');
const presetButtons = document.querySelectorAll('.preset-btn');

let signerAddress = null;
let provider = null;

async function connect() {
  console.log('[Publisher] Connect button clicked');
  if (!window.ethereum) {
    console.error('[Publisher] No injected wallet found');
    statusEl.textContent = 'No injected wallet found (MetaMask).';
    return;
  }
  try {
    console.log('[Publisher] Requesting accounts...');
    await window.ethereum.request({ method: 'eth_requestAccounts' });
    provider = window.ethereum;
    const accounts = await provider.request({ method: 'eth_accounts' });
    signerAddress = accounts[0];
    console.log('[Publisher] Connected:', signerAddress);
    statusEl.textContent = `Connected: ${signerAddress}`;
  } catch (err) {
    console.error('[Publisher] Connection error:', err);
    statusEl.textContent = 'Connection failed';
  }
}

async function signAndPublish() {
  if (!signerAddress) {
    resultEl.textContent = 'Please connect your wallet first.';
    return;
  }
  const message = msgEl.value?.trim();
  if (!message) {
    resultEl.textContent = 'Enter a message first.';
    return;
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ message, timestamp });

  try {
    // Try signing as a string first. Some wallets accept plain strings, others require hex.
    let signature = null;

    // helper to convert utf8 to 0xhex
    const toHex = (s) => {
      return '0x' + Array.from(new TextEncoder().encode(s)).map(b => b.toString(16).padStart(2, '0')).join('');
    };

    // Try common param orders and formats until success
    const attempts = [
      { method: 'personal_sign', params: [payload, signerAddress] },
      { method: 'personal_sign', params: [toHex(payload), signerAddress] },
      // some wallets expect address first
      { method: 'personal_sign', params: [signerAddress, payload] },
      { method: 'personal_sign', params: [signerAddress, toHex(payload)] },
    ];

    for (const attempt of attempts) {
      try {
        signature = await provider.request(attempt);
        if (signature) break;
      } catch (err) {
        // try next attempt
      }
    }

    if (!signature) throw new Error('Failed to sign message with available wallet methods');

    resultEl.textContent = 'Sending to server...';
    // detect which preset (if any) was used by exact match
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
      resultEl.textContent = `Publish failed: ${json.error || JSON.stringify(json)}`;
    } else {
      // show clickable link to tx viewer
      const txHash = json.tx;
      const explorerFull = json.explorer || null;
      if (txHash) {
        resultEl.innerHTML = `Published — server tx: <a href="/tx/${txHash}" target="_blank">${txHash}</a>` + (explorerFull ? ` — <a href="${explorerFull}" target="_blank">View on external explorer</a>` : '');
      } else {
        resultEl.textContent = `Published (no tx returned)`;
      }
      msgEl.value = '';
    }
  } catch (err) {
    console.error('sign/publish error', err);
    resultEl.textContent = `Signing/publish error: ${String(err)} (see console)`;
  }
}

// Helper to ensure payload is the string that gets signed in many wallets
// keep signatureParam for compatibility but not used now
function signatureParam(str) { return str; }

// Initialize event listeners when DOM is ready
function initPublisher() {
  console.log('[Publisher] Initializing...');
  const connectBtn = document.getElementById('connect');
  const statusEl = document.getElementById('pub-status');
  const sendBtn = document.getElementById('send');
  const msgEl = document.getElementById('msg');
  const resultEl = document.getElementById('result');
  const presetButtons = document.querySelectorAll('.preset-btn');

  if (!connectBtn || !statusEl || !sendBtn || !msgEl || !resultEl) {
    console.error('[Publisher] Missing elements:', { connectBtn, statusEl, sendBtn, msgEl, resultEl });
    return;
  }

  console.log('[Publisher] All elements found, attaching listeners...');
  connectBtn.addEventListener('click', connect);
  sendBtn.addEventListener('click', signAndPublish);
  if (presetButtons && presetButtons.length) {
    presetButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-msg');
        if (v) msgEl.value = v;
      });
    });
  }

  // if already connected when page loads
  if (window.ethereum) {
    window.ethereum.request({ method: 'eth_accounts' }).then(accounts => {
      if (accounts && accounts.length) {
        signerAddress = accounts[0];
        statusEl.textContent = `Connected: ${signerAddress}`;
      }
    });
  }
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPublisher);
} else {
  initPublisher();
}
