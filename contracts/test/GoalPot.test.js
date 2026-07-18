const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const DAY = 24 * 60 * 60;

async function now() {
  const b = await ethers.provider.getBlock("latest");
  return b.timestamp;
}

async function warpTo(ts) {
  await network.provider.send("evm_setNextBlockTimestamp", [ts]);
  await network.provider.send("evm_mine");
}

describe("GoalPot", () => {
  let pot, alice, bob, carol, dave, beneficiary;

  const GOAL = ethers.parseEther("10");
  const MIN_DEPOSIT = ethers.parseEther("0.1");
  const PENALTY_BPS = 500; // 5%
  const VOTING_PERIOD = 3 * DAY;

  async function createDefaultPot(overrides = {}) {
    const deadline = overrides.deadline ?? (await now()) + 30 * DAY;
    const tx = await pot
      .connect(alice)
      .createPot(
        overrides.name ?? "Lisbon Trip Fund",
        overrides.beneficiary ?? beneficiary.address,
        overrides.goal ?? GOAL,
        deadline,
        overrides.penaltyBps ?? PENALTY_BPS,
        overrides.minDeposit ?? MIN_DEPOSIT,
        overrides.votingPeriod ?? VOTING_PERIOD,
        overrides.openJoin ?? true,
        overrides.invitees ?? []
      );
    await tx.wait();
    return { potId: (await pot.potCount()) - 1n, deadline };
  }

  beforeEach(async () => {
    [alice, bob, carol, dave, beneficiary] = await ethers.getSigners();
    pot = await (await ethers.getContractFactory("GoalPot")).deploy();
  });

  describe("createPot", () => {
    it("creates a pot with the given parameters", async () => {
      const { potId } = await createDefaultPot();
      const p = await pot.getPot(potId);
      expect(p.name).to.equal("Lisbon Trip Fund");
      expect(p.goal).to.equal(GOAL);
      expect(p.penaltyBps).to.equal(PENALTY_BPS);
      expect(p.state).to.equal(0); // Active
      expect(p.memberCount).to.equal(0);
    });

    it("rejects bad parameters", async () => {
      const deadline = (await now()) + DAY;
      const good = ["Pot", beneficiary.address, GOAL, deadline, 500, MIN_DEPOSIT, VOTING_PERIOD, true, []];
      const cases = [
        ["", ...good.slice(1)], // empty name
        ["x".repeat(65), ...good.slice(1)], // name too long
        [good[0], ethers.ZeroAddress, ...good.slice(2)], // zero beneficiary
        [good[0], good[1], 0, ...good.slice(3)], // zero goal
        [...good.slice(0, 3), (await now()) - 1, ...good.slice(4)], // past deadline
        [...good.slice(0, 4), 2001, ...good.slice(5)], // penalty > 20%
        [...good.slice(0, 6), 60, ...good.slice(7)], // voting period too short
      ];
      for (const args of cases) {
        await expect(pot.createPot(...args)).to.be.revertedWithCustomError(pot, "BadParams");
      }
    });
  });

  describe("invite-only pots", () => {
    it("blocks uninvited depositors and admits invited ones", async () => {
      const { potId } = await createDefaultPot({
        openJoin: false,
        invitees: [], // seeded empty; creator invites later
      });
      await expect(
        pot.connect(bob).deposit(potId, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(pot, "NotInvited");

      await pot.connect(alice).inviteMembers(potId, [bob.address]);
      await pot.connect(bob).deposit(potId, { value: ethers.parseEther("1") });
      expect(await pot.depositOf(potId, bob.address)).to.equal(ethers.parseEther("1"));
    });

    it("seeds invitees at creation and always allows the creator", async () => {
      const { potId } = await createDefaultPot({
        openJoin: false,
        invitees: [carol.address],
      });
      await pot.connect(carol).deposit(potId, { value: ethers.parseEther("1") });
      await pot.connect(alice).deposit(potId, { value: ethers.parseEther("1") }); // creator
      expect(await pot.invitedOf(potId, carol.address)).to.equal(true);
    });

    it("only the creator can invite, and not on open pots", async () => {
      const { potId } = await createDefaultPot({ openJoin: false });
      await expect(
        pot.connect(bob).inviteMembers(potId, [bob.address])
      ).to.be.revertedWithCustomError(pot, "NotCreator");

      const { potId: openId } = await createDefaultPot();
      await expect(
        pot.connect(alice).inviteMembers(openId, [bob.address])
      ).to.be.revertedWithCustomError(pot, "BadParams");
    });
  });

  describe("deposit", () => {
    it("tracks deposits, members, and totals", async () => {
      const { potId } = await createDefaultPot();
      await pot.connect(bob).deposit(potId, { value: ethers.parseEther("2") });
      await pot.connect(carol).deposit(potId, { value: ethers.parseEther("3") });
      await pot.connect(bob).deposit(potId, { value: ethers.parseEther("1") });

      expect(await pot.depositOf(potId, bob.address)).to.equal(ethers.parseEther("3"));
      const p = await pot.getPot(potId);
      expect(p.totalDeposited).to.equal(ethers.parseEther("6"));
      expect(p.memberCount).to.equal(2);

      const [addrs, amounts, total] = await pot.getMembers(potId, 0, 10);
      expect(total).to.equal(2);
      expect(addrs).to.deep.equal([bob.address, carol.address]);
      expect(amounts[0]).to.equal(ethers.parseEther("3"));
    });

    it("enforces the minimum first deposit but allows small top-ups", async () => {
      const { potId } = await createDefaultPot();
      await expect(
        pot.connect(bob).deposit(potId, { value: ethers.parseEther("0.01") })
      ).to.be.revertedWithCustomError(pot, "BelowMinDeposit");
      await pot.connect(bob).deposit(potId, { value: MIN_DEPOSIT });
      await pot.connect(bob).deposit(potId, { value: 1n }); // top-up below min is fine
    });

    it("rejects deposits after the deadline", async () => {
      const { potId, deadline } = await createDefaultPot();
      await warpTo(deadline + 1);
      await expect(
        pot.connect(bob).deposit(potId, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(pot, "DeadlinePassed");
    });

    it("rejects direct transfers to the contract", async () => {
      await expect(
        bob.sendTransaction({ to: await pot.getAddress(), value: 1n })
      ).to.be.reverted;
    });
  });

  describe("release (goal reached)", () => {
    it("sends the whole pot to the beneficiary once the goal is met", async () => {
      const { potId } = await createDefaultPot();
      await pot.connect(bob).deposit(potId, { value: ethers.parseEther("6") });
      await pot.connect(carol).deposit(potId, { value: ethers.parseEther("4") });

      const before = await ethers.provider.getBalance(beneficiary.address);
      await expect(pot.connect(dave).release(potId)) // anyone can trigger
        .to.emit(pot, "Released")
        .withArgs(potId, beneficiary.address, GOAL);
      const after = await ethers.provider.getBalance(beneficiary.address);
      expect(after - before).to.equal(GOAL);
      expect((await pot.getPot(potId)).state).to.equal(1); // Released
    });

    it("reverts if the goal is not reached", async () => {
      const { potId } = await createDefaultPot();
      await pot.connect(bob).deposit(potId, { value: ethers.parseEther("1") });
      await expect(pot.release(potId)).to.be.revertedWithCustomError(pot, "GoalNotReached");
    });
  });

  describe("refunds (deadline missed)", () => {
    it("lets every member pull back exactly what they put in", async () => {
      const { potId, deadline } = await createDefaultPot();
      await pot.connect(bob).deposit(potId, { value: ethers.parseEther("2") });
      await pot.connect(carol).deposit(potId, { value: ethers.parseEther("3") });
      await warpTo(deadline + 1);

      await expect(pot.connect(bob).claimRefund(potId)).to.changeEtherBalance(
        bob,
        ethers.parseEther("2")
      );
      await expect(pot.connect(carol).claimRefund(potId)).to.changeEtherBalance(
        carol,
        ethers.parseEther("3")
      );
      await expect(pot.connect(bob).claimRefund(potId)).to.be.revertedWithCustomError(
        pot,
        "NothingToClaim"
      );
    });

    it("cannot start refunds before the deadline or if the goal was reached", async () => {
      const { potId, deadline } = await createDefaultPot();
      await pot.connect(bob).deposit(potId, { value: GOAL });
      await expect(pot.startRefunds(potId)).to.be.revertedWithCustomError(
        pot,
        "DeadlineNotPassed"
      );
      await warpTo(deadline + 1);
      await expect(pot.startRefunds(potId)).to.be.revertedWithCustomError(
        pot,
        "GoalAlreadyReached"
      );
    });

    it("splits retained penalties pro-rata among remaining members", async () => {
      const { potId, deadline } = await createDefaultPot();
      await pot.connect(bob).deposit(potId, { value: ethers.parseEther("4") });
      await pot.connect(carol).deposit(potId, { value: ethers.parseEther("4") });
      await pot.connect(dave).deposit(potId, { value: ethers.parseEther("1") });

      // dave exits early with a 5% penalty -> 0.05 stays in the pot
      await pot.connect(dave).requestExit(potId);
      await pot.connect(bob).voteOnExit(potId, true);
      await pot.connect(carol).voteOnExit(potId, true);
      await pot.connect(dave).executeExit(potId);

      await warpTo(deadline + 1);
      const penalty = ethers.parseEther("0.05");
      await expect(pot.connect(bob).claimRefund(potId)).to.changeEtherBalance(
        bob,
        ethers.parseEther("4") + penalty / 2n
      );
      await expect(pot.connect(carol).claimRefund(potId)).to.changeEtherBalance(
        carol,
        ethers.parseEther("4") + penalty / 2n
      );
    });
  });

  describe("early exit voting", () => {
    async function fundedPot() {
      const created = await createDefaultPot();
      await pot.connect(bob).deposit(created.potId, { value: ethers.parseEther("2") });
      await pot.connect(carol).deposit(created.potId, { value: ethers.parseEther("3") });
      await pot.connect(dave).deposit(created.potId, { value: ethers.parseEther("1") });
      return created;
    }

    it("pays out with penalty after a weighted majority approves", async () => {
      const { potId } = await fundedPot();
      await pot.connect(dave).requestExit(potId);
      // eligible weight = 5 ETH (bob 2 + carol 3); carol alone = 3 > 2.5
      await pot.connect(carol).voteOnExit(potId, true);

      await expect(pot.connect(dave).executeExit(potId)).to.changeEtherBalance(
        dave,
        ethers.parseEther("0.95")
      );
      const p = await pot.getPot(potId);
      expect(p.penaltyPool).to.equal(ethers.parseEther("0.05"));
      expect(p.totalDeposited).to.equal(ethers.parseEther("5"));
      expect(p.memberCount).to.equal(2);
      expect(await pot.depositOf(potId, dave.address)).to.equal(0);
    });

    it("does not pass without a majority of eligible weight", async () => {
      const { potId } = await fundedPot();
      await pot.connect(dave).requestExit(potId);
      await pot.connect(bob).voteOnExit(potId, true); // 2 of 5 eligible
      await expect(pot.connect(dave).executeExit(potId)).to.be.revertedWithCustomError(
        pot,
        "VoteNotPassed"
      );
    });

    it("blocks self-votes, double votes, non-members, and late votes", async () => {
      const { potId } = await fundedPot();
      await pot.connect(dave).requestExit(potId);
      await expect(pot.connect(dave).voteOnExit(potId, true)).to.be.revertedWithCustomError(
        pot,
        "SelfVote"
      );
      await pot.connect(bob).voteOnExit(potId, true);
      await expect(pot.connect(bob).voteOnExit(potId, true)).to.be.revertedWithCustomError(
        pot,
        "AlreadyVoted"
      );
      await expect(pot.connect(alice).voteOnExit(potId, true)).to.be.revertedWithCustomError(
        pot,
        "NotMember"
      );
      await warpTo((await now()) + VOTING_PERIOD + 1);
      await expect(pot.connect(carol).voteOnExit(potId, true)).to.be.revertedWithCustomError(
        pot,
        "VoteClosed"
      );
    });

    it("only one live request per pot; expired failed requests can be displaced", async () => {
      const { potId } = await fundedPot();
      await pot.connect(dave).requestExit(potId);
      await expect(pot.connect(bob).requestExit(potId)).to.be.revertedWithCustomError(
        pot,
        "ExitAlreadyPending"
      );
      await warpTo((await now()) + VOTING_PERIOD + 1);
      await pot.connect(bob).requestExit(potId); // displaces the expired one
      const r = await pot.exitRequestOf(potId);
      expect(r.requester).to.equal(bob.address);
    });

    it("keeps working toward the goal: penalties count as pot balance", async () => {
      const { potId } = await fundedPot();
      await pot.connect(dave).requestExit(potId);
      await pot.connect(carol).voteOnExit(potId, true);
      await pot.connect(dave).executeExit(potId);
      // 5 deposited + 0.05 penalty
      expect(await pot.potBalance(potId)).to.equal(ethers.parseEther("5.05"));
    });
  });
});
