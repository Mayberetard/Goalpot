require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// Use the solc compiler bundled in node_modules instead of downloading it,
// so builds work in offline/egress-restricted environments.
const { subtask } = require("hardhat/config");
const {
  TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD,
} = require("hardhat/builtin-tasks/task-names");

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion === "0.8.24") {
    return {
      compilerPath: require.resolve("solc/soljson.js"),
      isSolcJs: true,
      version: "0.8.24",
      longVersion: "0.8.24+commit.e11b9ed9",
    };
  }
  return runSuper(args);
});

const { PRIVATE_KEY, MONAD_RPC_URL } = process.env;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    sources: "./src",
  },
  networks: {
    hardhat: {
      // Mirror Monad testnet's chain id so the web app can point at a local
      // node during development without a separate chain config.
      chainId: 10143,
    },
    monadTestnet: {
      url: MONAD_RPC_URL || "https://testnet-rpc.monad.xyz",
      chainId: 10143,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    monadMainnet: {
      url: "https://rpc.monad.xyz",
      chainId: 143,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
  sourcify: {
    enabled: true,
    apiUrl: "https://sourcify-api-monad.blockvision.org",
    browserUrl: "https://testnet.monadexplorer.com",
  },
  etherscan: { enabled: false },
};
