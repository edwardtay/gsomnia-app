const { SDK, SchemaEncoder } = require("@somnia-chain/streams");
const { createPublicClient, http } = require("viem");
const { dreamChain } = require("./dream-chain");
require('dotenv').config();

async function main() {
  // support either PUBLISHER_WALLET (preferred) or PUBLIC_KEY (legacy/example .env)
  const publisherWallet = process.env.PUBLISHER_WALLET || process.env.PUBLIC_KEY;

  if (!publisherWallet) {
    console.error('Missing PUBLISHER_WALLET or PUBLIC_KEY in environment. Add one to your .env');
    process.exit(1);
  }
  const publicClient = createPublicClient({ chain: dreamChain, transport: http() });
  const sdk = new SDK({ public: publicClient });

  const helloSchema = `string message, uint256 timestamp, address sender`;
  const schemaId = await sdk.streams.computeSchemaId(helloSchema);

  const schemaEncoder = new SchemaEncoder(helloSchema);
  const seen = new Set();

  setInterval(async () => {
    try {
      const allData = await sdk.streams.getAllPublisherDataForSchema(schemaId, publisherWallet);

      if (!allData || !Array.isArray(allData)) return;

      for (const dataItem of allData) {
        let message = "", timestamp = "", sender = "";
        for (const field of dataItem) {
          const val = field.value?.value ?? field.value;
          if (field.name === "message") message = val;
          if (field.name === "timestamp") timestamp = val.toString();
          if (field.name === "sender") sender = val;
        }

        const id = `${timestamp}-${message}`;
        if (!seen.has(id)) {
          seen.add(id);
          console.log(`🆕 ${message} from ${sender} at ${new Date(Number(timestamp) * 1000).toLocaleTimeString()}`);
        }
      }
    } catch (err) {
      // handle contract revert when no data exists yet (viem error contains 'NoData')
      const containsNoData =
        (err && err.metaMessages && err.metaMessages.some(m => String(m).includes('NoData'))) ||
        String(err).includes('NoData') ||
        String(err).includes('NoData()');

      if (containsNoData) {
        // no published data yet; skip until publisher publishes
        return;
      }

      console.error('Error fetching publisher data:', err);
    }
  }, 3000);
}

main();