// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AgentCoop
 * @notice Flexible co-op contract for AI agents to collaborate and share revenue
 * @dev Supports any number of members with configurable splits
 * 
 * FEATURES:
 * - Flexible revenue splits (any ratio, must sum to 10000 = 100%)
 * - Add/remove members with governance
 * - Automatic payment distribution
 * - Milestone-based projects
 * - Dispute resolution via arbitrator
 * - Emergency pause
 */

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract AgentCoop is ReentrancyGuard, Pausable {
    
    // ============ STRUCTS ============
    
    struct Member {
        address wallet;
        string agentId;        // Moltbook/Ghost Broker ID
        uint256 sharePoints;   // Out of 10000 (100.00%)
        bool isActive;
        uint256 joinedAt;
    }
    
    struct Project {
        string projectId;
        address client;
        uint256 totalAmount;
        uint256 paidAmount;
        uint256 milestoneCount;
        uint256 milestonesCompleted;
        ProjectStatus status;
        uint256 createdAt;
    }
    
    struct Milestone {
        string description;
        uint256 amount;
        bool completed;
        bool paid;
        address completedBy;
    }
    
    enum ProjectStatus { Active, Completed, Disputed, Cancelled }
    
    // ============ STATE ============
    
    string public coopName;
    string public coopDescription;
    address public arbitrator;
    
    Member[] public members;
    mapping(address => uint256) public memberIndex;
    mapping(address => bool) public isMember;
    
    Project[] public projects;
    mapping(uint256 => Milestone[]) public projectMilestones;
    
    uint256 public totalEarned;
    uint256 public totalDistributed;
    
    // Governance: votes needed to add/remove members
    uint256 public constant VOTE_THRESHOLD = 51; // 51% majority
    mapping(bytes32 => mapping(address => bool)) public votes;
    mapping(bytes32 => uint256) public voteCount;
    
    // ============ EVENTS ============
    
    event CoopCreated(string name, address[] founders, uint256[] shares);
    event MemberAdded(address wallet, string agentId, uint256 shares);
    event MemberRemoved(address wallet);
    event SharesUpdated(address wallet, uint256 oldShares, uint256 newShares);
    event ProjectCreated(uint256 projectId, string projectRef, address client, uint256 amount);
    event MilestoneCompleted(uint256 projectId, uint256 milestoneIndex, address completedBy);
    event PaymentReceived(uint256 projectId, uint256 amount);
    event RevenueDistributed(uint256 amount, uint256 timestamp);
    event DisputeRaised(uint256 projectId, address raisedBy, string reason);
    event DisputeResolved(uint256 projectId, bool clientWins);
    
    // ============ MODIFIERS ============
    
    modifier onlyMember() {
        require(isMember[msg.sender], "Not a member");
        _;
    }
    
    modifier onlyArbitrator() {
        require(msg.sender == arbitrator, "Not arbitrator");
        _;
    }
    
    // ============ CONSTRUCTOR ============
    
    /**
     * @notice Create a new Agent Co-op
     * @param _name Co-op name (e.g., "Data Services Co-op")
     * @param _description What the co-op does
     * @param _founders Array of founder wallet addresses
     * @param _agentIds Array of Moltbook/Ghost Broker agent IDs
     * @param _shares Array of share points (must sum to 10000)
     * @param _arbitrator Address for dispute resolution
     */
    constructor(
        string memory _name,
        string memory _description,
        address[] memory _founders,
        string[] memory _agentIds,
        uint256[] memory _shares,
        address _arbitrator
    ) {
        require(_founders.length == _shares.length, "Arrays must match");
        require(_founders.length == _agentIds.length, "Arrays must match");
        require(_founders.length >= 2, "Need at least 2 founders");
        require(_arbitrator != address(0), "Invalid arbitrator");
        
        coopName = _name;
        coopDescription = _description;
        arbitrator = _arbitrator;
        
        uint256 totalShares = 0;
        for (uint256 i = 0; i < _founders.length; i++) {
            require(_founders[i] != address(0), "Invalid address");
            require(!isMember[_founders[i]], "Duplicate member");
            
            members.push(Member({
                wallet: _founders[i],
                agentId: _agentIds[i],
                sharePoints: _shares[i],
                isActive: true,
                joinedAt: block.timestamp
            }));
            
            memberIndex[_founders[i]] = i;
            isMember[_founders[i]] = true;
            totalShares += _shares[i];
        }
        
        require(totalShares == 10000, "Shares must sum to 10000");
        
        emit CoopCreated(_name, _founders, _shares);
    }
    
    // ============ PROJECT MANAGEMENT ============
    
    /**
     * @notice Create a new project for the co-op
     * @param _projectRef External project reference
     * @param _client Client address
     * @param _totalAmount Total project value in wei
     * @param _milestoneDescriptions Array of milestone descriptions
     * @param _milestoneAmounts Array of milestone amounts (must sum to totalAmount)
     */
    function createProject(
        string memory _projectRef,
        address _client,
        uint256 _totalAmount,
        string[] memory _milestoneDescriptions,
        uint256[] memory _milestoneAmounts
    ) external onlyMember whenNotPaused returns (uint256) {
        require(_milestoneDescriptions.length == _milestoneAmounts.length, "Arrays must match");
        require(_client != address(0), "Invalid client");
        
        uint256 totalMilestones = 0;
        for (uint256 i = 0; i < _milestoneAmounts.length; i++) {
            totalMilestones += _milestoneAmounts[i];
        }
        require(totalMilestones == _totalAmount, "Milestones must sum to total");
        
        uint256 projectId = projects.length;
        
        projects.push(Project({
            projectId: _projectRef,
            client: _client,
            totalAmount: _totalAmount,
            paidAmount: 0,
            milestoneCount: _milestoneDescriptions.length,
            milestonesCompleted: 0,
            status: ProjectStatus.Active,
            createdAt: block.timestamp
        }));
        
        for (uint256 i = 0; i < _milestoneDescriptions.length; i++) {
            projectMilestones[projectId].push(Milestone({
                description: _milestoneDescriptions[i],
                amount: _milestoneAmounts[i],
                completed: false,
                paid: false,
                completedBy: address(0)
            }));
        }
        
        emit ProjectCreated(projectId, _projectRef, _client, _totalAmount);
        return projectId;
    }
    
    /**
     * @notice Mark a milestone as completed
     * @param _projectId Project index
     * @param _milestoneIndex Milestone index within project
     */
    function completeMilestone(
        uint256 _projectId,
        uint256 _milestoneIndex
    ) external onlyMember whenNotPaused {
        require(_projectId < projects.length, "Invalid project");
        Project storage project = projects[_projectId];
        require(project.status == ProjectStatus.Active, "Project not active");
        require(_milestoneIndex < project.milestoneCount, "Invalid milestone");
        
        Milestone storage milestone = projectMilestones[_projectId][_milestoneIndex];
        require(!milestone.completed, "Already completed");
        
        milestone.completed = true;
        milestone.completedBy = msg.sender;
        project.milestonesCompleted++;
        
        emit MilestoneCompleted(_projectId, _milestoneIndex, msg.sender);
        
        // Auto-complete project if all milestones done
        if (project.milestonesCompleted == project.milestoneCount) {
            project.status = ProjectStatus.Completed;
        }
    }
    
    // ============ PAYMENTS ============
    
    /**
     * @notice Receive payment for a project (client calls this)
     * @param _projectId Project to pay for
     */
    function payProject(uint256 _projectId) external payable whenNotPaused nonReentrant {
        require(_projectId < projects.length, "Invalid project");
        Project storage project = projects[_projectId];
        require(msg.sender == project.client, "Not the client");
        require(project.status == ProjectStatus.Active || project.status == ProjectStatus.Completed, "Cannot pay");
        
        project.paidAmount += msg.value;
        totalEarned += msg.value;
        
        emit PaymentReceived(_projectId, msg.value);
        
        // Auto-distribute completed milestone payments
        _distributeCompletedMilestones(_projectId);
    }
    
    /**
     * @notice Distribute revenue for completed milestones
     */
    function _distributeCompletedMilestones(uint256 _projectId) internal {
        Project storage project = projects[_projectId];
        
        for (uint256 i = 0; i < project.milestoneCount; i++) {
            Milestone storage milestone = projectMilestones[_projectId][i];
            
            if (milestone.completed && !milestone.paid && project.paidAmount >= milestone.amount) {
                milestone.paid = true;
                project.paidAmount -= milestone.amount;
                _distributeRevenue(milestone.amount);
            }
        }
    }
    
    /**
     * @notice Distribute revenue to all members based on shares
     * @param _amount Amount to distribute
     */
    function _distributeRevenue(uint256 _amount) internal {
        for (uint256 i = 0; i < members.length; i++) {
            if (members[i].isActive) {
                uint256 memberShare = (_amount * members[i].sharePoints) / 10000;
                if (memberShare > 0) {
                    (bool success, ) = members[i].wallet.call{value: memberShare}("");
                    require(success, "Transfer failed");
                }
            }
        }
        
        totalDistributed += _amount;
        emit RevenueDistributed(_amount, block.timestamp);
    }
    
    /**
     * @notice Manual distribution of contract balance (emergency)
     */
    function distributeBalance() external onlyMember nonReentrant {
        uint256 balance = address(this).balance;
        require(balance > 0, "No balance");
        _distributeRevenue(balance);
    }
    
    // ============ GOVERNANCE ============
    
    /**
     * @notice Propose adding a new member
     * @param _wallet New member's wallet
     * @param _agentId New member's agent ID
     * @param _shares Shares to allocate (requires rebalancing)
     */
    function proposeAddMember(
        address _wallet,
        string memory _agentId,
        uint256 _shares
    ) external onlyMember {
        require(!isMember[_wallet], "Already a member");
        require(_shares > 0 && _shares < 5000, "Invalid shares");
        
        bytes32 proposalId = keccak256(abi.encodePacked("ADD", _wallet, _agentId, _shares));
        
        if (!votes[proposalId][msg.sender]) {
            votes[proposalId][msg.sender] = true;
            voteCount[proposalId]++;
        }
        
        // Check if threshold reached
        uint256 threshold = (members.length * VOTE_THRESHOLD) / 100;
        if (threshold == 0) threshold = 1;
        
        if (voteCount[proposalId] >= threshold) {
            _addMember(_wallet, _agentId, _shares);
        }
    }
    
    function _addMember(address _wallet, string memory _agentId, uint256 _shares) internal {
        // Proportionally reduce existing shares
        uint256 reduction = _shares;
        for (uint256 i = 0; i < members.length; i++) {
            if (members[i].isActive) {
                uint256 memberReduction = (reduction * members[i].sharePoints) / 10000;
                members[i].sharePoints -= memberReduction;
            }
        }
        
        members.push(Member({
            wallet: _wallet,
            agentId: _agentId,
            sharePoints: _shares,
            isActive: true,
            joinedAt: block.timestamp
        }));
        
        memberIndex[_wallet] = members.length - 1;
        isMember[_wallet] = true;
        
        emit MemberAdded(_wallet, _agentId, _shares);
    }
    
    /**
     * @notice Propose removing a member
     * @param _wallet Member to remove
     */
    function proposeRemoveMember(address _wallet) external onlyMember {
        require(isMember[_wallet], "Not a member");
        require(_wallet != msg.sender, "Cannot remove self");
        
        bytes32 proposalId = keccak256(abi.encodePacked("REMOVE", _wallet));
        
        if (!votes[proposalId][msg.sender]) {
            votes[proposalId][msg.sender] = true;
            voteCount[proposalId]++;
        }
        
        uint256 threshold = (members.length * VOTE_THRESHOLD) / 100;
        if (threshold == 0) threshold = 1;
        
        if (voteCount[proposalId] >= threshold) {
            _removeMember(_wallet);
        }
    }
    
    function _removeMember(address _wallet) internal {
        uint256 idx = memberIndex[_wallet];
        uint256 freedShares = members[idx].sharePoints;
        
        members[idx].isActive = false;
        members[idx].sharePoints = 0;
        isMember[_wallet] = false;
        
        // Redistribute freed shares proportionally
        uint256 activeShares = 0;
        for (uint256 i = 0; i < members.length; i++) {
            if (members[i].isActive) {
                activeShares += members[i].sharePoints;
            }
        }
        
        for (uint256 i = 0; i < members.length; i++) {
            if (members[i].isActive) {
                uint256 bonus = (freedShares * members[i].sharePoints) / activeShares;
                members[i].sharePoints += bonus;
            }
        }
        
        emit MemberRemoved(_wallet);
    }
    
    // ============ DISPUTES ============
    
    /**
     * @notice Raise a dispute on a project
     * @param _projectId Project with dispute
     * @param _reason Reason for dispute
     */
    function raiseDispute(uint256 _projectId, string memory _reason) external {
        require(_projectId < projects.length, "Invalid project");
        Project storage project = projects[_projectId];
        require(
            msg.sender == project.client || isMember[msg.sender],
            "Not authorized"
        );
        require(project.status == ProjectStatus.Active, "Cannot dispute");
        
        project.status = ProjectStatus.Disputed;
        emit DisputeRaised(_projectId, msg.sender, _reason);
    }
    
    /**
     * @notice Resolve a dispute (arbitrator only)
     * @param _projectId Disputed project
     * @param _clientWins If true, refund client; if false, pay co-op
     */
    function resolveDispute(
        uint256 _projectId,
        bool _clientWins
    ) external onlyArbitrator nonReentrant {
        require(_projectId < projects.length, "Invalid project");
        Project storage project = projects[_projectId];
        require(project.status == ProjectStatus.Disputed, "Not disputed");
        
        if (_clientWins) {
            // Refund any held funds to client
            if (project.paidAmount > 0) {
                uint256 refund = project.paidAmount;
                project.paidAmount = 0;
                (bool success, ) = project.client.call{value: refund}("");
                require(success, "Refund failed");
            }
            project.status = ProjectStatus.Cancelled;
        } else {
            // Release all paid funds to co-op
            if (project.paidAmount > 0) {
                _distributeRevenue(project.paidAmount);
                project.paidAmount = 0;
            }
            project.status = ProjectStatus.Completed;
        }
        
        emit DisputeResolved(_projectId, _clientWins);
    }
    
    // ============ VIEWS ============
    
    function getMemberCount() external view returns (uint256) {
        return members.length;
    }
    
    function getActiveMemberCount() external view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < members.length; i++) {
            if (members[i].isActive) count++;
        }
        return count;
    }
    
    function getProjectCount() external view returns (uint256) {
        return projects.length;
    }
    
    function getMilestones(uint256 _projectId) external view returns (Milestone[] memory) {
        return projectMilestones[_projectId];
    }
    
    function getCoopStats() external view returns (
        uint256 memberCount,
        uint256 projectCount,
        uint256 earned,
        uint256 distributed,
        uint256 balance
    ) {
        return (
            members.length,
            projects.length,
            totalEarned,
            totalDistributed,
            address(this).balance
        );
    }
    
    // ============ ADMIN ============
    
    function pause() external onlyMember {
        _pause();
    }
    
    function unpause() external onlyMember {
        _unpause();
    }
    
    function updateArbitrator(address _newArbitrator) external onlyArbitrator {
        require(_newArbitrator != address(0), "Invalid address");
        arbitrator = _newArbitrator;
    }
    
    // Accept direct payments
    receive() external payable {
        totalEarned += msg.value;
    }
}
