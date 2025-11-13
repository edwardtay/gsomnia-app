// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

// Permissionless NFT Claim - reads from Somnia Streams
interface IStreams {
    function getAllPublisherDataForSchema(bytes32 schemaId, address publisher) external view returns (bytes[][] memory);
}

contract RewardNFT is ERC721 {
    IStreams public immutable streamsContract;
    bytes32 public immutable schemaId;
    address public immutable publisher;
    
    uint256 private _tokenIdCounter;
    mapping(address => mapping(uint256 => bool)) public hasClaimed;
    
    event RewardClaimed(address indexed winner, uint256 milestone, uint256 tokenId);
    
    constructor(address _streamsContract, bytes32 _schemaId, address _publisher) 
        ERC721("gSomnia Milestone Reward", "GSOMNIA") {
        streamsContract = IStreams(_streamsContract);
        schemaId = _schemaId;
        publisher = _publisher;
    }
    
    function claim(uint256 milestone) external {
        require(milestone % 10 == 0 && milestone > 0, "Invalid milestone");
        require(!hasClaimed[msg.sender][milestone], "Already claimed");
        
        bytes[][] memory allData = streamsContract.getAllPublisherDataForSchema(schemaId, publisher);
        require(allData.length >= milestone, "Milestone not reached");
        
        bytes[] memory targetMessage = allData[milestone - 1];
        address sender = abi.decode(targetMessage[2], (address));
        require(sender == msg.sender, "Not the milestone sender");
        
        uint256 tokenId = _tokenIdCounter++;
        _safeMint(msg.sender, tokenId);
        hasClaimed[msg.sender][milestone] = true;
        
        emit RewardClaimed(msg.sender, milestone, tokenId);
    }
    
    function canClaim(address user, uint256 milestone) external view returns (bool) {
        if (milestone % 10 != 0 || milestone == 0) return false;
        if (hasClaimed[user][milestone]) return false;
        
        bytes[][] memory allData = streamsContract.getAllPublisherDataForSchema(schemaId, publisher);
        if (allData.length < milestone) return false;
        
        bytes[] memory targetMessage = allData[milestone - 1];
        address sender = abi.decode(targetMessage[2], (address));
        return sender == user;
    }
    
    function _baseURI() internal view override returns (string memory) {
        return "ipfs://QmRewardNFT/";
    }
}
