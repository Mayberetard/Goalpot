// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {GoalPot} from "./GoalPot.sol";
import {StandardPot} from "./StandardPot.sol";
import {StreakPot} from "./StreakPot.sol";
import {CharityPot} from "./CharityPot.sol";

/// @title GoalPotFactory — deploys one minimal-proxy clone per pot
/// @notice Every pot is its own contract, so a bug or a stuck pot can never
///         affect other pots, and new pot types ship as new implementations
///         without touching the ones already in flight.
/// @dev Implementations are set once at construction. The owner can point the
///      factory at new implementations for *future* pots and tune the protocol
///      fee (hard-capped at 2%); neither ever mutates an existing clone.
contract GoalPotFactory is Ownable {
    error BadImplementation();
    error FeeTooHigh();
    error BadTreasury();

    enum PotType {
        Standard,
        StreakCommitment,
        Charity
    }

    uint16 public constant MAX_FEE_BPS = 200; // 2% ceiling, enforced on every set

    address public standardImpl;
    address public streakImpl;
    address public charityImpl;

    address public treasury;
    uint16 public feeBps;

    address[] public pots;
    mapping(address => bool) public isPot;
    mapping(address => uint8) public potTypeOf;

    event PotCreated(
        address indexed clone,
        uint256 indexed potId,
        address indexed creator,
        PotType potType
    );
    event FeeUpdated(address treasury, uint16 feeBps);
    event ImplementationUpdated(PotType potType, address implementation);

    constructor(
        address standardImpl_,
        address streakImpl_,
        address charityImpl_,
        address treasury_,
        uint16 feeBps_
    ) Ownable(msg.sender) {
        if (standardImpl_ == address(0) || streakImpl_ == address(0) || charityImpl_ == address(0)) {
            revert BadImplementation();
        }
        standardImpl = standardImpl_;
        streakImpl = streakImpl_;
        charityImpl = charityImpl_;
        _setFee(treasury_, feeBps_);
    }

    // ---------------------------------------------------------------- fee
    /// @notice Read by clones on release. Returns (treasury, feeBps).
    function feeInfo() external view returns (address, uint16) {
        return (treasury, feeBps);
    }

    function setFee(address treasury_, uint16 feeBps_) external onlyOwner {
        _setFee(treasury_, feeBps_);
    }

    function _setFee(address treasury_, uint16 feeBps_) internal {
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        if (feeBps_ > 0 && treasury_ == address(0)) revert BadTreasury();
        treasury = treasury_;
        feeBps = feeBps_;
        emit FeeUpdated(treasury_, feeBps_);
    }

    function setImplementation(PotType potType, address impl) external onlyOwner {
        if (impl == address(0)) revert BadImplementation();
        if (potType == PotType.Standard) standardImpl = impl;
        else if (potType == PotType.StreakCommitment) streakImpl = impl;
        else charityImpl = impl;
        emit ImplementationUpdated(potType, impl);
    }

    // ---------------------------------------------------------------- create
    function createStandardPot(
        GoalPot.InitParams calldata p,
        address[] calldata invitees
    ) external returns (address clone) {
        clone = Clones.clone(standardImpl);
        StandardPot(clone).initialize(_withCreator(p), invitees);
        _register(clone, PotType.Standard);
    }

    function createStreakPot(
        GoalPot.InitParams calldata p,
        address[] calldata invitees,
        StreakPot.StreakParams calldata s
    ) external returns (address clone) {
        clone = Clones.clone(streakImpl);
        StreakPot(clone).initialize(_withCreator(p), invitees, s);
        _register(clone, PotType.StreakCommitment);
    }

    function createCharityPot(
        GoalPot.InitParams calldata p,
        address[] calldata invitees,
        CharityPot.CharityParams calldata c
    ) external returns (address clone) {
        clone = Clones.clone(charityImpl);
        CharityPot(clone).initialize(_withCreator(p), invitees, c);
        _register(clone, PotType.Charity);
    }

    /// @dev The caller is always the creator — a pot can't be created "as"
    ///      someone else, whatever the calldata says.
    function _withCreator(GoalPot.InitParams calldata p)
        internal
        view
        returns (GoalPot.InitParams memory out)
    {
        out = p;
        out.creator = msg.sender;
    }

    function _register(address clone, PotType potType) internal {
        uint256 potId = pots.length;
        pots.push(clone);
        isPot[clone] = true;
        potTypeOf[clone] = uint8(potType);
        emit PotCreated(clone, potId, msg.sender, potType);
    }

    // ---------------------------------------------------------------- views
    function potCount() external view returns (uint256) {
        return pots.length;
    }

    /// @notice Paginated pot addresses, newest last (creation order).
    function getPots(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory out, uint256 total)
    {
        total = pots.length;
        if (offset >= total) return (new address[](0), total);
        uint256 n = total - offset;
        if (n > limit) n = limit;
        out = new address[](n);
        for (uint256 i = 0; i < n; i++) out[i] = pots[offset + i];
    }
}
