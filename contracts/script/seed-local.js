// Deploys the v2 stack to a local hardhat node and seeds one pot of each type
// with realistic state for end-to-end UI work. Dev/demo only.
const { ethers, network } = require("hardhat");

const DAY = 86400;
const HOUR = 3600;
const WEEK = 7 * DAY;

async function now() {
  return (await ethers.provider.getBlock("latest")).timestamp;
}
async function warpTo(ts) {
  await network.provider.send("evm_setNextBlockTimestamp", [ts]);
  await network.provider.send("evm_mine");
}

function params(over, deadline) {
  return {
    name: over.name,
    creator: ethers.ZeroAddress, // factory sets msg.sender
    beneficiary: over.beneficiary,
    goal: over.goal,
    deadline,
    penaltyBps: over.penaltyBps ?? 500,
    minDeposit: over.minDeposit ?? ethers.parseEther("0.05"),
    votingPeriod: over.votingPeriod ?? 3 * DAY,
    openJoin: over.openJoin ?? true,
  };
}

async function main() {
  const [alice, bob, carol, dave, treasury] = await ethers.getSigners();

  const standard = await (await ethers.getContractFactory("StandardPot")).deploy();
  const streak = await (await ethers.getContractFactory("StreakPot")).deploy();
  const charity = await (await ethers.getContractFactory("CharityPot")).deploy();
  const factory = await (
    await ethers.getContractFactory("GoalPotFactory")
  ).deploy(
    await standard.getAddress(),
    await streak.getAddress(),
    await charity.getAddress(),
    treasury.address,
    50 // 0.5%
  );
  await factory.waitForDeployment();
  console.log("GoalPotFactory:", await factory.getAddress());

  const at = async (i, kind) =>
    ethers.getContractAt(kind, await factory.pots(i));

  // 0 — Standard, part funded, live exit vote
  await (
    await factory.createStandardPot(
      params(
        { name: "Lisbon Trip Fund", beneficiary: alice.address, goal: ethers.parseEther("10") },
        (await now()) + 30 * DAY
      ),
      []
    )
  ).wait();
  const trip = await at(0, "StandardPot");
  await (await trip.connect(bob).deposit({ value: ethers.parseEther("2.5") })).wait();
  await (await trip.connect(carol).deposit({ value: ethers.parseEther("3") })).wait();
  await (await trip.connect(dave).deposit({ value: ethers.parseEther("1.25") })).wait();
  await (await trip.connect(dave).requestExit()).wait();
  await (await trip.connect(bob).voteOnExit(1)).wait(); // Yes
  await (await trip.connect(alice).postUpdate("Flights are booked for June — keep it coming!")).wait();

  // 1 — Standard, invite-only, goal already reached
  await (
    await factory.createStandardPot(
      params(
        {
          name: "Studio Rent Pool",
          beneficiary: carol.address,
          goal: ethers.parseEther("4"),
          penaltyBps: 1000,
          openJoin: false,
        },
        (await now()) + 7 * DAY
      ),
      [alice.address, bob.address]
    )
  ).wait();
  const rent = await at(1, "StandardPot");
  await (await rent.connect(alice).deposit({ value: ethers.parseEther("4") })).wait();

  // 2 — Streak, one member on track and one who missed a week
  const start = (await now()) + HOUR;
  await (
    await factory.createStreakPot(
      params(
        {
          name: "Fitness Challenge: 12 Weeks",
          beneficiary: alice.address,
          goal: ethers.parseEther("6"),
          minDeposit: ethers.parseEther("0.25"),
        },
        start + 12 * WEEK
      ),
      [],
      { intervalSeconds: WEEK, startTime: start, missPenaltyBps: 1000, totalIntervals: 12 }
    )
  ).wait();
  const fit = await at(2, "StreakPot");
  await (await fit.connect(bob).deposit({ value: ethers.parseEther("0.5") })).wait();
  await (await fit.connect(carol).deposit({ value: ethers.parseEther("0.5") })).wait();
  await warpTo(start + WEEK - HOUR);
  await (await fit.connect(bob).deposit({ value: ethers.parseEther("0.5") })).wait(); // on time
  await warpTo(start + WEEK + 60);
  await (await fit.assessMisses(carol.address)).wait(); // carol misses week 1

  // 3 — Charity, donations with public messages
  await (
    await factory.createCharityPot(
      params(
        {
          name: "Clean Water — Emergency Appeal",
          beneficiary: dave.address,
          goal: ethers.parseEther("8"),
          penaltyBps: 0,
          minDeposit: ethers.parseEther("0.01"),
        },
        (await now()) + 20 * DAY
      ),
      [],
      { charityName: "Clean Water Fund", registrationHash: "QmExampleRegistrationDoc" }
    )
  ).wait();
  const water = await at(3, "CharityPot");
  await (
    await water.connect(bob).donateWithMessage("For my grandmother's village 💧", {
      value: ethers.parseEther("2"),
    })
  ).wait();
  await (
    await water.connect(carol).donateWithMessage("Matching my employer's gift!", {
      value: ethers.parseEther("1.5") ,
    })
  ).wait();
  await (await water.connect(alice).deposit({ value: ethers.parseEther("0.75") })).wait();

  console.log("\nSeeded 4 pots:");
  console.log("  0 Lisbon Trip Fund            standard  · live exit vote");
  console.log("  1 Studio Rent Pool            standard  · invite-only, goal reached");
  console.log("  2 Fitness Challenge: 12 Weeks streak    · one on track, one missed week");
  console.log("  3 Clean Water Emergency       charity   · donor messages on the wall");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
