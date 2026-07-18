// Deploys GoalPot to a local hardhat node and seeds demo state:
// two pots, several deposits, and a live exit-vote. Dev/demo only.
const { ethers } = require("hardhat");

async function main() {
  const [alice, bob, carol, dave] = await ethers.getSigners();
  const pot = await (await ethers.getContractFactory("GoalPot")).deploy();
  await pot.waitForDeployment();
  console.log("GoalPot:", await pot.getAddress());

  const now = Math.floor(Date.now() / 1000);
  const DAY = 86400;

  await (
    await pot.createPot(
      "Lisbon Trip Fund",
      alice.address,
      ethers.parseEther("10"),
      now + 30 * DAY,
      500,
      ethers.parseEther("0.1"),
      3 * DAY
    )
  ).wait();
  await (await pot.connect(bob).deposit(0, { value: ethers.parseEther("2.5") })).wait();
  await (await pot.connect(carol).deposit(0, { value: ethers.parseEther("3") })).wait();
  await (await pot.connect(dave).deposit(0, { value: ethers.parseEther("1.25") })).wait();
  await (await pot.connect(dave).requestExit(0)).wait();
  await (await pot.connect(bob).voteOnExit(0, true)).wait();

  await (
    await pot.createPot(
      "Studio Rent Pool",
      carol.address,
      ethers.parseEther("4"),
      now + 7 * DAY,
      1000,
      ethers.parseEther("0.05"),
      1 * DAY
    )
  ).wait();
  await (await pot.connect(alice).deposit(1, { value: ethers.parseEther("4") })).wait();

  console.log("Seeded 2 pots (pot 0 has a live exit vote; pot 1 has hit its goal).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
