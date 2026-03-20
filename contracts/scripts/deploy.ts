import { ethers } from "hardhat";
import { WORMHOLE_CONFIG } from "../../scripts/src/config";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // 1. Deploy TestToken (1 million TST minted to deployer)
  const TestToken = await ethers.getContractFactory("TestToken");
  const testToken = await TestToken.deploy(1_000_000);
  await testToken.waitForDeployment();
  console.log("TestToken deployed to:", await testToken.getAddress());

  // 2. Deploy BridgeSonic
  const BridgeSonic = await ethers.getContractFactory("BridgeSonic");
  const bridge = await BridgeSonic.deploy(
    await testToken.getAddress(),
    WORMHOLE_CONFIG.evm.coreBridgeAddress,
    WORMHOLE_CONFIG.solana.wormholeChainId,
    WORMHOLE_CONFIG.solana.bridgeProgramEmitter
  );
  await bridge.waitForDeployment();
  console.log("BridgeSonic deployed to:", await bridge.getAddress());

  console.log("\n=== Deployment Summary ===");
  console.log("TestToken:", await testToken.getAddress());
  console.log("BridgeSonic:", await bridge.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
