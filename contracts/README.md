# Permissionless NFT Reward Contract

## How It Works

The contract is **fully permissionless** - no admin approval needed!

1. **On-chain verification**: Contract reads directly from Somnia Streams
2. **Anyone can claim**: Call `claim(milestone)` where milestone = 10, 20, 30, etc.
3. **Automatic verification**: Contract checks:
   - Milestone is valid (divisible by 10)
   - Stream has reached that milestone
   - You are the actual sender of the Nth message
   - You haven't claimed already
4. **Instant mint**: If valid, NFT is minted directly to your wallet

## Deployment

```javascript
// Constructor parameters:
// 1. Streams contract: 0x6AB397FF662e42312c003175DCD76EfF69D048Fc
// 2. Schema ID: Get from your app's stream info
// 3. Publisher address: Your publisher wallet

const contract = await deploy('RewardNFT', [
  '0x6AB397FF662e42312c003175DCD76EfF69D048Fc',
  '0x27c30fa6547c34518f2de6a268b29ac3b54e51c98f8d0ef6018bbec9153e9742',
  '0x909dAFb395eB281b92B317552E12133098D62881'
]);
```

## Functions

- `claim(uint256 milestone)` - Claim your NFT for milestone 10, 20, 30, etc.
- `canClaim(address user, uint256 milestone)` - Check if address can claim
- `hasClaimed(address, uint256)` - Check if already claimed

## Security

- No owner/admin functions
- All verification done on-chain
- Cannot claim someone else's reward
- Cannot claim twice for same milestone
- Trustless and transparent
