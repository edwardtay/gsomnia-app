const express = require('express');
const cors = require('cors');
const { SDK, SchemaEncoder } = require('@somnia-chain/streams');
const { createPublicClient, http, createWalletClient, toHex } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { verifyMessage } = require('ethers');
const { dreamChain } = require('./dream-chain');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const PUBLISHED_TX_FILE = path.join(DATA_DIR, 'publishedByTx.json');
const PRESET_COUNTS_FILE = path.join(DATA_DIR, 'presetCounts.json');
const BLOCK_LOOKBACK = Number(process.env.BLOCK_LOOKBACK || 2000);

// in-memory stores
const publishedById = new Map(); // idKey -> txHash
const publishedByTx = new Map(); // txHash -> {message,timestamp,sender}
const presetCounts = new Map();
const KNOWN_PRESETS = ['gsomnia', '$SOMI to da moon', 'LFG somnia'];
for (const p of KNOWN_PRESETS) presetCounts.set(p, 0);
const allSenders = new Set();

// ensure data dir and load persisted
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
try {
  if (fs.existsSync(PUBLISHED_TX_FILE)) {
    const raw = fs.readFileSync(PUBLISHED_TX_FILE, 'utf8');
    const obj = JSON.parse(raw || '{}');
    for (const [tx, rec] of Object.entries(obj)) publishedByTx.set(tx, rec);
    for (const [tx, rec] of publishedByTx.entries()) {
      const idKey = `${rec.timestamp}-${rec.message}-${rec.sender}`;
      publishedById.set(idKey, tx);
    }
  }
} catch (e) { console.error('load publishedByTx failed', e); }
try {
  if (fs.existsSync(PRESET_COUNTS_FILE)) {
    const raw = fs.readFileSync(PRESET_COUNTS_FILE, 'utf8');
    const obj = JSON.parse(raw || '{}');
    for (const [p, c] of Object.entries(obj)) presetCounts.set(p, Number(c) || 0);
  }
} catch (e) { console.error('load presetCounts failed', e); }

function persistPublishedByTx() {
  try {
    const out = {};
    for (const [tx, rec] of publishedByTx.entries()) out[tx] = rec;
    fs.writeFileSync(PUBLISHED_TX_FILE, JSON.stringify(out, null, 2), 'utf8');
  } catch (e) { console.error('persistPublishedByTx error', e); }
}
function persistPresetCounts() {
  try {
    const out = {};
    for (const [p, c] of presetCounts.entries()) out[p] = c;
    fs.writeFileSync(PRESET_COUNTS_FILE, JSON.stringify(out, null, 2), 'utf8');
  } catch (e) { console.error('persistPresetCounts error', e); }
}

const app = express();
const port = process.env.PORT || 3001;
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.static('public'));

// SSE clients
const clients = new Set();
function sendEvent(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch (e) {}
  }
}

app.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/stream-info', async (req, res) => {
  try {
    const publisherWallet = process.env.PUBLISHER_WALLET || process.env.PUBLIC_KEY;
    if (!publisherWallet) return res.status(400).json({ error: 'PUBLISHER_WALLET not configured' });
    
    const publicClient = createPublicClient({ chain: dreamChain, transport: http() });
    const sdk = new SDK({ public: publicClient });
    const helloSchema = `string message, uint256 timestamp, address sender`;
    const schemaId = await sdk.streams.computeSchemaId(helloSchema);
    
    return res.json({
      streamId: schemaId,
      publisherWallet,
      network: 'Somnia Testnet',
      chainId: dreamChain.id
    });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.get('/status', async (req, res) => {
  try {
    const publicClient = createPublicClient({ chain: dreamChain, transport: http() });
    const block = await publicClient.getBlockNumber();
    return res.json({ ok: true, chainId: dreamChain.id, blockNumber: block, hasServerKey: !!process.env.PRIVATE_KEY, publisherWallet: process.env.PUBLISHER_WALLET || process.env.PUBLIC_KEY });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err), hasServerKey: !!process.env.PRIVATE_KEY });
  }
});

// helper: scan recent blocks for txs whose calldata contains the utf8 bytes of message
async function tryResolveTxForMessage(publicClient, message, fromBlock, toBlock) {
  try {
    if (!message) return null;
    const msgHex = Buffer.from(String(message), 'utf8').toString('hex');
    for (let b = toBlock; b >= fromBlock; b--) {
      try {
        const block = await publicClient.getBlock({ blockNumber: BigInt(b), includeTransactions: true });
        const txs = block?.transactions || [];
        for (const tx of txs) {
          const data = (tx.data || '').replace(/^0x/, '').toLowerCase();
          if (!data) continue;
          if (data.includes(msgHex)) return tx.hash;
        }
      } catch (e) { /* continue */ }
    }
    return null;
  } catch (e) { return null; }
}

// messages: fetch on-chain publisher data and return items; also attempt background tx resolution
app.get('/messages', async (req, res) => {
  try {
    const publisherWallet = process.env.PUBLISHER_WALLET || process.env.PUBLIC_KEY;
    if (!publisherWallet) return res.status(400).json({ error: 'PUBLISHER_WALLET or PUBLIC_KEY not set on server' });

    const publicClient = createPublicClient({ chain: dreamChain, transport: http() });
    const sdk = new SDK({ public: publicClient });
    const helloSchema = `string message, uint256 timestamp, address sender`;
    const schemaId = await sdk.streams.computeSchemaId(helloSchema);

    const allData = await sdk.streams.getAllPublisherDataForSchema(schemaId, publisherWallet);
    if (!allData || !Array.isArray(allData)) return res.json([]);

  const explorerBase = process.env.EXPLORER_TX_URL || null;
  const items = [];
    for (const dataItem of allData) {
      let message = '', timestamp = '', sender = '';
      for (const field of dataItem) {
        const val = field.value?.value ?? field.value;
        if (field.name === 'message') message = val;
        if (field.name === 'timestamp') timestamp = val.toString();
        if (field.name === 'sender') sender = val;
      }
      const idKey = `${timestamp}-${message}-${sender}`;
      const tx = publishedById.get(idKey) || null;
      const explorer = tx && explorerBase ? `${explorerBase}${tx}` : null;
      items.push({ message, timestamp: Number(timestamp), sender, tx, explorer, idKey });
    }

    // sort ascending (oldest first) before sending to UI — UI expects oldest→newest
    items.sort((a, b) => a.timestamp - b.timestamp);

    // background resolution: try to find missing txs in recent blocks
    (async () => {
      try {
        const latestBlock = await publicClient.getBlockNumber();
        const from = Math.max(0, Number(latestBlock) - BLOCK_LOOKBACK);
        let found = 0;
        for (const it of items) {
          if (it.tx) continue;
          const txHash = await tryResolveTxForMessage(publicClient, it.message, from, Number(latestBlock));
          if (txHash) {
            console.log(`Resolved tx for message "${it.message}": ${txHash}`);
            publishedById.set(it.idKey, txHash);
            publishedByTx.set(txHash, { message: it.message, timestamp: it.timestamp, sender: it.sender });
            persistPublishedByTx();
            found++;
          }
        }
        if (found > 0) console.log(`Background tx resolution: found ${found} txs`);
      } catch (e) { console.error('tx resolution error:', e); }
    })();

    // return items without internal idKey
    return res.json(items.map(({ idKey, ...rest }) => rest));
  } catch (err) {
    console.error('messages error', err);
    return res.status(500).json({ error: 'failed to fetch messages', details: String(err) });
  }
});

// stats: unique senders count
app.get('/stats', async (req, res) => {
  try {
    const publisherWallet = process.env.PUBLISHER_WALLET || process.env.PUBLIC_KEY;
    const publicClient = createPublicClient({ chain: dreamChain, transport: http() });
    const sdk = new SDK({ public: publicClient });
    const helloSchema = `string message, uint256 timestamp, address sender`;
    const schemaId = await sdk.streams.computeSchemaId(helloSchema);

    const senders = new Set();
    for (const v of publishedByTx.values()) senders.add((v.sender || '').toLowerCase());

    if (publisherWallet) {
      try {
        const allData = await sdk.streams.getAllPublisherDataForSchema(schemaId, publisherWallet);
        if (allData && Array.isArray(allData)) {
          for (const dataItem of allData) {
            for (const field of dataItem) {
              if (field.name === 'sender') {
                const val = field.value?.value ?? field.value;
                if (val) senders.add(String(val).toLowerCase());
              }
            }
          }
        }
      } catch (e) { /* ignore */ }
    }

    return res.json({ uniqueSenders: senders.size });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// leaderboard
app.get('/leaderboard', (req, res) => {
  try {
    const arr = Array.from(presetCounts.entries()).map(([preset, count]) => ({ preset, count }));
    arr.sort((a, b) => b.count - a.count);
    return res.json(arr);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.post('/sync-winners', async (req, res) => {
  try {
    const publisherWallet = process.env.PUBLISHER_WALLET || process.env.PUBLIC_KEY;
    if (!publisherWallet) return res.status(400).json({ error: 'PUBLISHER_WALLET not set' });
    
    const publicClient = createPublicClient({ chain: dreamChain, transport: http() });
    const sdk = new SDK({ public: publicClient });
    const helloSchema = `string message, uint256 timestamp, address sender`;
    const schemaId = await sdk.streams.computeSchemaId(helloSchema);
    const allData = await sdk.streams.getAllPublisherDataForSchema(schemaId, publisherWallet);
    
    const synced = [];
    for (let i = 0; i < allData.length; i++) {
      const msgNum = i + 1;
      if (msgNum % 10 === 0 && !setMilestones.has(msgNum)) {
        const dataItem = allData[i];
        let sender = '';
        for (const field of dataItem) {
          const val = field.value?.value ?? field.value;
          if (field.name === 'sender') sender = val;
        }
        setMilestones.add(msgNum);
        await setMilestoneWinner(msgNum, sender);
        synced.push({ milestone: msgNum, winner: sender });
      }
    }
    
    return res.json({ ok: true, synced });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// publish endpoint
app.post('/publish', async (req, res) => {
  const { message, timestamp, signer, signature } = req.body || {};
  const preset = req.body?.preset || null;
  if (!message || !timestamp || !signer || !signature) return res.status(400).json({ error: 'missing fields (message, timestamp, signer, signature)' });

  try {
    const payload = JSON.stringify({ message, timestamp });
    const recovered = verifyMessage(payload, signature);
    if (recovered.toLowerCase() !== signer.toLowerCase()) return res.status(400).json({ error: 'signature mismatch' });
  } catch (err) { return res.status(400).json({ error: 'invalid signature', details: String(err) }); }

  if (!process.env.PRIVATE_KEY) return res.status(500).json({ error: 'server missing PRIVATE_KEY for publishing' });

  try {
    const publicClient = createPublicClient({ chain: dreamChain, transport: http() });
    const walletClient = createWalletClient({ account: privateKeyToAccount(process.env.PRIVATE_KEY), chain: dreamChain, transport: http() });
    const sdkPubl = new SDK({ public: publicClient, wallet: walletClient });
    const helloSchema = `string message, uint256 timestamp, address sender`;
    const schemaId = await sdkPubl.streams.computeSchemaId(helloSchema);
    const encoder = new SchemaEncoder(helloSchema);
    const data = encoder.encodeData([
      { name: 'message', value: message, type: 'string' },
      { name: 'timestamp', value: BigInt(timestamp), type: 'uint256' },
      { name: 'sender', value: signer, type: 'address' },
    ]);
    const idHex = toHex(`hello-${timestamp}`, { size: 32 });
    const dataStreams = [{ id: idHex, schemaId, data }];
    const tx = await sdkPubl.streams.set(dataStreams);
    let txHash = null;
    if (!tx) txHash = null;
    else if (typeof tx === 'string') txHash = tx;
    else if (tx.hash) txHash = tx.hash;
    else if (tx.transactionHash) txHash = tx.transactionHash;
    else if (tx.txHash) txHash = tx.txHash;

    const idKey = `${timestamp}-${message}-${signer}`;
    if (txHash) {
      publishedById.set(idKey, txHash);
      publishedByTx.set(txHash, { message, timestamp: Number(timestamp), sender: signer });
      persistPublishedByTx();
    }

    // increment preset counts
    try {
      let p = preset;
      if (!p) {
        for (const candidate of KNOWN_PRESETS) if (String(message).trim() === candidate) { p = candidate; break; }
      }
      if (p && presetCounts.has(p)) { presetCounts.set(p, (presetCounts.get(p) || 0) + 1); persistPresetCounts(); }
    } catch (e) { }

    if (signer) allSenders.add(signer.toLowerCase());

    const explorerBase = process.env.EXPLORER_TX_URL || null;
    return res.json({ ok: true, tx: txHash, explorer: explorerBase ? `${explorerBase}${txHash}` : null });
  } catch (err) {
    console.error('publish error', err);
    return res.status(500).json({ error: 'publish failed', details: String(err) });
  }
});

// tx viewer
app.get('/tx/:hash', async (req, res) => {
  const { hash } = req.params;
  if (!hash) return res.status(400).send('missing tx hash');
  const explorerBase = process.env.EXPLORER_TX_URL || null;
  const record = publishedByTx.get(hash) || null;
  if (record) {
    return res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Tx ${hash}</title></head><body style="font-family:system-ui,Arial;margin:20px;background:#0f1724;color:#e6eef8"><h1>Transaction ${hash}</h1><p><strong>Message:</strong> ${escapeHtml(record.message)}</p><p><strong>Sender:</strong> ${record.sender}</p><p><strong>Timestamp:</strong> ${new Date(record.timestamp * 1000).toLocaleString()}</p><p><a href="/">Back to feed</a> ${explorerBase?` - <a href="${explorerBase}${hash}" target="_blank">View on explorer</a>`:''}</p></body></html>`);
  }
  if (explorerBase) return res.redirect(`${explorerBase}${hash}`);
  return res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Tx ${hash}</title></head><body style="font-family:system-ui,Arial;margin:20px;background:#0f1724;color:#e6eef8"><h1>Transaction ${hash}</h1><p>No additional data available on this server.</p><p><a href="/">Back to feed</a></p></body></html>`);
});

function escapeHtml(s) { return (s + '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

async function setMilestoneWinner(milestone, winner) {
  try {
    const NFT_ADDRESS = '0x1330fF8C16fDDF65e3A09e3c552C43B9D930C216';
    const walletClient = createWalletClient({ account: privateKeyToAccount(process.env.PRIVATE_KEY), chain: dreamChain, transport: http() });
    const { keccak256, toBytes } = require('viem');
    const selector = keccak256(toBytes('setMilestoneWinner(uint256,address)')).slice(0, 10);
    const data = selector + milestone.toString(16).padStart(64, '0') + winner.slice(2).padStart(64, '0');
    await walletClient.sendTransaction({ to: NFT_ADDRESS, data });
    console.log(`Set milestone ${milestone} winner: ${winner}`);
  } catch (err) {
    console.error(`Failed to set milestone ${milestone}:`, err.message);
  }
}

const setMilestones = new Set();

async function startPolling() {
  const publisherWallet = process.env.PUBLISHER_WALLET || process.env.PUBLIC_KEY;
  if (!publisherWallet) {
    console.warn('No PUBLISHER_WALLET or PUBLIC_KEY set in .env — server will still run but no data will be polled.');
  }

  const publicClient = createPublicClient({ chain: dreamChain, transport: http() });
  // create wallet client if server PRIVATE_KEY is present so server can publish
  let sdk;
  const privateKey = process.env.PRIVATE_KEY;
  if (privateKey) {
    const walletClient = createWalletClient({
      account: privateKeyToAccount(privateKey),
      chain: dreamChain,
      transport: http(),
    });
    sdk = new SDK({ public: publicClient, wallet: walletClient });
  } else {
    sdk = new SDK({ public: publicClient });
  }

  const helloSchema = `string message, uint256 timestamp, address sender`;
  const schemaId = await sdk.streams.computeSchemaId(helloSchema);
  console.log('Watching schemaId:', schemaId);

  const seen = new Set();

  async function pollOnce() {
    try {
      if (!publisherWallet) return;
      const allData = await sdk.streams.getAllPublisherDataForSchema(schemaId, publisherWallet);
      if (!allData || !Array.isArray(allData)) return;

      for (let i = 0; i < allData.length; i++) {
        const dataItem = allData[i];
        let message = '', timestamp = '', sender = '';
        for (const field of dataItem) {
          const val = field.value?.value ?? field.value;
          if (field.name === 'message') message = val;
          if (field.name === 'timestamp') timestamp = val.toString();
          if (field.name === 'sender') sender = val;
        }
        const id = `${timestamp}-${message}-${sender}`;
        if (sender) allSenders.add(sender.toLowerCase());
        if (!seen.has(id)) {
          seen.add(id);
          const tx = publishedById.get(id) || null;
          const item = { message, timestamp: Number(timestamp), sender, tx };
          console.log('New:', item);
          sendEvent({ type: 'message', item });
        }
        
        const msgNum = i + 1;
        if (msgNum % 10 === 0 && !setMilestones.has(msgNum)) {
          setMilestones.add(msgNum);
          setMilestoneWinner(msgNum, sender);
        }
      }
    } catch (err) {
      const containsNoData =
        (err && err.metaMessages && err.metaMessages.some(m => String(m).includes('NoData'))) ||
        String(err).includes('NoData') ||
        String(err).includes('NoData()');

      if (containsNoData) return; // nothing published yet
      console.error('Polling error:', err);
    }
  }

  // first poll quickly, then every 3s
  await pollOnce();
  setInterval(pollOnce, 3000);
  
  // sync winners on startup
  setTimeout(async () => {
    try {
      const allData = await sdk.streams.getAllPublisherDataForSchema(schemaId, publisherWallet);
      for (let i = 0; i < allData.length; i++) {
        const msgNum = i + 1;
        if (msgNum % 10 === 0 && !setMilestones.has(msgNum)) {
          const dataItem = allData[i];
          let sender = '';
          for (const field of dataItem) {
            const val = field.value?.value ?? field.value;
            if (field.name === 'sender') sender = val;
          }
          setMilestones.add(msgNum);
          await setMilestoneWinner(msgNum, sender);
        }
      }
    } catch (e) { console.error('Initial winner sync failed:', e.message); }
  }, 2000);
}

startPolling().catch(err => console.error('Polling failed to start:', err));

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

