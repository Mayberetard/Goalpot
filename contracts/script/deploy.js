const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account. Set PRIVATE_KEY in contracts/.env");
  }
  console.log(`Network:  ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} MON`);

  const pot = await (await ethers.getContractFactory("GoalPot")).deploy();
  await pot.waitForDeployment();

  const address = await pot.getAddress();
  console.log(`\nGoalPot deployed at: ${address}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Verify:  npx hardhat verify --network ${network.name} ${address}`);
  console.log(`  2. Point the web app at it: set VITE_GOALPOT_ADDRESS=${address} in web/.env`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
