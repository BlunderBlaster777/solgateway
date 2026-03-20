// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IWormhole
/// @notice Minimal interface for the Wormhole core bridge contract on EVM chains.
interface IWormhole {
    /// @notice Publish a Wormhole message and return the sequence number.
    /// @param nonce      Arbitrary nonce chosen by the sender (used to correlate VAAs).
    /// @param payload    Arbitrary bytes payload to be attested by Wormhole guardians.
    /// @param consistencyLevel  0 = finalized, 1 = confirmed (chain-specific semantics).
    /// @return sequence  Sequence number assigned to this message by the core bridge.
    function publishMessage(
        uint32 nonce,
        bytes memory payload,
        uint8 consistencyLevel
    ) external payable returns (uint64 sequence);

    /// @notice Parse and verify an encoded VAA.
    /// @param encodedVAA  Raw bytes of the signed VAA.
    /// @return vm         Decoded VM struct.
    /// @return valid      True when all guardian signatures are valid.
    /// @return reason     Non-empty error string on failure.
    function parseAndVerifyVM(
        bytes calldata encodedVAA
    )
        external
        view
        returns (VM memory vm, bool valid, string memory reason);

    /// @notice Returns the fee (in wei) required to publish a message.
    function messageFee() external view returns (uint256);

    // ── Wormhole VM (VAA) struct ──────────────────────────────────────────────
    struct VM {
        uint8 version;
        uint32 timestamp;
        uint32 nonce;
        uint16 emitterChainId;
        bytes32 emitterAddress;
        uint64 sequence;
        uint8 consistencyLevel;
        bytes payload;
        uint32 guardianSetIndex;
        Signature[] signatures;
        bytes32 hash;
    }

    struct Signature {
        bytes32 r;
        bytes32 s;
        uint8 v;
        uint8 guardianIndex;
    }
}
