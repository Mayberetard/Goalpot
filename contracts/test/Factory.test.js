const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const DAY = 24 * 60 * 60;
const HOUR = 60 * 60;

async function now() {
  return (await ethers.provider.getBlock("latest")).timestamp;
}
async function warpTo(ts) {
  await network.provider.send("evm_setNextBlockTimestamp", [ts]);
  await network.provider.send("evm_mine");
}

/** Deploy implementations + factory. feeBps default 50 = 0.5%. */
async function deployFactory(treasury, feeBps = 50) {
  const standard = await (await ethers.getContractFactory("StandardPot")).deploy();
  const streak = await (await ethers.getContractFactory("StreakPot")).deploy();
  const charity = await (await ethers.getContractFactory("CharityPot")).deploy();
  const factory = await (
    await ethers.getContractFactory("GoalPotFactory")
  ).deploy(
    await standard.getAddress(),
    await streak.getAddress(),
    await charity.getAddress(),
    treasury,
    feeBps
  );
  return { factory, standard, streak, charity };
}

describe("GoalPotFactory + clones", () => {
  let alice, bob, carol, dave, beneficiary, treasury;
  let factory, impls;

  const GOAL = ethers.parseEther("10");
  const MIN_DEPOSIT = ethers.parseEther("0.1");

  function initParams(overrides = {}, deadline) {
    return {
      name: overrides.name ?? "Lisbon Trip Fund",
      creator: ethers.ZeroAddress, // factory overwrites with msg.sender
      beneficiary: overrides.beneficiary ?? beneficiary.address,
      goal: overrides.goal ?? GOAL,
      deadline,
      penaltyBps: overrides.penaltyBps ?? 500,
      minDeposit: overrides.minDeposit ?? MIN_DEPOSIT,
      votingPeriod: overrides.votingPeriod ?? 3 * DAY,
      openJoin: overrides.openJoin ?? true,
    };
  }

  async function createStandard(overrides = {}, invitees = []) {
    const deadline = overrides.deadline ?? (await now()) + 30 * DAY;
    const tx = await factory
      .connect(overrides.from ?? alice)
      .createStandardPot(initParams(overrides, deadline), invitees);
    await tx.wait();
    const addr = await factory.pots((await factory.potCount()) - 1n);
    return { pot: await ethers.getContractAt("StandardPot", addr), addr, deadline };
  }

  beforeEach(async () => {
    [alice, bob, carol, dave, beneficiary, treasury] = await ethers.getSigners();
    ({ factory, ...impls } = await deployFactory(treasury.address));
  });

  // ------------------------------------------------------------------ factory
  describe("factory", () => {
    it("clones a pot, registers it, and emits PotCreated", async () => {
      await expect(
        factory.createStandardPot(initParams({}, (await now()) + 30 * DAY), [])
      ).to.emit(factory, "PotCreated");

      expect(await factory.potCount()).to.equal(1);
      const addr = await factory.pots(0);
      expect(await factory.isPot(addr)).to.equal(true);
      expect(await factory.potTypeOf(addr)).to.equal(0);
    });

    it("initializes each clone with its own independent state", async () => {
      const a = await createStandard({ name: "Pot A", goal: ethers.parseEther("5") });
      const b = await createStandard({ name: "Pot B", goal: ethers.parseEther("9") });

      expect(await a.pot.name()).to.equal("Pot A");
      expect(await b.pot.name()).to.equal("Pot B");
      await a.pot.connect(bob).deposit({ value: ethers.parseEther("1") });
      expect(await a.pot.totalDeposited()).to.equal(ethers.parseEther("1"));
      expect(await b.pot.totalDeposited()).to.equal(0); // isolated storage
      expect(a.addr).to.not.equal(b.addr);
    });

    it("records the caller as creator regardless of calldata", async () => {
      const { pot } = await createStandard({ from: bob });
      expect(await pot.creator()).to.equal(bob.address);
    });

    it("cannot initialize an implementation directly", async () => {
      await expect(
        impls.standard.initialize(initParams({}, (await now()) + DAY), [])
      ).to.be.revertedWithCustomError(impls.standard, "InvalidInitialization");
    });

    it("cannot re-initialize a clone", async () => {
      const { pot } = await createStandard();
      await expect(
        pot.initialize(initParams({}, (await now()) + DAY), [])
      ).to.be.revertedWithCustomError(pot, "InvalidInitialization");
    });

    it("paginates pots", async () => {
      await createStandard();
      await createStandard();
      await createStandard();
      const [page, total] = await factory.getPots(1, 2);
      expect(total).to.equal(3);
      expect(page.length).to.equal(2);
      expect(page[0]).to.equal(await factory.pots(1));
    });

    it("rejects invalid init params through the factory", async () => {
      const past = (await now()) - 1;
      await expect(
        factory.createStandardPot(initParams({}, past), [])
      ).to.be.revertedWithCustomError(impls.standard, "BadParams");
    });
  });

  // ------------------------------------------------------------------ fee
  describe("protocol fee", () => {
    it("takes 0.5% on release and credits the treasury", async () => {
      const { pot } = await createStandard();
      await pot.connect(bob).deposit({ value: GOAL });

      const fee = (GOAL * 50n) / 10_000n; // 0.05 MON
      await expect(pot.release())
        .to.emit(pot, "Released")
        .withArgs(beneficiary.address, GOAL - fee, fee);

      expect(await pot.claimable(treasury.address)).to.equal(fee);
      expect(await pot.claimable(beneficiary.address)).to.equal(GOAL - fee);
      await expect(pot.connect(treasury).claim()).to.changeEtherBalance(treasury, fee);
      await expect(pot.connect(beneficiary).claim()).to.changeEtherBalance(
        beneficiary,
        GOAL - fee
      );
    });

    it("charges no fee when the factory fee is zero", async () => {
      ({ factory, ...impls } = await deployFactory(ethers.ZeroAddress, 0));
      const { pot } = await createStandard();
      await pot.connect(bob).deposit({ value: GOAL });
      await pot.release();
      expect(await pot.claimable(beneficiary.address)).to.equal(GOAL);
    });

    it("never charges a fee on refunds or early exits", async () => {
      const { pot, deadline } = await createStandard();
      await pot.connect(bob).deposit({ value: ethers.parseEther("2") });
      await pot.connect(carol).deposit({ value: ethers.parseEther("2") });

      // early exit: requester gets deposit - penalty, treasury untouched
      await pot.connect(carol).requestExit();
      await pot.connect(bob).voteOnExit(1); // Yes
      await expect(pot.connect(carol).executeExit()).to.changeEtherBalance(
        carol,
        ethers.parseEther("1.9")
      );
      expect(await pot.claimable(treasury.address)).to.equal(0);

      // refund: full deposit back plus penalty share, treasury untouched
      await warpTo(deadline + 1);
      await pot.connect(bob).claimRefund();
      expect(await pot.claimable(treasury.address)).to.equal(0);
    });

    it("caps the fee at 2% and gates it behind the owner", async () => {
      await expect(factory.setFee(treasury.address, 201)).to.be.revertedWithCustomError(
        factory,
        "FeeTooHigh"
      );
      await expect(
        factory.connect(bob).setFee(bob.address, 100)
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
      await factory.setFee(treasury.address, 200);
      expect(await factory.feeBps()).to.equal(200);
    });

    it("applies the fee live from the factory at release time", async () => {
      const { pot } = await createStandard();
      await pot.connect(bob).deposit({ value: GOAL });
      await factory.setFee(treasury.address, 100); // raise to 1% after creation
      await pot.release();
      expect(await pot.claimable(treasury.address)).to.equal((GOAL * 100n) / 10_000n);
    });

    it("lets the owner point at new implementations for future pots only", async () => {
      const fresh = await (await ethers.getContractFactory("StandardPot")).deploy();
      const before = await createStandard();
      await factory.setImplementation(0, await fresh.getAddress());
      const after = await createStandard();
      expect(await factory.standardImpl()).to.equal(await fresh.getAddress());
      expect(before.addr).to.not.equal(after.addr);
      expect(await before.pot.name()).to.equal("Lisbon Trip Fund"); // untouched
    });
  });

  // ------------------------------------------------------------------ standard behaviour
  describe("standard pot (v1 parity)", () => {
    it("tracks deposits, members and totals", async () => {
      const { pot } = await createStandard();
      await pot.connect(bob).deposit({ value: ethers.parseEther("2") });
      await pot.connect(carol).deposit({ value: ethers.parseEther("3") });
      await pot.connect(bob).deposit({ value: ethers.parseEther("1") });

      expect(await pot.depositOf(bob.address)).to.equal(ethers.parseEther("3"));
      expect(await pot.totalDeposited()).to.equal(ethers.parseEther("6"));
      expect(await pot.memberCount()).to.equal(2);
      const [addrs, amounts, total] = await pot.getMembers(0, 10);
      expect(total).to.equal(2);
      expect(addrs[0]).to.equal(bob.address);
      expect(amounts[1]).to.equal(ethers.parseEther("3"));
    });

    it("enforces the minimum first deposit and the deadline", async () => {
      const { pot, deadline } = await createStandard();
      await expect(
        pot.connect(bob).deposit({ value: ethers.parseEther("0.01") })
      ).to.be.revertedWithCustomError(pot, "BelowMinDeposit");
      await pot.connect(bob).deposit({ value: MIN_DEPOSIT });
      await pot.connect(bob).deposit({ value: 1n }); // top-ups may be small
      await warpTo(deadline + 1);
      await expect(
        pot.connect(carol).deposit({ value: MIN_DEPOSIT })
      ).to.be.revertedWithCustomError(pot, "DeadlinePassed");
    });

    it("gates invite-only pots behind the allowlist", async () => {
      const { pot } = await createStandard({ openJoin: false }, [carol.address]);
      await expect(
        pot.connect(bob).deposit({ value: MIN_DEPOSIT })
      ).to.be.revertedWithCustomError(pot, "NotInvited");
      await pot.connect(carol).deposit({ value: MIN_DEPOSIT }); // seeded invitee
      await pot.connect(alice).deposit({ value: MIN_DEPOSIT }); // creator
      await pot.connect(alice).inviteMembers([bob.address]);
      await pot.connect(bob).deposit({ value: MIN_DEPOSIT });
      await expect(
        pot.connect(bob).inviteMembers([dave.address])
      ).to.be.revertedWithCustomError(pot, "NotCreator");
    });

    it("refunds everyone when the deadline passes short of the goal", async () => {
      const { pot, deadline } = await createStandard();
      await pot.connect(bob).deposit({ value: ethers.parseEther("2") });
      await pot.connect(carol).deposit({ value: ethers.parseEther("3") });
      await warpTo(deadline + 1);
      await expect(pot.connect(bob).claimRefund()).to.changeEtherBalance(
        bob,
        ethers.parseEther("2")
      );
      await expect(pot.connect(carol).claimRefund()).to.changeEtherBalance(
        carol,
        ethers.parseEther("3")
      );
      await expect(pot.connect(bob).claimRefund()).to.be.revertedWithCustomError(
        pot,
        "NothingToClaim"
      );
    });

    it("splits early-exit penalties among the members who stayed", async () => {
      const { pot, deadline } = await createStandard();
      await pot.connect(bob).deposit({ value: ethers.parseEther("4") });
      await pot.connect(carol).deposit({ value: ethers.parseEther("4") });
      await pot.connect(dave).deposit({ value: ethers.parseEther("1") });

      await pot.connect(dave).requestExit();
      await pot.connect(bob).voteOnExit(1);
      await pot.connect(carol).voteOnExit(1);
      await pot.connect(dave).executeExit();

      await warpTo(deadline + 1);
      const penalty = ethers.parseEther("0.05");
      await expect(pot.connect(bob).claimRefund()).to.changeEtherBalance(
        bob,
        ethers.parseEther("4") + penalty / 2n
      );
    });

    it("rejects direct transfers to a pot", async () => {
      const { addr } = await createStandard();
      await expect(bob.sendTransaction({ to: addr, value: 1n })).to.be.reverted;
    });

    it("posts updates from members and the creator only", async () => {
      const { pot } = await createStandard();
      await expect(pot.connect(alice).postUpdate("kickoff!")).to.emit(pot, "PotUpdatePosted");
      await expect(pot.connect(bob).postUpdate("hi")).to.be.revertedWithCustomError(
        pot,
        "NotMember"
      );
      await pot.connect(bob).deposit({ value: MIN_DEPOSIT });
      await pot.connect(bob).postUpdate("in!");
      await expect(
        pot.connect(bob).postUpdate("x".repeat(281))
      ).to.be.revertedWithCustomError(pot, "MessageTooLong");
    });
  });

  // ------------------------------------------------------------------ voting
  describe("exit voting: quorum, abstain, delegation", () => {
    async function funded() {
      const created = await createStandard();
      await created.pot.connect(bob).deposit({ value: ethers.parseEther("2") });
      await created.pot.connect(carol).deposit({ value: ethers.parseEther("3") });
      await created.pot.connect(dave).deposit({ value: ethers.parseEther("1") });
      return created;
    }

    it("passes early on an absolute majority of eligible weight", async () => {
      const { pot } = await funded();
      await pot.connect(dave).requestExit();
      await pot.connect(carol).voteOnExit(1); // 3 of 5 eligible
      await expect(pot.connect(dave).executeExit()).to.changeEtherBalance(
        dave,
        ethers.parseEther("0.95")
      );
    });

    it("tracks abstentions separately from yes/no", async () => {
      const { pot } = await funded();
      await pot.connect(dave).requestExit();
      await pot.connect(bob).voteOnExit(2); // Abstain
      const r = await pot.exitRequest();
      expect(r.abstainWeight).to.equal(ethers.parseEther("2"));
      expect(r.yesWeight).to.equal(0);
      expect(r.noWeight).to.equal(0);
    });

    it("fails after the deadline when quorum is not met", async () => {
      // eligible = 5 MON, quorum = 1.25 MON; nobody votes
      const { pot } = await funded();
      await pot.connect(dave).requestExit();
      const r = await pot.exitRequest();
      await warpTo(Number(r.deadline) + 1);
      await expect(pot.connect(dave).executeExit()).to.be.revertedWithCustomError(
        pot,
        "VoteNotPassed"
      );
    });

    it("passes after the deadline on quorum + more yes than no", async () => {
      const { pot } = await funded();
      await pot.connect(dave).requestExit();
      await pot.connect(bob).voteOnExit(1); // 2 of 5 = 40% > 25% quorum, yes > no
      const r = await pot.exitRequest();
      await warpTo(Number(r.deadline) + 1);
      await expect(pot.connect(dave).executeExit()).to.changeEtherBalance(
        dave,
        ethers.parseEther("0.95")
      );
    });

    it("fails when quorum is met but no outweighs yes", async () => {
      const { pot } = await funded();
      await pot.connect(dave).requestExit();
      await pot.connect(bob).voteOnExit(0); // No, 2 MON
      const r = await pot.exitRequest();
      await warpTo(Number(r.deadline) + 1);
      await expect(pot.connect(dave).executeExit()).to.be.revertedWithCustomError(
        pot,
        "VoteNotPassed"
      );
    });

    it("lets a member delegate voting weight, one level only", async () => {
      const { pot } = await funded();
      await pot.connect(bob).setDelegate(carol.address);
      expect(await pot.voteWeightOf(carol.address)).to.equal(ethers.parseEther("5"));
      expect(await pot.voteWeightOf(bob.address)).to.equal(0);

      // no chains: carol cannot delegate onward while holding delegated weight
      await expect(
        pot.connect(carol).setDelegate(dave.address)
      ).to.be.revertedWithCustomError(pot, "BadDelegation");
      // and bob cannot delegate to someone who already delegated
      await expect(
        pot.connect(dave).setDelegate(bob.address)
      ).to.be.revertedWithCustomError(pot, "BadDelegation");
    });

    it("counts delegated weight in the vote and clears it on exit", async () => {
      const { pot } = await funded();
      await pot.connect(bob).setDelegate(carol.address);
      await pot.connect(dave).requestExit();
      await pot.connect(carol).voteOnExit(1); // carol votes 3 + bob's 2 = 5
      const r = await pot.exitRequest();
      expect(r.yesWeight).to.equal(ethers.parseEther("5"));
      await pot.connect(dave).executeExit();
      expect(await pot.depositOf(dave.address)).to.equal(0);
    });

    it("blocks self-votes, double votes, non-members and late votes", async () => {
      const { pot } = await funded();
      await pot.connect(dave).requestExit();
      await expect(pot.connect(dave).voteOnExit(1)).to.be.revertedWithCustomError(
        pot,
        "SelfVote"
      );
      await pot.connect(bob).voteOnExit(1);
      await expect(pot.connect(bob).voteOnExit(1)).to.be.revertedWithCustomError(
        pot,
        "AlreadyVoted"
      );
      await expect(pot.connect(alice).voteOnExit(1)).to.be.revertedWithCustomError(
        pot,
        "NotMember"
      );
      const r = await pot.exitRequest();
      await warpTo(Number(r.deadline) + 1);
      await expect(pot.connect(carol).voteOnExit(1)).to.be.revertedWithCustomError(
        pot,
        "VoteClosed"
      );
    });

    it("lets a sole member exit without votes", async () => {
      const { pot } = await createStandard();
      await pot.connect(bob).deposit({ value: ethers.parseEther("2") });
      await pot.connect(bob).requestExit();
      await expect(pot.connect(bob).executeExit()).to.changeEtherBalance(
        bob,
        ethers.parseEther("1.9")
      );
    });
  });

  // ------------------------------------------------------------------ streak
  describe("streak / commitment pot", () => {
    const WEEK = 7 * DAY;

    async function createStreak(overrides = {}) {
      const start = overrides.startTime ?? (await now()) + HOUR;
      const deadline = overrides.deadline ?? start + 12 * WEEK;
      const tx = await factory.createStreakPot(
        initParams({ goal: overrides.goal ?? ethers.parseEther("3") }, deadline),
        [],
        {
          intervalSeconds: WEEK,
          startTime: start,
          missPenaltyBps: overrides.missPenaltyBps ?? 1000, // 10%
          totalIntervals: overrides.totalIntervals ?? 12,
        }
      );
      await tx.wait();
      const addr = await factory.pots((await factory.potCount()) - 1n);
      return {
        pot: await ethers.getContractAt("StreakPot", addr),
        start,
        deadline,
      };
    }

    it("creates a streak pot with its schedule", async () => {
      const { pot, start } = await createStreak();
      expect(await pot.potType()).to.equal(1);
      expect(await pot.totalIntervals()).to.equal(12);
      expect(await pot.intervalDeadline(0)).to.equal(start);
      expect(await pot.intervalDeadline(2)).to.equal(start + 2 * WEEK);
    });

    it("credits interval 0 on joining and blocks late joiners", async () => {
      const { pot, start } = await createStreak();
      await pot.connect(bob).deposit({ value: ethers.parseEther("1") });
      expect(await pot.intervalsMet(bob.address)).to.equal(1);
      expect(await pot.dueIndex(bob.address)).to.equal(1);

      await warpTo(start + 1);
      await expect(
        pot.connect(carol).deposit({ value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(pot, "TooLateToJoin");
    });

    it("counts an on-time deposit toward the streak", async () => {
      const { pot, start } = await createStreak();
      await pot.connect(bob).deposit({ value: ethers.parseEther("1") });
      await warpTo(start + WEEK - HOUR); // inside interval 1
      await pot.connect(bob).deposit({ value: ethers.parseEther("1") });
      expect(await pot.intervalsMet(bob.address)).to.equal(2);
      expect(await pot.intervalsMissed(bob.address)).to.equal(0);
      expect(await pot.commitmentRewardPool()).to.equal(0);
    });

    it("forfeits a share of the stake for each missed interval", async () => {
      const { pot, start } = await createStreak(); // 10% miss penalty
      await pot.connect(bob).deposit({ value: ethers.parseEther("1") });
      await warpTo(start + WEEK + 1); // interval 1 missed

      await pot.assessMisses(bob.address); // permissionless
      expect(await pot.intervalsMissed(bob.address)).to.equal(1);
      expect(await pot.forfeitedAmount(bob.address)).to.equal(ethers.parseEther("0.1"));
      expect(await pot.depositOf(bob.address)).to.equal(ethers.parseEther("0.9"));
      expect(await pot.commitmentRewardPool()).to.equal(ethers.parseEther("0.1"));
      expect(await pot.totalDeposited()).to.equal(ethers.parseEther("0.9"));
    });

    it("charges every elapsed interval, not just the first", async () => {
      const { pot, start } = await createStreak();
      await pot.connect(bob).deposit({ value: ethers.parseEther("1") });
      await warpTo(start + 3 * WEEK + 1); // intervals 1,2,3 all missed
      await pot.assessMisses(bob.address);
      expect(await pot.intervalsMissed(bob.address)).to.equal(3);
      // 1 -> 0.9 -> 0.81 -> 0.729
      expect(await pot.depositOf(bob.address)).to.equal(ethers.parseEther("0.729"));
      expect(await pot.commitmentRewardPool()).to.equal(ethers.parseEther("0.271"));
    });

    it("assesses misses automatically on the next deposit", async () => {
      const { pot, start } = await createStreak();
      await pot.connect(bob).deposit({ value: ethers.parseEther("1") });
      await warpTo(start + WEEK + 1);
      await pot.connect(bob).deposit({ value: ethers.parseEther("1") });
      expect(await pot.intervalsMissed(bob.address)).to.equal(1);
      expect(await pot.intervalsMet(bob.address)).to.equal(2); // deposit counts for interval 2
    });

    it("splits the forfeit pool by intervals met after a successful release", async () => {
      const { pot, start } = await createStreak({ goal: ethers.parseEther("2") });
      await pot.connect(bob).deposit({ value: ethers.parseEther("1") });
      await pot.connect(carol).deposit({ value: ethers.parseEther("1") });

      // carol misses interval 1 (forfeits 0.1), bob stays on track
      await warpTo(start + WEEK - HOUR);
      await pot.connect(bob).deposit({ value: ethers.parseEther("1") });
      await warpTo(start + WEEK + 1);
      await pot.assessMisses(carol.address);

      expect(await pot.commitmentRewardPool()).to.equal(ethers.parseEther("0.1"));
      // bob met 2 intervals, carol met 1 -> bob gets 2/3 of the pool
      await pot.release();
      const bobShare = (ethers.parseEther("0.1") * 2n) / 3n;
      expect(await pot.streakRewardOf(bob.address)).to.equal(bobShare);

      await pot.connect(bob).claimStreakReward();
      await expect(pot.connect(bob).claim()).to.changeEtherBalance(bob, bobShare);
      await expect(
        pot.connect(bob).claimStreakReward()
      ).to.be.revertedWithCustomError(pot, "AlreadyClaimedReward");
    });

    it("pays the forfeit share out with the refund when the goal is missed", async () => {
      const { pot, start, deadline } = await createStreak({ goal: ethers.parseEther("50") });
      await pot.connect(bob).deposit({ value: ethers.parseEther("1") });
      await pot.connect(carol).deposit({ value: ethers.parseEther("1") });
      await warpTo(start + WEEK - HOUR);
      await pot.connect(bob).deposit({ value: ethers.parseEther("1") });
      await warpTo(start + WEEK + 1);
      await pot.assessMisses(carol.address); // carol forfeits 0.1

      await warpTo(deadline + 1);
      // bob: 2 MON deposits + 2/3 of the 0.1 pool
      const pool = ethers.parseEther("0.1");
      await expect(pot.connect(bob).claimRefund()).to.changeEtherBalance(
        bob,
        ethers.parseEther("2") + (pool * 2n) / 3n
      );
    });

    it("stops accruing misses once the pot is settled", async () => {
      const { pot, start } = await createStreak({ goal: ethers.parseEther("1") });
      await pot.connect(bob).deposit({ value: ethers.parseEther("1") });
      await pot.release();
      await warpTo(start + 5 * WEEK);
      await pot.assessMisses(bob.address); // no-op after settlement
      expect(await pot.intervalsMissed(bob.address)).to.equal(0);
    });

    it("rejects nonsense streak parameters", async () => {
      const start = (await now()) + HOUR;
      const deadline = start + 12 * WEEK;
      await expect(
        factory.createStreakPot(initParams({}, deadline), [], {
          intervalSeconds: 60, // below the 1 hour floor
          startTime: start,
          missPenaltyBps: 1000,
          totalIntervals: 12,
        })
      ).to.be.revertedWithCustomError(impls.streak, "BadStreakParams");

      await expect(
        factory.createStreakPot(initParams({}, deadline), [], {
          intervalSeconds: WEEK,
          startTime: start,
          missPenaltyBps: 1000,
          totalIntervals: 53, // above the cap
        })
      ).to.be.revertedWithCustomError(impls.streak, "BadStreakParams");
    });
  });

  // ------------------------------------------------------------------ charity
  describe("charity pot", () => {
    async function createCharity(overrides = {}) {
      const deadline = overrides.deadline ?? (await now()) + 30 * DAY;
      const tx = await factory.createCharityPot(
        initParams({ goal: overrides.goal ?? ethers.parseEther("5") }, deadline),
        [],
        {
          charityName: overrides.charityName ?? "Clean Water Fund",
          registrationHash: overrides.registrationHash ?? "QmRegistrationDocHash",
        }
      );
      await tx.wait();
      const addr = await factory.pots((await factory.potCount()) - 1n);
      return { pot: await ethers.getContractAt("CharityPot", addr), addr, deadline };
    }

    it("stores the charity identity and is always auto-refund", async () => {
      const { pot } = await createCharity();
      expect(await pot.potType()).to.equal(2);
      expect(await pot.charityName()).to.equal("Clean Water Fund");
      expect(await pot.registrationHash()).to.equal("QmRegistrationDocHash");
      expect(await pot.autoRefundOnMiss()).to.equal(true);
    });

    it("emits CharityReleased on top of the standard release", async () => {
      const { pot, addr } = await createCharity();
      await pot.connect(bob).deposit({ value: ethers.parseEther("5") });
      await expect(pot.release())
        .to.emit(pot, "CharityReleased")
        .withArgs(addr, ethers.parseEther("5"), "Clean Water Fund")
        .and.to.emit(pot, "Released");
    });

    it("records donors and attaches public messages", async () => {
      const { pot } = await createCharity();
      await expect(
        pot.connect(bob).donateWithMessage("for the kids", { value: ethers.parseEther("1") })
      )
        .to.emit(pot, "DonationMessage")
        .withArgs(bob.address, ethers.parseEther("1"), "for the kids");

      expect(await pot.hasDonated(bob.address)).to.equal(true);
      expect(await pot.donorCount()).to.equal(1);
      expect(await pot.depositOf(bob.address)).to.equal(ethers.parseEther("1"));

      await expect(
        pot.connect(carol).donateWithMessage("x".repeat(141), { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(pot, "MessageTooLong");
    });

    it("refunds every donor when the goal is missed", async () => {
      const { pot, deadline } = await createCharity();
      await pot.connect(bob).donateWithMessage("", { value: ethers.parseEther("1") });
      await pot.connect(carol).deposit({ value: ethers.parseEther("2") });
      await warpTo(deadline + 1);
      await expect(pot.connect(bob).claimRefund()).to.changeEtherBalance(
        bob,
        ethers.parseEther("1")
      );
      await expect(pot.connect(carol).claimRefund()).to.changeEtherBalance(
        carol,
        ethers.parseEther("2")
      );
    });

    it("cannot release below the goal (no partial release)", async () => {
      const { pot } = await createCharity();
      await pot.connect(bob).deposit({ value: ethers.parseEther("4.99") });
      await expect(pot.release()).to.be.revertedWithCustomError(pot, "GoalNotReached");
    });

    it("rejects an empty charity name", async () => {
      await expect(
        factory.createCharityPot(initParams({}, (await now()) + DAY), [], {
          charityName: "",
          registrationHash: "",
        })
      ).to.be.revertedWithCustomError(impls.charity, "BadCharityParams");
    });
  });

  // ------------------------------------------------------------------ safety
  describe("settlement safety", () => {
    it("a beneficiary that cannot receive value cannot freeze the pot", async () => {
      const hostile = await (await ethers.getContractFactory("StandardPot")).deploy();
      const { pot } = await createStandard({ beneficiary: await hostile.getAddress() });
      await pot.connect(bob).deposit({ value: GOAL });
      await pot.release(); // settles regardless
      expect(await pot.state()).to.equal(1);
      expect(await pot.claimable(await hostile.getAddress())).to.be.gt(0);
    });

    it("keeps pots financially isolated from each other", async () => {
      const a = await createStandard({ goal: ethers.parseEther("1") });
      const b = await createStandard({ goal: ethers.parseEther("1") });
      await a.pot.connect(bob).deposit({ value: ethers.parseEther("1") });
      await b.pot.connect(carol).deposit({ value: ethers.parseEther("1") });
      await a.pot.release();
      // b is untouched by a's settlement
      expect(await b.pot.state()).to.equal(0);
      expect(await ethers.provider.getBalance(b.addr)).to.equal(ethers.parseEther("1"));
    });
  });
});
