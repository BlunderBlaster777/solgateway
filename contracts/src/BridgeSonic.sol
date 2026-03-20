// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./IWormhole.sol";

/// @title BridgeSonic
/// @notice Lock TestToken on Sonic / EVM and receive Wormhole messages from Solana
///         to unlock tokens on the return trip.
///
/// Bridge payload format (ABI-encoded):
///   - action       uint8   1 = lock→mint (Sonic→Solana)  |  2 = burn→unlock (Solana→Sonic)
///   - recipient    bytes32 Solana pubkey (action 1)  |  padded EVM address (action 2)
///   - amount       uint256
contract BridgeSonic {
    using SafeERC20 for IERC20;

    // ── Constants ────────────────────────────────────────────────────────────
    uint8 public constant ACTION_LOCK_MINT   = 1;
    uint8 public constant ACTION_BURN_UNLOCK = 2;

    // ── State ─────────────────────────────────────────────────────────────────
    IERC20     public immutable token;
    IWormhole  public immutable wormhole;

    /// @notice Wormhole chain id of the trusted Solana emitter.
    uint16  public trustedSolanaChainId;
    /// @notice Wormhole emitter address of the Solana bridge program (bytes32).
    bytes32 public trustedSolanaEmitter;

    /// @notice Tracks processed VAA hashes to prevent replay attacks.
    mapping(bytes32 => bool) public processedVAAs;

    // ── Events ────────────────────────────────────────────────────────────────
    event TokensLocked(
        address indexed sender,
        bytes32 indexed recipientSolana,
        uint256 amount,
        uint64  wormholeSequence
    );
    event TokensUnlocked(
        address indexed recipient,
        uint256 amount,
        bytes32 vaaHash
    );

    // ── Constructor ───────────────────────────────────────────────────────────
    /// @param _token                Address of the TestToken ERC-20.
    /// @param _wormhole             Address of the Wormhole core bridge on this EVM chain.
    /// @param _trustedSolanaChainId Wormhole chain id for Solana (devnet = 1).
    /// @param _trustedSolanaEmitter Wormhole emitter address of the Solana program (bytes32).
    constructor(
        address _token,
        address _wormhole,
        uint16  _trustedSolanaChainId,
        bytes32 _trustedSolanaEmitter
    ) {
        require(_token    != address(0), "BridgeSonic: zero token");
        require(_wormhole != address(0), "BridgeSonic: zero wormhole");
        token                  = IERC20(_token);
        wormhole               = IWormhole(_wormhole);
        trustedSolanaChainId   = _trustedSolanaChainId;
        trustedSolanaEmitter   = _trustedSolanaEmitter;
    }

    // ── Sonic → Solana ────────────────────────────────────────────────────────

    /// @notice Lock `amount` of TestToken and publish a Wormhole message for Solana.
    /// @param recipientSolana  Solana recipient public key as a bytes32 value.
    /// @param amount           Token amount (with 18 decimals).
    /// @param nonce            Arbitrary nonce for the Wormhole message.
    function lockAndSend(
        bytes32 recipientSolana,
        uint256 amount,
        uint32  nonce
    ) external payable returns (uint64 sequence) {
        require(amount > 0, "BridgeSonic: zero amount");

        // Pull tokens from sender into this contract (caller must have approved us).
        token.safeTransferFrom(msg.sender, address(this), amount);

        // Build payload: action | recipientSolana | amount
        bytes memory payload = abi.encodePacked(
            ACTION_LOCK_MINT,
            recipientSolana,
            amount
        );

        // Publish the Wormhole message; forward any ETH fee required.
        sequence = wormhole.publishMessage{value: msg.value}(
            nonce,
            payload,
            1   // consistency level: confirmed
        );

        emit TokensLocked(msg.sender, recipientSolana, amount, sequence);
    }

    // ── Solana → Sonic ────────────────────────────────────────────────────────

    /// @notice Submit a verified Wormhole VAA from Solana to unlock tokens here.
    /// @param encodedVAA  Raw signed VAA bytes obtained from the Wormhole Guardian network.
    function receiveFromSolana(bytes calldata encodedVAA) external {
        // 1. Parse & verify the VAA.
        (IWormhole.VM memory vm, bool valid, string memory reason) =
            wormhole.parseAndVerifyVM(encodedVAA);
        require(valid, string(abi.encodePacked("BridgeSonic: invalid VAA: ", reason)));

        // 2. Check the emitter is our trusted Solana program.
        require(
            vm.emitterChainId == trustedSolanaChainId,
            "BridgeSonic: untrusted chain"
        );
        require(
            vm.emitterAddress == trustedSolanaEmitter,
            "BridgeSonic: untrusted emitter"
        );

        // 3. Replay protection.
        require(!processedVAAs[vm.hash], "BridgeSonic: VAA already processed");
        processedVAAs[vm.hash] = true;

        // 4. Decode payload: action (1 byte) | recipient (32 bytes) | amount (32 bytes)
        bytes memory p = vm.payload;
        require(p.length == 65, "BridgeSonic: bad payload length");

        uint8 action = uint8(p[0]);
        require(action == ACTION_BURN_UNLOCK, "BridgeSonic: unexpected action");

        bytes32 recipientPadded;
        uint256 amount;
        assembly {
            recipientPadded := mload(add(p, 33))   // bytes 1..32
            amount          := mload(add(p, 65))   // bytes 33..64
        }

        // Last 20 bytes of the 32-byte field are the EVM address.
        address recipient = address(uint160(uint256(recipientPadded)));

        // 5. Transfer locked tokens to the recipient.
        token.safeTransfer(recipient, amount);

        emit TokensUnlocked(recipient, amount, vm.hash);
    }

    // ── Admin helpers ─────────────────────────────────────────────────────────

    /// @notice Returns how much TestToken is locked in this contract.
    function lockedBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }
}
