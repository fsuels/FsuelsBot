const hre = require("hardhat");

async function main() {
  console.log("🚀 Deploying Ghost Broker Smart Contracts...\n");
  
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH\n");

  // Ghost Broker's addresses (update these for mainnet)
  const GHOST_BROKER_WALLET = deployer.address; // Platform fee collector
  const ARBITRATOR = deployer.address; // Dispute resolver (multi-sig in production)
  
  // ============ DEPLOY JOB ESCROW ============
  console.log("📜 Deploying JobEscrow...");
  const JobEscrow = await hre.ethers.getContractFactory("JobEscrow");
  const jobEscrow = await JobEscrow.deploy(ARBITRATOR, GHOST_BROKER_WALLET);
  await jobEscrow.waitForDeployment();
  const jobEscrowAddress = await jobEscrow.getAddress();
  console.log("✅ JobEscrow deployed to:", jobEscrowAddress);
  
  // ============ DEPLOY SAMPLE CO-OP ============
  console.log("\n📜 Deploying Sample AgentCoop (DataServices)...");
  
  // Sample co-op: 2 agents, 50/50 split
  const AgentCoop = await hre.ethers.getContractFactory("AgentCoop");
  const sampleCoop = await AgentCoop.deploy(
    "Data Services Co-op",                    // name
    "Complete data pipeline: scraping + visualization", // description
    [deployer.address, deployer.address],     // founders (same for testing)
    ["DataScraper", "DataViz"],               // agent IDs
    [5000, 5000],                              // 50/50 split
    ARBITRATOR                                 // arbitrator
  );
  await sampleCoop.waitForDeployment();
  const coopAddress = await sampleCoop.getAddress();
  console.log("✅ Sample AgentCoop deployed to:", coopAddress);
  
  // ============ SUMMARY ============
  console.log("\n" + "=".repeat(50));
  console.log("🎉 DEPLOYMENT COMPLETE!");
  console.log("=".repeat(50));
  console.log("\n📋 Contract Addresses:");
  console.log("   JobEscrow:    ", jobEscrowAddress);
  console.log("   SampleCoop:   ", coopAddress);
  console.log("\n🔗 View on BaseScan:");
  console.log("   https://sepolia.basescan.org/address/" + jobEscrowAddress);
  console.log("   https://sepolia.basescan.org/address/" + coopAddress);
  console.log("\n💡 Next Steps:");
  console.log("   1. Verify contracts on BaseScan");
  console.log("   2. Test job creation and escrow");
  console.log("   3. Test co-op revenue distribution");
  console.log("   4. Update website with contract addresses");
  
  // Save deployment info
  const deploymentInfo = {
    network: hre.network.name,
    chainId: hre.network.config.chainId,
    deployer: deployer.address,
    contracts: {
      JobEscrow: jobEscrowAddress,
      SampleCoop: coopAddress
    },
    config: {
      arbitrator: ARBITRATOR,
      feeCollector: GHOST_BROKER_WALLET,
      platformFeeBps: 250
    },
    timestamp: new Date().toISOString()
  };
  
  const fs = require("fs");
  fs.writeFileSync(
    `deployments/${hre.network.name}.json`,
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log("\n📁 Deployment info saved to deployments/" + hre.network.name + ".json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
