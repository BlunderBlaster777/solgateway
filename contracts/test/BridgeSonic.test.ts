import { expect } from "chai";
import { ethers } from "hardhat";
import { TestToken, BridgeSonic } from "../typechain-types";

// ── Minimal Wormhole mock ─────────────────────────────────────────────────────
// We deploy a simple mock so unit tests do not need a live Wormhole node.

describe("BridgeSonic", () => {
  let token: TestToken;
  let bridge: BridgeSonic;
  let wormholeMock: any;
  let owner: any;
  let user: any;

  const SOLANA_CHAIN_ID = 1;
  const SOLANA_EMITTER  = ethers.zeroPadBytes("0xdeadbeef", 32);

  beforeEach(async () => {
    [owner, user] = await ethers.getSigners();

    // Deploy a minimal Wormhole mock
    const WormholeMock = await ethers.getContractFactory("WormholeMock");
    wormholeMock = await WormholeMock.deploy();

    // Deploy TestToken
    const TestTokenFactory = await ethers.getContractFactory("TestToken");
    token = (await TestTokenFactory.deploy(1_000_000)) as TestToken;

    // Deploy BridgeSonic
    const BridgeSonicFactory = await ethers.getContractFactory("BridgeSonic");
    bridge = (await BridgeSonicFactory.deploy(
      await token.getAddress(),
      await wormholeMock.getAddress(),
      SOLANA_CHAIN_ID,
      SOLANA_EMITTER
    )) as BridgeSonic;
  });

  it("locks tokens and emits TokensLocked", async () => {
    const amount = ethers.parseEther("100");

    // Transfer some tokens to the user
    await token.transfer(user.address, amount);
    await token.connect(user).approve(await bridge.getAddress(), amount);

    const recipientSolana = ethers.zeroPadBytes("0x1234", 32);
    await expect(
      bridge.connect(user).lockAndSend(recipientSolana, amount, 0)
    )
      .to.emit(bridge, "TokensLocked")
      .withArgs(user.address, recipientSolana, amount, 0n);

    expect(await bridge.lockedBalance()).to.equal(amount);
  });

  it("reverts lockAndSend when amount is zero", async () => {
    const recipientSolana = ethers.zeroPadBytes("0x1234", 32);
    await expect(
      bridge.lockAndSend(recipientSolana, 0n, 0)
    ).to.be.revertedWith("BridgeSonic: zero amount");
  });
});
