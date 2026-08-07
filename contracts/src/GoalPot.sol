// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

interface IGoalPotFactory {
    function feeInfo() external view returns (address treasury, uint16 feeBps);
}

/// @title GoalPot — one savings pot per clone (implementation base)
/// @notice Shared machinery for every pot type: deposits & membership,
///         invite allowlists, the DAO-gated early exit (with quorum, abstain
///         and one-level delegation), release with protocol fee, and
///         pull-payment refunds/claims.
/// @dev Deployed once per type as an implementation and cloned (EIP-1167) by
///      GoalPotFactory. Never holds funds as the implementation:
///      the constructor disables initializers.
///
///      Security posture carried over from v1 (single-contract) GoalPot:
///      internal accounting only, reentrancy mutex + CEI, pull payments
///      everywhere, no unbounded loops in state-changing paths,
///      deposit-weighted votes with a minimum-deposit sybil floor.
abstract contract GoalPot is Initializable {
    // ---------------------------------------------------------------- errors
    error NotActive();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error GoalNotReached();
    error GoalAlreadyReached();
    error ZeroAmount();
    error BelowMinDeposit();
    error NotMember();
    error NothingToClaim();
    error BadParams();
    error ExitAlreadyPending();
    error NoPendingExit();
    error AlreadyVoted();
    error SelfVote();
    error VoteClosed();
    error VoteNotPassed();
    error TransferFailed();
    error Reentrancy();
    error NotInvited();
    error NotCreator();
    error TooManyInvites();
    error BadDelegation();
    error MessageTooLong();

    // ---------------------------------------------------------------- types
    enum PotState {
        Active,
        Released,
        Refunding
    }

    enum VoteChoice {
        No,
        Yes,
        Abstain
    }

    struct InitParams {
        string name;
        address creator;
        address beneficiary;
        uint96 goal;
        uint40 deadline;
        uint16 penaltyBps;
        uint96 minDeposit;
        uint40 votingPeriod;
        bool openJoin;
    }

    struct ExitRequest {
        address requester;
        uint40 deadline;
        uint96 yesWeight;
        uint96 noWeight;
        uint96 abstainWeight;
        uint96 eligibleWeight; // totalDeposited - requester deposit, at request time
        bool open;
    }

    // ---------------------------------------------------------------- config
    uint256 public constant MAX_PENALTY_BPS = 2_000; // 20%
    uint256 public constant MAX_NAME_BYTES = 64;
    uint256 public constant MIN_VOTING_PERIOD = 5 minutes;
    uint256 public constant MAX_VOTING_PERIOD = 30 days;
    uint256 public constant QUORUM_BPS = 2_500; // 25% of eligible weight
    uint256 public constant MAX_UPDATE_BYTES = 280;

    // ---------------------------------------------------------------- storage
    address public factory;
    string public name;
    address public creator;
    address public beneficiary;
    uint96 public goal;
    uint40 public deadline;
    uint40 public votingPeriod;
    uint16 public penaltyBps;
    uint96 public minDeposit;
    bool public openJoin;
    PotState public state;

    uint96 public totalDeposited; // sum of active members' deposits
    uint96 public penaltyPool;    // early-exit penalties retained for the group
    uint32 public memberCount;

    // refund snapshot, fixed when state flips to Refunding
    uint96 public refundTotal;
    uint96 public refundPenalty;

    mapping(address => uint96) public depositOf;
    address[] internal memberList; // append-only, for UI reads
    mapping(address => bool) internal everMember;
    mapping(address => bool) public invitedOf;

    /// released/failed-transfer funds waiting to be pulled (beneficiary, treasury)
    mapping(address => uint256) public claimable;

    // exit vote
    ExitRequest public exitRequest;
    uint256 public exitRound;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    // one-level vote delegation
    mapping(address => address) public delegateOf;   // member -> delegatee (0 = none)
    mapping(address => uint96) public delegatedIn;   // delegatee -> received weight

    uint256 private _lock;

    // ---------------------------------------------------------------- events
    event Initialized_(
        address indexed creator,
        address indexed beneficiary,
        string name,
        uint256 goal,
        uint256 deadline,
        uint256 penaltyBps,
        uint256 minDeposit,
        uint256 votingPeriod,
        bool openJoin
    );
    event Deposited(address indexed member, uint256 amount, uint256 newTotal);
    event Released(address indexed beneficiary, uint256 net, uint256 fee);
    event PayoutClaimed(address indexed recipient, uint256 amount);
    event RefundingStarted(uint256 totalDeposited, uint256 penaltyPool);
    event Refunded(address indexed member, uint256 amount);
    event ExitRequested(uint256 indexed round, address indexed requester, uint256 voteDeadline);
    event ExitVoted(uint256 indexed round, address indexed voter, VoteChoice choice, uint256 weight);
    event ExitExecuted(uint256 indexed round, address indexed requester, uint256 payout, uint256 penalty);
    event ExitClosed(uint256 indexed round, bool passed);
    event MembersInvited(address[] invitees);
    event DelegateSet(address indexed member, address indexed delegatee);
    event PotUpdatePosted(address indexed author, string message, uint256 timestamp);

    constructor() {
        _disableInitializers();
    }

    // ---------------------------------------------------------------- modifiers
    modifier nonReentrant() {
        if (_lock == 2) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    // ---------------------------------------------------------------- init
    function __base_init(InitParams calldata p, address[] calldata invitees) internal onlyInitializing {
        if (
            bytes(p.name).length == 0 ||
            bytes(p.name).length > MAX_NAME_BYTES ||
            p.creator == address(0) ||
            p.beneficiary == address(0) ||
            p.goal == 0 ||
            p.deadline <= block.timestamp ||
            p.penaltyBps > MAX_PENALTY_BPS ||
            p.votingPeriod < MIN_VOTING_PERIOD ||
            p.votingPeriod > MAX_VOTING_PERIOD
        ) revert BadParams();

        factory = msg.sender;
        name = p.name;
        creator = p.creator;
        beneficiary = p.beneficiary;
        goal = p.goal;
        deadline = p.deadline;
        penaltyBps = p.penaltyBps;
        minDeposit = p.minDeposit;
        votingPeriod = p.votingPeriod;
        openJoin = p.openJoin;
        state = PotState.Active;
        _lock = 1;

        if (!p.openJoin) {
            invitedOf[p.creator] = true;
            _invite(invitees);
        }

        emit Initialized_(
            p.creator, p.beneficiary, p.name, p.goal, p.deadline, p.penaltyBps, p.minDeposit, p.votingPeriod, p.openJoin
        );
    }

    // ---------------------------------------------------------------- invites
    function inviteMembers(address[] calldata invitees) external {
        if (msg.sender != creator) revert NotCreator();
        if (state != PotState.Active) revert NotActive();
        if (openJoin) revert BadParams();
        _invite(invitees);
    }

    function _invite(address[] calldata invitees) internal {
        if (invitees.length > 100) revert TooManyInvites(); // bound the loop
        for (uint256 i = 0; i < invitees.length; i++) {
            if (invitees[i] == address(0)) revert BadParams();
            invitedOf[invitees[i]] = true;
        }
        if (invitees.length > 0) emit MembersInvited(invitees);
    }

    // ---------------------------------------------------------------- deposit
    function deposit() public payable virtual {
        if (state != PotState.Active) revert NotActive();
        if (block.timestamp >= deadline) revert DeadlinePassed();
        if (msg.value == 0) revert ZeroAmount();
        if (msg.value > type(uint96).max) revert BadParams();

        uint96 prev = depositOf[msg.sender];
        if (prev == 0) {
            if (!openJoin && !invitedOf[msg.sender]) revert NotInvited();
            if (msg.value < minDeposit) revert BelowMinDeposit();
            memberCount += 1;
            if (!everMember[msg.sender]) {
                everMember[msg.sender] = true;
                memberList.push(msg.sender);
            }
        }

        _onDeposit(msg.sender, prev); // pot-type hook (e.g. streak accounting)

        depositOf[msg.sender] = depositOf[msg.sender] + uint96(msg.value);
        totalDeposited += uint96(msg.value);

        address d = delegateOf[msg.sender];
        if (d != address(0)) delegatedIn[d] += uint96(msg.value);

        emit Deposited(msg.sender, msg.value, totalDeposited);
    }

    /// @dev Hook before the deposit is credited; `prev` is the balance before.
    function _onDeposit(address member, uint96 prev) internal virtual {}

    // ---------------------------------------------------------------- release
    /// @notice Goal reached -> anyone can settle the pot. The beneficiary's
    ///         payout (minus the protocol fee) becomes pull-claimable.
    function release() external virtual {
        _release();
    }

    function _release() internal {
        if (state != PotState.Active) revert NotActive();
        uint256 balance = uint256(totalDeposited) + penaltyPool;
        if (balance < goal) revert GoalNotReached();

        state = PotState.Released;
        totalDeposited = 0;
        penaltyPool = 0;

        uint256 fee;
        (address treasury, uint16 feeBps) = IGoalPotFactory(factory).feeInfo();
        if (feeBps > 0 && treasury != address(0)) {
            fee = (balance * feeBps) / 10_000;
            claimable[treasury] += fee;
        }
        claimable[beneficiary] += balance - fee;

        _onRelease(); // pot-type hook (e.g. snapshot streak rewards)
        emit Released(beneficiary, balance - fee, fee);
    }

    function _onRelease() internal virtual {}

    /// @notice Pull whatever this address is owed (beneficiary payout,
    ///         protocol fee, streak rewards credited by subtypes, ...).
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit PayoutClaimed(msg.sender, amount);
    }

    // ---------------------------------------------------------------- refunds
    function startRefunds() public {
        if (state != PotState.Active) revert NotActive();
        if (block.timestamp < deadline) revert DeadlineNotPassed();
        if (uint256(totalDeposited) + penaltyPool >= goal) revert GoalAlreadyReached();

        state = PotState.Refunding;
        refundTotal = totalDeposited;
        refundPenalty = penaltyPool;
        _onRefundingStarted();
        emit RefundingStarted(totalDeposited, penaltyPool);
    }

    function _onRefundingStarted() internal virtual {}

    /// @notice Pull your deposit back plus a pro-rata slice of retained
    ///         penalties (subtypes may add more, e.g. streak rewards).
    function claimRefund() external nonReentrant {
        if (state == PotState.Active) startRefunds(); // permissionless flip
        if (state != PotState.Refunding) revert NotActive();

        uint96 d = depositOf[msg.sender];
        if (d == 0) revert NothingToClaim();
        depositOf[msg.sender] = 0;
        memberCount -= 1;
        _clearDelegation(msg.sender, d);

        uint256 bonus = refundTotal == 0 ? 0 : (uint256(refundPenalty) * d) / refundTotal;
        uint256 amount = uint256(d) + bonus + _extraRefund(msg.sender, d);

        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Refunded(msg.sender, amount);
    }

    /// @dev Subtype hook: extra wei owed to `member` on refund (e.g. streak
    ///      reward share). Called after their deposit is zeroed.
    function _extraRefund(address member, uint96 depositBefore) internal virtual returns (uint256) {
        return 0;
    }

    // ---------------------------------------------------------------- delegation
    /// @notice Delegate your vote weight to another member (one level only:
    ///         your delegatee must not have delegated, and you cannot delegate
    ///         while others delegate to you). Zero address clears.
    function setDelegate(address to) external {
        if (state != PotState.Active) revert NotActive();
        uint96 d = depositOf[msg.sender];
        if (d == 0) revert NotMember();

        address prev = delegateOf[msg.sender];
        if (prev != address(0)) delegatedIn[prev] -= d;

        if (to != address(0)) {
            if (
                to == msg.sender ||
                depositOf[to] == 0 ||
                delegateOf[to] != address(0) || // no chains forward
                delegatedIn[msg.sender] != 0    // no chains backward
            ) revert BadDelegation();
            delegatedIn[to] += d;
        }
        delegateOf[msg.sender] = to;
        emit DelegateSet(msg.sender, to);
    }

    function _clearDelegation(address member, uint96 weight) internal {
        address d = delegateOf[member];
        if (d != address(0)) {
            delegatedIn[d] -= weight;
            delegateOf[member] = address(0);
        }
    }

    /// @notice The weight `voter` would vote with right now.
    function voteWeightOf(address voter) public view returns (uint256 w) {
        if (delegateOf[voter] == address(0)) w = depositOf[voter];
        w += delegatedIn[voter];
    }

    // ---------------------------------------------------------------- early exit
    function requestExit() external {
        if (state != PotState.Active) revert NotActive();
        if (block.timestamp >= deadline) revert DeadlinePassed();
        uint96 d = depositOf[msg.sender];
        if (d == 0) revert NotMember();

        ExitRequest storage r = exitRequest;
        if (r.open) {
            if (block.timestamp <= r.deadline) revert ExitAlreadyPending();
            emit ExitClosed(exitRound, false); // expired without passing
        }

        uint256 round = ++exitRound;
        uint40 voteDeadline = uint40(block.timestamp) + votingPeriod;
        if (voteDeadline > deadline) voteDeadline = deadline;

        exitRequest = ExitRequest({
            requester: msg.sender,
            deadline: voteDeadline,
            yesWeight: 0,
            noWeight: 0,
            abstainWeight: 0,
            eligibleWeight: totalDeposited - d,
            open: true
        });
        emit ExitRequested(round, msg.sender, voteDeadline);
    }

    function voteOnExit(VoteChoice choice) external {
        if (state != PotState.Active) revert NotActive();
        ExitRequest storage r = exitRequest;
        if (!r.open) revert NoPendingExit();
        if (block.timestamp > r.deadline) revert VoteClosed();
        if (msg.sender == r.requester) revert SelfVote();

        uint256 w = voteWeightOf(msg.sender);
        // never let the requester's own stake vote, even via delegation
        if (delegateOf[r.requester] == msg.sender) w -= depositOf[r.requester];
        if (w == 0) revert NotMember();

        uint256 round = exitRound;
        if (hasVoted[round][msg.sender]) revert AlreadyVoted();
        hasVoted[round][msg.sender] = true;

        if (choice == VoteChoice.Yes) r.yesWeight += uint96(w);
        else if (choice == VoteChoice.No) r.noWeight += uint96(w);
        else r.abstainWeight += uint96(w);
        emit ExitVoted(round, msg.sender, choice, w);
    }

    /// @notice Execute a passed exit. Passing rules:
    ///         - sole member (zero eligible weight): passes outright;
    ///         - before the vote deadline: yes > 50% of eligible weight;
    ///         - after the vote deadline: quorum (>= 25% of eligible weight
    ///           voted, any choice) AND yes > no.
    function executeExit() external nonReentrant {
        if (state != PotState.Active) revert NotActive();
        ExitRequest storage r = exitRequest;
        if (!r.open) revert NoPendingExit();

        uint96 d = depositOf[r.requester];
        bool passed;
        if (d > 0) {
            if (r.eligibleWeight == 0) {
                passed = true; // no one to object
            } else if (uint256(r.yesWeight) * 2 > r.eligibleWeight) {
                passed = true; // absolute majority, executable early
            } else if (block.timestamp > r.deadline) {
                uint256 voted = uint256(r.yesWeight) + r.noWeight + r.abstainWeight;
                passed = voted * 10_000 >= uint256(r.eligibleWeight) * QUORUM_BPS && r.yesWeight > r.noWeight;
            }
        }
        if (!passed) revert VoteNotPassed();

        uint256 round = exitRound;
        address requester = r.requester;
        r.open = false;

        uint256 penalty = (uint256(d) * penaltyBps) / 10_000;
        uint256 payout = uint256(d) - penalty;

        depositOf[requester] = 0;
        memberCount -= 1;
        totalDeposited -= d;
        penaltyPool += uint96(penalty);
        _clearDelegation(requester, d);

        (bool ok, ) = requester.call{value: payout}("");
        if (!ok) revert TransferFailed();
        emit ExitExecuted(round, requester, payout, penalty);
        emit ExitClosed(round, true);
    }

    // ---------------------------------------------------------------- updates board
    /// @notice Members and the creator can post short updates; stored as
    ///         events only (the chain is the message board).
    function postUpdate(string calldata message) external {
        if (msg.sender != creator && depositOf[msg.sender] == 0) revert NotMember();
        if (bytes(message).length == 0 || bytes(message).length > MAX_UPDATE_BYTES) revert MessageTooLong();
        emit PotUpdatePosted(msg.sender, message, block.timestamp);
    }

    // ---------------------------------------------------------------- views
    function potType() external pure virtual returns (uint8);

    function potBalance() external view returns (uint256) {
        return uint256(totalDeposited) + penaltyPool;
    }

    function getMembers(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory addrs, uint256[] memory amounts, uint256 total)
    {
        total = memberList.length;
        if (offset >= total) return (new address[](0), new uint256[](0), total);
        uint256 n = total - offset;
        if (n > limit) n = limit;
        addrs = new address[](n);
        amounts = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            address m = memberList[offset + i];
            addrs[i] = m;
            amounts[i] = depositOf[m];
        }
    }

    /// @dev No receive/fallback: direct transfers revert, keeping internal
    ///      accounting equal to the real balance.
}
