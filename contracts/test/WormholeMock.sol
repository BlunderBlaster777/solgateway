// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../src/IWormhole.sol";

/// @dev Minimal Wormhole mock used in tests.
contract WormholeMock {
    uint64 private _seq;

    function messageFee() external pure returns (uint256) {
        return 0;
    }

    function publishMessage(
        uint32,
        bytes memory,
        uint8
    ) external payable returns (uint64 sequence) {
        sequence = _seq++;
    }

    function parseAndVerifyVM(
        bytes calldata
    )
        external
        pure
        returns (IWormhole.VM memory vm, bool valid, string memory reason)
    {
        // Return a zero-value VM; tests that call receiveFromSolana must craft
        // the mock appropriately or override this stub.
        valid  = true;
        reason = "";
    }
}
