# NFT Contract Deployment Guide

## Contract Ready
The `RewardNFT.sol` contract is ready in `/contracts/RewardNFT.sol`

## Deployment Parameters
```
Streams Contract: 0x6AB397FF662e42312c003175DCD76EfF69D048Fc
Schema ID: Get from your app's stream info box
Publisher: 0x909dAFb395eB281b92B317552E12133098D62881
```

## Option 1: Deploy via Remix (Easiest)
1. Go to https://remix.ethereum.org
2. Create new file `RewardNFT.sol`
3. Copy contract code from `/contracts/RewardNFT.sol`
4. Compile with Solidity 0.8.20
5. Deploy tab → Environment: "Injected Provider - MetaMask"
6. Connect to Somnia network in MetaMask
7. Constructor parameters:
   - `_streamsContract`: `0x6AB397FF662e42312c003175DCD76EfF69D048Fc`
   - `_schemaId`: Copy from your app
   - `_publisher`: `0x909dAFb395eB281b92B317552E12133098D62881`
8. Click Deploy
9. Copy deployed contract address

## Option 2: Deploy via Hardhat (Advanced)
```bash
# Fix dependencies first
npm install --save-dev hardhat@2.26.0
npx hardhat compile
npx hardhat run scripts/deploy.js --network somnia
```

## After Deployment
1. Copy the deployed contract address
2. Update your app to show the contract address
3. Winners can interact with the contract directly
4. Verify on explorer: https://shannon-explorer.somnia.network

## Contract Functions
- `claim(uint256 milestone)` - Claim NFT for milestone 10, 20, 30, etc.
- `canClaim(address user, uint256 milestone)` - Check if eligible
- `hasClaimed(address, uint256)` - Check if already claimed

## Example Usage
Winners call: `claim(10)`, `claim(20)`, `claim(30)`, etc.
Contract automatically verifies they sent the Nth message!
