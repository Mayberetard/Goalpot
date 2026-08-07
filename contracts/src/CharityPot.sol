// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GoalPot} from "./GoalPot.sol";

/// @title CharityPot — crowdfunding for a named cause
/// @notice Goal met -> funds release to the charity beneficiary. Goal missed by
///         the deadline -> every donor is refunded; there is no partial
///         release, ever. Donors may attach a short public message for the
///         donor wall.
contract CharityPot is GoalPot {
    error BadCharityParams();
    error NoEarlyExit();

    uint256 public constant MAX_DONOR_MESSAGE_BYTES = 140;

    string public charityName;
    /// @notice Optional IPFS hash of the charity's registration documents.
    string public registrationHash;
    /// @notice Always true — charity pots can never do a partial release.
    bool public constant autoRefundOnMiss = true;

    mapping(address => bool) public hasDonated;
    uint32 public donorCount;

    struct CharityParams {
        string charityName;
        string registrationHash;
    }

    event CharityReleased(address indexed pot, uint256 amount, string charityName);
    event DonationMessage(address indexed donor, uint256 amount, string message);

    function initialize(
        InitParams calldata p,
        address[] calldata invitees,
        CharityParams calldata c
    ) external initializer {
        __base_init(p, invitees);
        if (bytes(c.charityName).length == 0 || bytes(c.charityName).length > 64) {
            revert BadCharityParams();
        }
        charityName = c.charityName;
        registrationHash = c.registrationHash;
    }

    function potType() external pure override returns (uint8) {
        return 2; // PotType.Charity
    }

    /// @notice Donate with a public message for the donor wall. The message
    ///         lives in the event log — cheap, permanent, and readable by any
    ///         indexer — rather than in contract storage.
    function donateWithMessage(string calldata message) external payable {
        if (bytes(message).length > MAX_DONOR_MESSAGE_BYTES) revert MessageTooLong();
        uint256 amount = msg.value;
        deposit();
        if (bytes(message).length > 0) {
            emit DonationMessage(msg.sender, amount, message);
        }
    }

    function _onDeposit(address member, uint96 prev) internal override {
        if (prev == 0 && !hasDonated[member]) {
            hasDonated[member] = true;
            donorCount += 1;
        }
    }

    function release() external override {
        uint256 amount = uint256(totalDeposited) + penaltyPool;
        _release();
        emit CharityReleased(address(this), amount, charityName);
    }

    /// @notice Donations are irrevocable: there is no early exit from an
    ///         appeal. The only outcomes are the goal being met (funds go to
    ///         the charity) or missed (every donor is refunded).
    function requestExit() external pure override {
        revert NoEarlyExit();
    }
}
