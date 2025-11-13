import "@nomicfoundation/hardhat-toolbox";
import dotenv from 'dotenv';
dotenv.config();

export default {
  solidity: "0.8.20",
  networks: {
    somnia: {
      url: "https://dream-rpc.somnia.network",
      chainId: 50312,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    }
  }
};
