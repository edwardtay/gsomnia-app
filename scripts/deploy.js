const hre = require("hardhat");
const { SDK } = require('@somnia-chain/streams');
const { createPublicClient, http } = require('viem');
const { dreamChain } = require('../dream-chain');

async function main() {
  console.log("Deploying RewardNFT contract to Somnia...\n");

  // Get schema ID from streams
  const publicClient = createPublicClient({ chain: dreamChain, transport: http() });
  const sdk = new SDK({ public: publicClient });
  const helloSchema = `string message, uint256 timestamp, address sender`;
  const schemaId = await sdk.streams.computeSchemaId(helloSchema);
  
  const STREAMS_CONTRACT = "0x6AB397FF662e42312c003175DCD76EfF69D048Fc";
  const PUBLISHER = process.env.PUBLIC_KEY || "0x909dAFb395eB281b92B317552E12133098D62881";
  
  console.log("Deployment parameters:");
  console.log("- Streams Contract:", STREAMS_CONTRACT);
  console.log("- Schema ID:", schemaId);
  console.log("- Publisher:", PUBLISHER);
  console.log();

  const RewardNFT = await hre.ethers.getContractFactory("RewardNFT");
  const rewardNFT = await RewardNFT.deploy(STREAMS_CONTRACT, schemaId, PUBLISHER);

  await rewardNFT.waitForDeployment();
  const address = await rewardNFT.getAddress();

  console.log("✅ RewardNFT deployed to:", address);
  console.log();
  console.log("Update your app with this contract address!");
  console.log("Winners can now call: claim(10), claim(20), claim(30), etc.");
  console.log();
  console.log("Verify on explorer:");
  console.log(`https://shannon-explorer.somnia.network/address/${address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
