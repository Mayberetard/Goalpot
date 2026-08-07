// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GoalPot} from "./GoalPot.sol";

/// @title StandardPot — the original Goalpot behaviour, one pot per clone
/// @notice Goal reached -> funds release to the beneficiary (minus protocol
///         fee). Deadline missed -> members pull refunds. Early exit needs a
///         deposit-weighted majority and costs a penalty that stays in the pot.
contract StandardPot is GoalPot {
    function initialize(InitParams calldata p, address[] calldata invitees) external initializer {
        __base_init(p, invitees);
    }

    function potType() external pure override returns (uint8) {
        return 0; // PotType.Standard
    }
}
