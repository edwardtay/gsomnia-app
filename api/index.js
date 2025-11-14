// v73fc0fb
const express = require('express');
const cors = require('cors');
const { SDK, SchemaEncoder } = require('@somnia-chain/streams');
const { createPublicClient, http, createWalletClient, toHex } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { verifyMessage } = require('ethers');
const { dreamChain } = require('../dream-chain');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.static('public'));

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

app.get('/messages', async (req, res) => {
  try {
    const publisherWallet = process.env.PUBLISHER_WALLET || process.env.PUBLIC_KEY;
    if (!publisherWallet) return res.status(400).json({ error: 'PUBLISHER_WALLET or PUBLIC_KEY not set' });

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
      items.push({ message, timestamp: Number(timestamp), sender, explorer: explorerBase });
    }

    items.sort((a, b) => a.timestamp - b.timestamp);
    return res.json(items);
  } catch (err) {
    return res.status(500).json({ error: 'failed to fetch messages', details: String(err) });
  }
});

app.get('/stats', async (req, res) => {
  try {
    const publisherWallet = process.env.PUBLISHER_WALLET || process.env.PUBLIC_KEY;
    const publicClient = createPublicClient({ chain: dreamChain, transport: http() });
    const sdk = new SDK({ public: publicClient });
    const helloSchema = `string message, uint256 timestamp, address sender`;
    const schemaId = await sdk.streams.computeSchemaId(helloSchema);

    const senders = new Set();
    if (publisherWallet) {
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
    }

    return res.json({ uniqueSenders: senders.size });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.post('/sync-winners', async (req, res) => {
  try {
    const publisherWallet = process.env.PUBLISHER_WALLET || process.env.PUBLIC_KEY;
    if (!publisherWallet) return res.status(400).json({ error: 'PUBLISHER_WALLET not set' });
    if (!process.env.PRIVATE_KEY) return res.status(500).json({ error: 'PRIVATE_KEY not set' });
    
    const publicClient = createPublicClient({ chain: dreamChain, transport: http() });
    const sdk = new SDK({ public: publicClient });
    const helloSchema = `string message, uint256 timestamp, address sender`;
    const schemaId = await sdk.streams.computeSchemaId(helloSchema);
    const allData = await sdk.streams.getAllPublisherDataForSchema(schemaId, publisherWallet);
    
    const walletClient = createWalletClient({ account: privateKeyToAccount(process.env.PRIVATE_KEY), chain: dreamChain, transport: http() });
    const NFT_ADDRESS = '0x1330fF8C16fDDF65e3A09e3c552C43B9D930C216';
    const { keccak256, toBytes } = require('viem');
    const selector = keccak256(toBytes('setMilestoneWinner(uint256,address)')).slice(0, 10);
    
    const synced = [];
    for (let i = 0; i < allData.length; i++) {
      const msgNum = i + 1;
      if (msgNum % 10 === 0) {
        const dataItem = allData[i];
        let sender = '';
        for (const field of dataItem) {
          const val = field.value?.value ?? field.value;
          if (field.name === 'sender') sender = val;
        }
        try {
          const data = selector + msgNum.toString(16).padStart(64, '0') + sender.slice(2).padStart(64, '0');
          await walletClient.sendTransaction({ to: NFT_ADDRESS, data });
          synced.push({ milestone: msgNum, winner: sender });
        } catch (e) { /* already set */ }
      }
    }
    
    return res.json({ ok: true, synced });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.post('/publish', async (req, res) => {
  const { message, timestamp, signer, signature } = req.body || {};
  if (!message || !timestamp || !signer || !signature) return res.status(400).json({ error: 'missing fields' });

  try {
    const payload = JSON.stringify({ message, timestamp });
    const recovered = verifyMessage(payload, signature);
    if (recovered.toLowerCase() !== signer.toLowerCase()) return res.status(400).json({ error: 'signature mismatch' });
  } catch (err) { return res.status(400).json({ error: 'invalid signature' }); }

  if (!process.env.PRIVATE_KEY) return res.status(500).json({ error: 'server missing PRIVATE_KEY' });

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
    if (typeof tx === 'string') txHash = tx;
    else if (tx?.hash) txHash = tx.hash;

    const explorerBase = process.env.EXPLORER_TX_URL || null;
    return res.json({ ok: true, tx: txHash, explorer: explorerBase ? `${explorerBase}${txHash}` : null });
  } catch (err) {
    return res.status(500).json({ error: 'publish failed', details: String(err) });
  }
});





module.exports = app;
