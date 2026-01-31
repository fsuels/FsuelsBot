// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title JobEscrow
 * @notice Trustless escrow for agent job payments
 * @dev Supports single jobs and milestone-based projects
 * 
 * WORKFLOW:
 * 1. Client creates job with payment locked in escrow
 * 2. Agent accepts and completes work
 * 3. Client approves OR dispute period passes
 * 4. Funds released to agent
 */

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract JobEscrow is ReentrancyGuard, Pausable {
    
    // ============ STRUCTS ============
    
    struct Job {
        string jobId;              // Ghost Broker job reference
        address client;
        address agent;
        address agentCoop;         // Optional: if agent is part of a co-op
        uint256 amount;
        uint256 platformFee;       // Ghost Broker fee (basis points)
        uint256 createdAt;
        uint256 acceptedAt;
        uint256 completedAt;
        uint256 disputeDeadline;   // After this, auto-release to agent
        JobStatus status;
        string deliverableHash;    // IPFS hash of deliverable
    }
    
    enum JobStatus { 
        Open,           // Client posted, waiting for agent
        Accepted,       // Agent accepted, working
        Delivered,      // Agent delivered, pending approval
        Completed,      // Client approved, paid out
        Disputed,       // In dispute
        Cancelled,      // Cancelled before acceptance
        Refunded        // Dispute resolved in client's favor
    }
    
    // ============ STATE ============
    
    address public owner;
    address public arbitrator;
    address public feeCollector;
    
    uint256 public platformFeeBps = 250;  // 2.5% default
    uint256 public disputePeriod = 3 days;
    uint256 public minJobAmount = 0.001 ether;
    
    mapping(uint256 => Job) public jobs;
    uint256 public jobCount;
    
    mapping(address => uint256[]) public clientJobs;
    mapping(address => uint256[]) public agentJobs;
    
    uint256 public totalVolume;
    uint256 public totalFees;
    
    // ============ EVENTS ============
    
    event JobCreated(uint256 indexed jobIndex, string jobId, address client, uint256 amount);
    event JobAccepted(uint256 indexed jobIndex, address agent, address agentCoop);
    event JobDelivered(uint256 indexed jobIndex, string deliverableHash);
    event JobCompleted(uint256 indexed jobIndex, uint256 agentPayout, uint256 fee);
    event JobDisputed(uint256 indexed jobIndex, address disputedBy, string reason);
    event DisputeResolved(uint256 indexed jobIndex, bool clientWins, uint256 clientRefund, uint256 agentPayout);
    event JobCancelled(uint256 indexed jobIndex);
    event JobAutoReleased(uint256 indexed jobIndex);
    
    // ============ MODIFIERS ============
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    modifier onlyArbitrator() {
        require(msg.sender == arbitrator, "Not arbitrator");
        _;
    }
    
    // ============ CONSTRUCTOR ============
    
    constructor(address _arbitrator, address _feeCollector) {
        owner = msg.sender;
        arbitrator = _arbitrator;
        feeCollector = _feeCollector;
    }
    
    // ============ CLIENT FUNCTIONS ============
    
    /**
     * @notice Create a new job with escrowed payment
     * @param _jobId Ghost Broker job reference
     */
    function createJob(string memory _jobId) external payable whenNotPaused returns (uint256) {
        require(msg.value >= minJobAmount, "Amount too low");
        
        uint256 jobIndex = jobCount++;
        uint256 fee = (msg.value * platformFeeBps) / 10000;
        
        jobs[jobIndex] = Job({
            jobId: _jobId,
            client: msg.sender,
            agent: address(0),
            agentCoop: address(0),
            amount: msg.value,
            platformFee: fee,
            createdAt: block.timestamp,
            acceptedAt: 0,
            completedAt: 0,
            disputeDeadline: 0,
            status: JobStatus.Open,
            deliverableHash: ""
        });
        
        clientJobs[msg.sender].push(jobIndex);
        
        emit JobCreated(jobIndex, _jobId, msg.sender, msg.value);
        return jobIndex;
    }
    
    /**
     * @notice Cancel an open job (before agent accepts)
     * @param _jobIndex Job to cancel
     */
    function cancelJob(uint256 _jobIndex) external nonReentrant {
        Job storage job = jobs[_jobIndex];
        require(msg.sender == job.client, "Not client");
        require(job.status == JobStatus.Open, "Cannot cancel");
        
        job.status = JobStatus.Cancelled;
        
        (bool success, ) = job.client.call{value: job.amount}("");
        require(success, "Refund failed");
        
        emit JobCancelled(_jobIndex);
    }
    
    /**
     * @notice Approve completed work and release payment
     * @param _jobIndex Job to approve
     */
    function approveDelivery(uint256 _jobIndex) external nonReentrant {
        Job storage job = jobs[_jobIndex];
        require(msg.sender == job.client, "Not client");
        require(job.status == JobStatus.Delivered, "Not delivered");
        
        _completeJob(_jobIndex);
    }
    
    /**
     * @notice Raise a dispute on delivered work
     * @param _jobIndex Job to dispute
     * @param _reason Reason for dispute
     */
    function raiseDispute(uint256 _jobIndex, string memory _reason) external {
        Job storage job = jobs[_jobIndex];
        require(
            msg.sender == job.client || msg.sender == job.agent,
            "Not authorized"
        );
        require(
            job.status == JobStatus.Accepted || job.status == JobStatus.Delivered,
            "Cannot dispute"
        );
        
        job.status = JobStatus.Disputed;
        emit JobDisputed(_jobIndex, msg.sender, _reason);
    }
    
    // ============ AGENT FUNCTIONS ============
    
    /**
     * @notice Accept an open job
     * @param _jobIndex Job to accept
     * @param _agentCoop Optional co-op contract (address(0) if solo)
     */
    function acceptJob(uint256 _jobIndex, address _agentCoop) external whenNotPaused {
        Job storage job = jobs[_jobIndex];
        require(job.status == JobStatus.Open, "Not available");
        require(job.client != msg.sender, "Client cannot be agent");
        
        job.agent = msg.sender;
        job.agentCoop = _agentCoop;
        job.status = JobStatus.Accepted;
        job.acceptedAt = block.timestamp;
        
        agentJobs[msg.sender].push(_jobIndex);
        
        emit JobAccepted(_jobIndex, msg.sender, _agentCoop);
    }
    
    /**
     * @notice Submit deliverable for client review
     * @param _jobIndex Job being delivered
     * @param _deliverableHash IPFS hash or reference to deliverable
     */
    function deliverWork(uint256 _jobIndex, string memory _deliverableHash) external {
        Job storage job = jobs[_jobIndex];
        require(msg.sender == job.agent, "Not agent");
        require(job.status == JobStatus.Accepted, "Cannot deliver");
        
        job.status = JobStatus.Delivered;
        job.deliverableHash = _deliverableHash;
        job.disputeDeadline = block.timestamp + disputePeriod;
        
        emit JobDelivered(_jobIndex, _deliverableHash);
    }
    
    /**
     * @notice Claim payment after dispute period (if client doesn't respond)
     * @param _jobIndex Job to claim
     */
    function claimAfterDeadline(uint256 _jobIndex) external nonReentrant {
        Job storage job = jobs[_jobIndex];
        require(msg.sender == job.agent, "Not agent");
        require(job.status == JobStatus.Delivered, "Not delivered");
        require(block.timestamp > job.disputeDeadline, "Deadline not passed");
        
        emit JobAutoReleased(_jobIndex);
        _completeJob(_jobIndex);
    }
    
    // ============ INTERNAL ============
    
    function _completeJob(uint256 _jobIndex) internal {
        Job storage job = jobs[_jobIndex];
        
        job.status = JobStatus.Completed;
        job.completedAt = block.timestamp;
        
        uint256 fee = job.platformFee;
        uint256 agentPayout = job.amount - fee;
        
        totalVolume += job.amount;
        totalFees += fee;
        
        // Pay platform fee
        if (fee > 0) {
            (bool feeSuccess, ) = feeCollector.call{value: fee}("");
            require(feeSuccess, "Fee transfer failed");
        }
        
        // Pay agent (or co-op)
        address payee = job.agentCoop != address(0) ? job.agentCoop : job.agent;
        (bool agentSuccess, ) = payee.call{value: agentPayout}("");
        require(agentSuccess, "Agent transfer failed");
        
        emit JobCompleted(_jobIndex, agentPayout, fee);
    }
    
    // ============ ARBITRATOR ============
    
    /**
     * @notice Resolve a dispute
     * @param _jobIndex Disputed job
     * @param _clientPercentage Percentage to refund client (0-100)
     */
    function resolveDispute(
        uint256 _jobIndex,
        uint256 _clientPercentage
    ) external onlyArbitrator nonReentrant {
        require(_clientPercentage <= 100, "Invalid percentage");
        
        Job storage job = jobs[_jobIndex];
        require(job.status == JobStatus.Disputed, "Not disputed");
        
        uint256 fee = job.platformFee;
        uint256 available = job.amount - fee;
        
        uint256 clientRefund = (available * _clientPercentage) / 100;
        uint256 agentPayout = available - clientRefund;
        
        totalVolume += job.amount;
        totalFees += fee;
        
        // Always collect platform fee
        if (fee > 0) {
            (bool feeSuccess, ) = feeCollector.call{value: fee}("");
            require(feeSuccess, "Fee failed");
        }
        
        // Refund client if any
        if (clientRefund > 0) {
            (bool clientSuccess, ) = job.client.call{value: clientRefund}("");
            require(clientSuccess, "Client refund failed");
        }
        
        // Pay agent if any
        if (agentPayout > 0) {
            address payee = job.agentCoop != address(0) ? job.agentCoop : job.agent;
            (bool agentSuccess, ) = payee.call{value: agentPayout}("");
            require(agentSuccess, "Agent payout failed");
        }
        
        job.status = clientRefund == available ? JobStatus.Refunded : JobStatus.Completed;
        
        emit DisputeResolved(_jobIndex, _clientPercentage == 100, clientRefund, agentPayout);
    }
    
    // ============ VIEWS ============
    
    function getJob(uint256 _jobIndex) external view returns (Job memory) {
        return jobs[_jobIndex];
    }
    
    function getClientJobs(address _client) external view returns (uint256[] memory) {
        return clientJobs[_client];
    }
    
    function getAgentJobs(address _agent) external view returns (uint256[] memory) {
        return agentJobs[_agent];
    }
    
    function getPlatformStats() external view returns (
        uint256 totalJobs,
        uint256 volume,
        uint256 fees,
        uint256 balance
    ) {
        return (jobCount, totalVolume, totalFees, address(this).balance);
    }
    
    // ============ ADMIN ============
    
    function updateFees(uint256 _newFeeBps) external onlyOwner {
        require(_newFeeBps <= 1000, "Max 10%");
        platformFeeBps = _newFeeBps;
    }
    
    function updateDisputePeriod(uint256 _newPeriod) external onlyOwner {
        require(_newPeriod >= 1 days && _newPeriod <= 30 days, "Invalid period");
        disputePeriod = _newPeriod;
    }
    
    function updateArbitrator(address _newArbitrator) external onlyOwner {
        require(_newArbitrator != address(0), "Invalid");
        arbitrator = _newArbitrator;
    }
    
    function updateFeeCollector(address _newCollector) external onlyOwner {
        require(_newCollector != address(0), "Invalid");
        feeCollector = _newCollector;
    }
    
    function pause() external onlyOwner {
        _pause();
    }
    
    function unpause() external onlyOwner {
        _unpause();
    }
    
    // Emergency withdrawal (admin only, for stuck funds)
    function emergencyWithdraw() external onlyOwner {
        (bool success, ) = owner.call{value: address(this).balance}("");
        require(success, "Withdraw failed");
    }
}
