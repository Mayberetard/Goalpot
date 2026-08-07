const { ethers, network } = require("hardhat");

/**
 * Deploys the v2 stack: one implementation per pot type plus the factory that
 * clones them. Pots themselves are created by users through the factory.
 *
 * Env:
 *   TREASURY  — protocol fee recipient (defaults to the deployer)
 *   FEE_BPS   — protocol fee in basis points, max 200 (defaults to 50 = 0.5%)
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer account. Set PRIVATE_KEY in contracts/.env");

  const treasury = process.env.TREASURY || deployer.address;
  const feeBps = Number(process.env.FEE_BPS ?? 50);

  console.log(`Network:  ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(
    `Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} MON`
  );
  console.log(`Treasury: ${treasury} (fee ${feeBps / 100}%)\n`);

  const standard = await (await ethers.getContractFactory("StandardPot")).deploy();
  await standard.waitForDeployment();
  console.log(`StandardPot impl: ${await standard.getAddress()}`);

  const streak = await (await ethers.getContractFactory("StreakPot")).deploy();
  await streak.waitForDeployment();
  console.log(`StreakPot impl:   ${await streak.getAddress()}`);

  const charity = await (await ethers.getContractFactory("CharityPot")).deploy();
  await charity.waitForDeployment();
  console.log(`CharityPot impl:  ${await charity.getAddress()}`);

  const factory = await (
    await ethers.getContractFactory("GoalPotFactory")
  ).deploy(
    await standard.getAddress(),
    await streak.getAddress(),
    await charity.getAddress(),
    treasury,
    feeBps
  );
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();

  console.log(`\nGoalPotFactory:   ${factoryAddress}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Verify each contract:`);
  console.log(`       npx hardhat verify --network ${network.name} ${await standard.getAddress()}`);
  console.log(`       npx hardhat verify --network ${network.name} ${await streak.getAddress()}`);
  console.log(`       npx hardhat verify --network ${network.name} ${await charity.getAddress()}`);
  console.log(
    `       npx hardhat verify --network ${network.name} ${factoryAddress} ${await standard.getAddress()} ${await streak.getAddress()} ${await charity.getAddress()} ${treasury} ${feeBps}`
  );
  console.log(`  2. Point the web app at the factory:`);
  console.log(`       VITE_FACTORY_ADDRESS=${factoryAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
