const { SDK, SchemaEncoder, zeroBytes32 } = require("@somnia-chain/streams")
const { createPublicClient, http, createWalletClient, toHex } = require("viem")
const { privateKeyToAccount } = require("viem/accounts")
const { waitForTransactionReceipt } = require("viem/actions")
const { dreamChain } = require("./dream-chain")
require("dotenv").config()

async function main() {
  const publicClient = createPublicClient({ chain: dreamChain, transport: http() })
  const walletClient = createWalletClient({
    account: privateKeyToAccount(process.env.PRIVATE_KEY),
    chain: dreamChain,
    transport: http(),
  })

  const sdk = new SDK({ public: publicClient, wallet: walletClient })

  // 1️⃣ Define schema
  const helloSchema = `string message, uint256 timestamp, address sender`
  const schemaId = await sdk.streams.computeSchemaId(helloSchema)
  console.log("Schema ID:", schemaId)

  // 2️⃣ Safer schema registration
  const ignoreAlreadyRegistered = true

  try {
    const txHash = await sdk.streams.registerDataSchemas(
      [
        {
          id: 'hello_world',
          schema: helloSchema,
          parentSchemaId: zeroBytes32
        },
      ],
      ignoreAlreadyRegistered
    )

    // Normalise what the SDK returned. Some SDK versions may return a tx hash string,
    // an object containing a `hash` field, or falsy when nothing was registered.
    if (!txHash) {
      console.log('ℹ️ Schema already registered or nothing to register — no action required.')
    } else {
      let hashToWaitFor = null

      if (typeof txHash === 'string') {
        hashToWaitFor = txHash
      } else if (txHash && typeof txHash === 'object') {
        // common places a tx hash might be found
        hashToWaitFor = txHash.hash || txHash.transactionHash || txHash.txHash || (txHash.transaction && txHash.transaction.hash)
      }

      if (hashToWaitFor) {
        await waitForTransactionReceipt(publicClient, { hash: hashToWaitFor })
        console.log(`✅ Schema registered or confirmed, Tx: ${hashToWaitFor}`)
      } else {
        console.log('⚠️ registerDataSchemas returned a non-hash value; skipping wait. Value:', txHash)
      }
    }
  } catch (err) {
    // fallback: if the SDK doesn’t support the flag yet
    if (String(err).includes('SchemaAlreadyRegistered')) {
      console.log('⚠️ Schema already registered. Continuing...')
    } else {
      throw err
    }
  }

  // 3️⃣ Publish messages
  const encoder = new SchemaEncoder(helloSchema)
  let count = 0

  setInterval(async () => {
    count++
    const data = encoder.encodeData([
      { name: 'message', value: `Hello World #${count}`, type: 'string' },
      { name: 'timestamp', value: BigInt(Math.floor(Date.now() / 1000)), type: 'uint256' },
      { name: 'sender', value: walletClient.account.address, type: 'address' },
    ])

    const dataStreams = [{ id: toHex(`hello-${count}`, { size: 32 }), schemaId, data }]
    const tx = await sdk.streams.set(dataStreams)
    console.log(`✅ Published: Hello World #${count} (Tx: ${tx})`)
  }, 3000)
}

main()
