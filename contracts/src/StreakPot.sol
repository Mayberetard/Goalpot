// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GoalPot} from "./GoalPot.sol";

/// @title StreakPot — commitment savings on a fixed cadence
/// @notice Members must deposit once per interval (e.g. every Monday for 12
///         weeks). Missing an interval forfeits a share of the member's stake
///         into a reward pool that is split — proportional to intervals met —
///         among everyone else at settlement. Consistency pays.
/// @dev Interval i is due by `startTime + i * intervalSeconds`; interval 0 is
///      the joining deposit. Misses are assessed lazily on the member's next
///      deposit and can be forced by anyone via {assessMisses}, so a member who
///      simply stops depositing still forfeits. Assessment loops are bounded by
///      `totalIntervals` (max 52), fixed at creation.
contract StreakPot is GoalPot {
    error TooLateToJoin();
    error BadStreakParams();
    error AlreadyClaimedReward();
    error NotSettled();

    uint256 public constant MAX_INTERVALS = 52;
    uint256 public constant MIN_INTERVAL_SECONDS = 1 hours;

    uint40 public intervalSeconds;
    uint40 public startTime;
    uint16 public missPenaltyBps;
    uint8 public totalIntervals;

    uint96 public commitmentRewardPool;
    uint32 public totalIntervalsMet; // sum over members, for reward shares

    mapping(address => uint40) public lastDepositTime;
    mapping(address => uint8) public intervalsMet;
    mapping(address => uint8) public intervalsMissed;
    mapping(address => uint96) public forfeitedAmount;
    mapping(address => bool) public streakRewardClaimed;

    struct StreakParams {
        uint40 intervalSeconds;
        uint40 startTime;
        uint16 missPenaltyBps;
        uint8 totalIntervals;
    }

    event IntervalMet(address indexed member, uint8 interval, uint8 metTotal);
    event IntervalMissed(address indexed member, uint8 interval, uint256 forfeited);
    event StreakRewardClaimed(address indexed member, uint256 amount);

    function initialize(
        InitParams calldata p,
        address[] calldata invitees,
        StreakParams calldata s
    ) external initializer {
        __base_init(p, invitees);
        if (
            s.intervalSeconds < MIN_INTERVAL_SECONDS ||
            s.totalIntervals == 0 ||
            s.totalIntervals > MAX_INTERVALS ||
            s.missPenaltyBps > MAX_PENALTY_BPS ||
            s.startTime < block.timestamp ||
            s.startTime > p.deadline
        ) revert BadStreakParams();

        intervalSeconds = s.intervalSeconds;
        startTime = s.startTime;
        missPenaltyBps = s.missPenaltyBps;
        totalIntervals = s.totalIntervals;
    }

    function potType() external pure override returns (uint8) {
        return 1; // PotType.StreakCommitment
    }

    // ---------------------------------------------------------------- schedule
    /// @notice Index of the interval this member owes next.
    function dueIndex(address member) public view returns (uint256) {
        return uint256(intervalsMet[member]) + intervalsMissed[member];
    }

    /// @notice Unix deadline by which interval `i` must be deposited.
    function intervalDeadline(uint256 i) public view returns (uint256) {
        return uint256(startTime) + i * intervalSeconds;
    }

    /// @notice Deadline for this member's next deposit (0 when the schedule is done).
    function nextDeadlineOf(address member) external view returns (uint256) {
        uint256 i = dueIndex(member);
        return i >= totalIntervals ? 0 : intervalDeadline(i);
    }

    // ---------------------------------------------------------------- misses
    /// @notice Permissionless: charge a member for every interval whose
    ///         deadline has passed without a deposit.
    function assessMisses(address member) public {
        if (state != PotState.Active) return; // settled pots stop accruing
        if (!everMember[member]) return;

        uint256 i = dueIndex(member);
        while (i < totalIntervals && block.timestamp > intervalDeadline(i)) {
            uint96 stake = depositOf[member];
            uint96 forfeit = uint96((uint256(stake) * missPenaltyBps) / 10_000);
            if (forfeit > 0) {
                depositOf[member] = stake - forfeit;
                totalDeposited -= forfeit;
                forfeitedAmount[member] += forfeit;
                commitmentRewardPool += forfeit;

                address del = delegateOf[member];
                if (del != address(0)) delegatedIn[del] -= forfeit;
            }
            intervalsMissed[member] += 1;
            emit IntervalMissed(member, uint8(i), forfeit);
            unchecked { ++i; }
        }
    }

    // ---------------------------------------------------------------- deposits
    function _onDeposit(address member, uint96 prev) internal override {
        if (prev == 0) {
            // Interval 0 is the joining deposit: the schedule is fixed, so
            // latecomers cannot join a streak already in progress.
            if (block.timestamp > startTime) revert TooLateToJoin();
            intervalsMet[member] = 1;
            totalIntervalsMet += 1;
            lastDepositTime[member] = uint40(block.timestamp);
            emit IntervalMet(member, 0, 1);
            return;
        }

        assessMisses(member);
        uint256 i = dueIndex(member);
        if (i < totalIntervals) {
            intervalsMet[member] += 1;
            totalIntervalsMet += 1;
            lastDepositTime[member] = uint40(block.timestamp);
            emit IntervalMet(member, uint8(i), intervalsMet[member]);
        }
        // deposits beyond the schedule are accepted but earn no streak credit
    }

    // ---------------------------------------------------------------- rewards
    /// @notice After a successful release, consistent members pull their share
    ///         of the forfeits. On the refund path the share is paid out
    ///         automatically with the refund instead (see {_extraRefund}).
    function claimStreakReward() external {
        if (state != PotState.Released) revert NotSettled();
        if (streakRewardClaimed[msg.sender]) revert AlreadyClaimedReward();
        uint256 share = streakRewardOf(msg.sender);
        if (share == 0) revert NothingToClaim();

        streakRewardClaimed[msg.sender] = true;
        claimable[msg.sender] += share;
        emit StreakRewardClaimed(msg.sender, share);
    }

    /// @notice A member's slice of the forfeit pool, by intervals met.
    function streakRewardOf(address member) public view returns (uint256) {
        if (totalIntervalsMet == 0) return 0;
        return (uint256(commitmentRewardPool) * intervalsMet[member]) / totalIntervalsMet;
    }

    function _extraRefund(address member, uint96) internal override returns (uint256) {
        if (streakRewardClaimed[member]) return 0;
        uint256 share = streakRewardOf(member);
        if (share > 0) streakRewardClaimed[member] = true;
        return share;
    }

    /// @dev Freeze the reward denominators at settlement so shares can't shift.
    function _onRelease() internal override {}
}
