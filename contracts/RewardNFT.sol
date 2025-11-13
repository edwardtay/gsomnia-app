// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract RewardNFT is ERC721, Ownable {
    uint256 private _tokenIdCounter;
    mapping(address => mapping(uint256 => bool)) public hasClaimed;
    mapping(uint256 => address) public milestoneWinners;
    
    event RewardClaimed(address indexed winner, uint256 milestone, uint256 tokenId);
    event MilestoneSet(uint256 milestone, address winner);
    
    constructor() ERC721("gSomnia Milestone Reward", "GSOMNIA") Ownable(msg.sender) {}
    
    function setMilestoneWinner(uint256 milestone, address winner) external onlyOwner {
        require(milestone % 10 == 0 && milestone > 0, "Invalid milestone");
        milestoneWinners[milestone] = winner;
        emit MilestoneSet(milestone, winner);
    }
    
    function claim(uint256 milestone) external {
        require(milestone % 10 == 0 && milestone > 0, "Invalid milestone");
        require(!hasClaimed[msg.sender][milestone], "Already claimed");
        require(milestoneWinners[milestone] == msg.sender, "Not the milestone winner");
        
        uint256 tokenId = _tokenIdCounter++;
        _safeMint(msg.sender, tokenId);
        hasClaimed[msg.sender][milestone] = true;
        
        emit RewardClaimed(msg.sender, milestone, tokenId);
    }
    
    function _baseURI() internal view override returns (string memory) {
        return "ipfs://QmRewardNFT/";
    }
}
