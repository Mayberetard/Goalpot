// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title GoalPot — Group Savings Pots with DAO-gated early exit
/// @notice Members pool native MON toward a shared goal.
///         - Goal reached  -> anyone may trigger release to the beneficiary.
///         - Deadline missed -> pot flips to Refunding; members pull their share back.
///         - Early exit    -> requires a deposit-weighted majority vote of the other
///           members; a penalty (in bps, e.g. 5%) stays in the pot for the rest.
/// @dev Design notes for auditors:
///      * All balances are tracked internally per pot; `address(this).balance` is
///        never used for logic, so force-fed value cannot skew goal progress.
///      * All value leaves via pull-style or single-recipient CEI transfers guarded
///        by a reentrancy lock.
///      * No state-changing path iterates over the member list; list reads are
///        paginated view functions for the UI only.
///      * Votes are weighted by deposit to resist sybil dust-deposit vote packing.
contract GoalPot {
    // ---------------------------------------------------------------- errors
    error PotNotFound();
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
    error NotBeneficiary();

    // ---------------------------------------------------------------- types
    enum PotState {
        Active,    // accepting deposits, before resolution
        Released,  // goal met, funds sent to beneficiary
        Refunding  // deadline missed, members pull refunds
    }

    struct Pot {
        string name;            // bounded at creation (<= 64 bytes)
        address creator;
        address beneficiary;    // where funds go on success
        uint96 goal;            // wei
        uint40 deadline;        // unix timestamp
        uint40 votingPeriod;    // seconds an exit vote stays open
        uint16 penaltyBps;      // early-exit penalty, e.g. 500 = 5%
        uint96 minDeposit;      // sybil floor for membership/vote weight
        bool openJoin;          // false = invite-only (creator-managed allowlist)
        PotState state;
        uint96 totalDeposited;  // sum of active members' deposits
        uint96 penaltyPool;     // penalties retained for remaining members
        uint32 memberCount;     // members with a non-zero deposit
        // refund snapshot, fixed when state flips to Refunding
        uint96 refundTotal;
        uint96 refundPenalty;
    }

    struct ExitRequest {
        address requester;
        uint40 deadline;        // vote close time
        uint96 yesWeight;
        uint96 noWeight;
        uint96 eligibleWeight;  // totalDeposited - requester deposit, at request time
        bool open;
    }

    // ---------------------------------------------------------------- storage
    uint256 public potCount;
    mapping(uint256 => Pot) internal pots;
    mapping(uint256 => mapping(address => uint96)) public depositOf;
    mapping(uint256 => address[]) internal memberList; // append-only, for UI reads
    mapping(uint256 => mapping(address => bool)) internal everMember;
    mapping(uint256 => mapping(address => bool)) public invitedOf; // invite-only pots
    mapping(uint256 => uint256) public payoutOf; // released, unclaimed beneficiary funds

    mapping(uint256 => ExitRequest) public exitRequestOf; // one live request per pot
    mapping(uint256 => uint256) public exitRound;         // bumps per request
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public hasVoted;

    uint256 private _lock = 1;

    uint256 public constant MAX_PENALTY_BPS = 2_000;   // 20% ceiling
    uint256 public constant MAX_NAME_BYTES = 64;
    uint256 public constant MIN_VOTING_PERIOD = 5 minutes;
    uint256 public constant MAX_VOTING_PERIOD = 30 days;

    // ---------------------------------------------------------------- events
    event PotCreated(
        uint256 indexed potId,
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
    event Deposited(uint256 indexed potId, address indexed member, uint256 amount, uint256 newTotal);
    event Released(uint256 indexed potId, address indexed beneficiary, uint256 amount);
    event RefundingStarted(uint256 indexed potId, uint256 totalDeposited, uint256 penaltyPool);
    event Refunded(uint256 indexed potId, address indexed member, uint256 amount);
    event ExitRequested(uint256 indexed potId, uint256 indexed round, address indexed requester, uint256 voteDeadline);
    event ExitVoted(uint256 indexed potId, uint256 indexed round, address indexed voter, bool support, uint256 weight);
    event ExitExecuted(uint256 indexed potId, uint256 indexed round, address indexed requester, uint256 payout, uint256 penalty);
    event ExitClosed(uint256 indexed potId, uint256 indexed round, bool passed);
    event MembersInvited(uint256 indexed potId, address[] invitees);
    event PayoutClaimed(uint256 indexed potId, address indexed beneficiary, uint256 amount);

    // ---------------------------------------------------------------- modifiers
    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier exists(uint256 potId) {
        if (potId >= potCount) revert PotNotFound();
        _;
    }

    // ---------------------------------------------------------------- create
    /// @param openJoin true = anyone may deposit; false = invite-only, seeded
    ///        with `invitees` (creator is always allowed) and extendable later
    ///        via {inviteMembers}.
    function createPot(
        string calldata name,
        address beneficiary,
        uint96 goal,
        uint40 deadline,
        uint16 penaltyBps,
        uint96 minDeposit,
        uint40 votingPeriod,
        bool openJoin,
        address[] calldata invitees
    ) external returns (uint256 potId) {
        if (
            bytes(name).length == 0 ||
            bytes(name).length > MAX_NAME_BYTES ||
            beneficiary == address(0) ||
            goal == 0 ||
            deadline <= block.timestamp ||
            penaltyBps > MAX_PENALTY_BPS ||
            votingPeriod < MIN_VOTING_PERIOD ||
            votingPeriod > MAX_VOTING_PERIOD
        ) revert BadParams();

        potId = potCount++;
        Pot storage p = pots[potId];
        p.name = name;
        p.creator = msg.sender;
        p.beneficiary = beneficiary;
        p.goal = goal;
        p.deadline = deadline;
        p.penaltyBps = penaltyBps;
        p.minDeposit = minDeposit;
        p.votingPeriod = votingPeriod;
        p.openJoin = openJoin;
        p.state = PotState.Active;

        if (!openJoin) {
            invitedOf[potId][msg.sender] = true;
            _invite(potId, invitees);
        }

        emit PotCreated(
            potId,
            msg.sender,
            p.beneficiary,
            p.name,
            p.goal,
            p.deadline,
            p.penaltyBps,
            p.minDeposit,
            p.votingPeriod,
            p.openJoin
        );
    }

    /// @notice Creator extends an invite-only pot's allowlist while it is Active.
    function inviteMembers(uint256 potId, address[] calldata invitees) external exists(potId) {
        Pot storage p = pots[potId];
        if (msg.sender != p.creator) revert NotCreator();
        if (p.state != PotState.Active) revert NotActive();
        if (p.openJoin) revert BadParams();
        _invite(potId, invitees);
    }

    function _invite(uint256 potId, address[] calldata invitees) internal {
        if (invitees.length > 100) revert TooManyInvites(); // bound the loop
        for (uint256 i = 0; i < invitees.length; i++) {
            if (invitees[i] == address(0)) revert BadParams();
            invitedOf[potId][invitees[i]] = true;
        }
        if (invitees.length > 0) emit MembersInvited(potId, invitees);
    }

    // ---------------------------------------------------------------- deposit
    function deposit(uint256 potId) external payable exists(potId) {
        Pot storage p = pots[potId];
        if (p.state != PotState.Active) revert NotActive();
        if (block.timestamp >= p.deadline) revert DeadlinePassed();
        if (msg.value == 0) revert ZeroAmount();
        if (msg.value > type(uint96).max) revert BadParams();

        uint96 prev = depositOf[potId][msg.sender];
        if (prev == 0) {
            if (!p.openJoin && !invitedOf[potId][msg.sender]) revert NotInvited();
            if (msg.value < p.minDeposit) revert BelowMinDeposit();
            p.memberCount += 1;
            if (!everMember[potId][msg.sender]) {
                everMember[potId][msg.sender] = true;
                memberList[potId].push(msg.sender);
            }
        }
        depositOf[potId][msg.sender] = prev + uint96(msg.value);
        p.totalDeposited += uint96(msg.value);

        emit Deposited(potId, msg.sender, msg.value, p.totalDeposited);
    }

    // ---------------------------------------------------------------- release
    /// @notice Goal reached -> anyone can settle the pot. Funds are credited to
    ///         the beneficiary (pull payment) rather than pushed, so a
    ///         beneficiary that cannot receive value can never freeze the pot.
    function release(uint256 potId) external exists(potId) {
        Pot storage p = pots[potId];
        if (p.state != PotState.Active) revert NotActive();
        uint256 balance = uint256(p.totalDeposited) + p.penaltyPool;
        if (balance < p.goal) revert GoalNotReached();

        p.state = PotState.Released;
        p.totalDeposited = 0;
        p.penaltyPool = 0;
        payoutOf[potId] = balance;

        emit Released(potId, p.beneficiary, balance);
    }

    /// @notice Beneficiary pulls the released pot.
    function claimPayout(uint256 potId) external exists(potId) nonReentrant {
        Pot storage p = pots[potId];
        if (msg.sender != p.beneficiary) revert NotBeneficiary();
        uint256 amount = payoutOf[potId];
        if (amount == 0) revert NothingToClaim();
        payoutOf[potId] = 0;

        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit PayoutClaimed(potId, msg.sender, amount);
    }

    // ---------------------------------------------------------------- refunds
    /// @notice Deadline missed with goal unmet -> flip to Refunding and snapshot
    ///         totals so each member's share is order-independent.
    function startRefunds(uint256 potId) public exists(potId) {
        Pot storage p = pots[potId];
        if (p.state != PotState.Active) revert NotActive();
        if (block.timestamp < p.deadline) revert DeadlineNotPassed();
        if (uint256(p.totalDeposited) + p.penaltyPool >= p.goal) revert GoalAlreadyReached();

        p.state = PotState.Refunding;
        p.refundTotal = p.totalDeposited;
        p.refundPenalty = p.penaltyPool;
        emit RefundingStarted(potId, p.totalDeposited, p.penaltyPool);
    }

    /// @notice Pull your deposit back, plus a pro-rata slice of retained penalties.
    function claimRefund(uint256 potId) external exists(potId) nonReentrant {
        Pot storage p = pots[potId];
        if (p.state == PotState.Active) {
            startRefunds(potId); // permissionless flip if conditions hold
        }
        if (p.state != PotState.Refunding) revert NotActive();

        uint96 d = depositOf[potId][msg.sender];
        if (d == 0) revert NothingToClaim();
        depositOf[potId][msg.sender] = 0;
        p.memberCount -= 1;

        uint256 bonus = p.refundTotal == 0 ? 0 : (uint256(p.refundPenalty) * d) / p.refundTotal;
        uint256 amount = uint256(d) + bonus;

        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Refunded(potId, msg.sender, amount);
    }

    // ---------------------------------------------------------------- early exit (DAO vote)
    /// @notice Ask the other members for permission to leave early.
    function requestExit(uint256 potId) external exists(potId) {
        Pot storage p = pots[potId];
        if (p.state != PotState.Active) revert NotActive();
        if (block.timestamp >= p.deadline) revert DeadlinePassed();
        uint96 d = depositOf[potId][msg.sender];
        if (d == 0) revert NotMember();

        ExitRequest storage r = exitRequestOf[potId];
        if (r.open) {
            // A stale, expired, failed request can be displaced.
            if (block.timestamp <= r.deadline) revert ExitAlreadyPending();
            emit ExitClosed(potId, exitRound[potId], false);
        }

        uint256 round = ++exitRound[potId];
        uint40 voteDeadline = uint40(block.timestamp) + p.votingPeriod;
        if (voteDeadline > p.deadline) voteDeadline = p.deadline;

        exitRequestOf[potId] = ExitRequest({
            requester: msg.sender,
            deadline: voteDeadline,
            yesWeight: 0,
            noWeight: 0,
            eligibleWeight: p.totalDeposited - d,
            open: true
        });
        emit ExitRequested(potId, round, msg.sender, voteDeadline);
    }

    /// @notice Vote on the pot's live exit request. Weight = your current deposit.
    function voteOnExit(uint256 potId, bool support) external exists(potId) {
        Pot storage p = pots[potId];
        if (p.state != PotState.Active) revert NotActive();
        ExitRequest storage r = exitRequestOf[potId];
        if (!r.open) revert NoPendingExit();
        if (block.timestamp > r.deadline) revert VoteClosed();
        if (msg.sender == r.requester) revert SelfVote();

        uint96 w = depositOf[potId][msg.sender];
        if (w == 0) revert NotMember();

        uint256 round = exitRound[potId];
        if (hasVoted[potId][round][msg.sender]) revert AlreadyVoted();
        hasVoted[potId][round][msg.sender] = true;

        if (support) r.yesWeight += w;
        else r.noWeight += w;
        emit ExitVoted(potId, round, msg.sender, support, w);
    }

    /// @notice Execute a passed exit: requester leaves with (100% - penalty)%,
    ///         the penalty stays in the pot for the remaining members.
    function executeExit(uint256 potId) external exists(potId) nonReentrant {
        Pot storage p = pots[potId];
        if (p.state != PotState.Active) revert NotActive();
        ExitRequest storage r = exitRequestOf[potId];
        if (!r.open) revert NoPendingExit();

        uint96 d = depositOf[potId][r.requester];
        // Majority of the weight that was eligible when the request opened.
        // A sole member has no one to convince: zero eligible weight passes.
        bool passed = d > 0 &&
            (r.eligibleWeight == 0 || uint256(r.yesWeight) * 2 > r.eligibleWeight);
        if (!passed) revert VoteNotPassed();

        uint256 round = exitRound[potId];
        address requester = r.requester;
        r.open = false;

        uint256 penalty = (uint256(d) * p.penaltyBps) / 10_000;
        uint256 payout = uint256(d) - penalty;

        depositOf[potId][requester] = 0;
        p.memberCount -= 1;
        p.totalDeposited -= d;
        p.penaltyPool += uint96(penalty);

        (bool ok, ) = requester.call{value: payout}("");
        if (!ok) revert TransferFailed();
        emit ExitExecuted(potId, round, requester, payout, penalty);
        emit ExitClosed(potId, round, true);
    }

    // ---------------------------------------------------------------- views
    function getPot(uint256 potId) external view exists(potId) returns (Pot memory) {
        return pots[potId];
    }

    /// @notice Paginated member list with live deposits (zero = exited/refunded).
    function getMembers(uint256 potId, uint256 offset, uint256 limit)
        external
        view
        exists(potId)
        returns (address[] memory addrs, uint256[] memory amounts, uint256 total)
    {
        address[] storage list = memberList[potId];
        total = list.length;
        if (offset >= total) return (new address[](0), new uint256[](0), total);
        uint256 n = total - offset;
        if (n > limit) n = limit;
        addrs = new address[](n);
        amounts = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            address m = list[offset + i];
            addrs[i] = m;
            amounts[i] = depositOf[potId][m];
        }
    }

    function potBalance(uint256 potId) external view exists(potId) returns (uint256) {
        Pot storage p = pots[potId];
        return uint256(p.totalDeposited) + p.penaltyPool;
    }

    /// @dev No receive/fallback: direct transfers to the contract revert, keeping
    ///      internal accounting equal to real balance minus nothing.
}
