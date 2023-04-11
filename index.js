const { ethers } = require("ethers");
const { Signale } = require("signale");
const signale = require("signale");
const prompts = require("prompts");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
var ProgressBar = require("progress");
const readline = require("readline");

var bar = new ProgressBar("  [:bar]", 10);

const {
  API_KEY,
  USDC_ADDRESS,
  WETH_ADDRESS,
  UNISWAP_ROUTER_ABI,
  ERC20_ABI,
} = require("./constants");

const configPath = path.join(__dirname, "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

dotenv.config();

const provider = new ethers.providers.JsonRpcProvider(
  "https://mainnet.era.zksync.io"
);
// const provider = new ethers.providers.AlchemyProvider("goerli", API_KEY);
const wallet = new ethers.Wallet(config.PRIVATE_KEY, provider);

const uniswapRouterAddress = "0x8B791913eB07C32779a16750e3868aA8495F5964"; // router address
const uniswapRouter = new ethers.Contract(
  uniswapRouterAddress,
  UNISWAP_ROUTER_ABI,
  wallet
);

const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, wallet);

async function simulateSwape() {
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now
  const gasPrice = await provider.getGasPrice();

  const gasUnits =
    await uniswapRouter.estimateGas.swapExactETHForTokensSupportingFeeOnTransferTokens(
      0, // allow any amountOut
      [WETH_ADDRESS, USDC_ADDRESS],
      wallet.address,
      deadline,
      [false, false],
      { value: ethers.utils.parseEther((0.0001).toString()) }
    );

  const transactionFee = gasPrice.mul(gasUnits);
  const formatedFees = ethers.utils
    .formatUnits(transactionFee, "ether")
    .substring(0, 8);

  console.log("Transaction fees for a swap is", formatedFees + " ETH");

  return formatedFees;
}

async function swapETHForUSDC(amountETH) {
  const amountIn = ethers.utils.parseEther(amountETH.toString());
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now

  const interactiveETHUSDC = new Signale({
    interactive: true,
    scope: "eth ➜ usdc",
  });

  interactiveETHUSDC.await(`[%d/2] - Swaping ${amountETH} ETH for USDC...`, 1);

  const swapTx =
    await uniswapRouter.swapExactETHForTokensSupportingFeeOnTransferTokens(
      0, // allow any amountOut
      [WETH_ADDRESS, USDC_ADDRESS],
      wallet.address,
      deadline,
      [false, false],
      { value: amountIn }
    );

  const receipt = await swapTx.wait();

  interactiveETHUSDC.success(
    `[%d/2] - Swapped ${amountETH} ETH for USDC (tx: ${receipt.transactionHash})`,
    2
  );

  console.log();
}

async function swapUSDCForETH(amountUSDC, maxAmount) {
  const amountIn = ethers.utils.parseUnits(amountUSDC.toString(), 6); // USDC units
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now
  const maxAllowance = ethers.utils.parseEther(maxAmount.toString(), 6); // take max allowance from max value in config

  const interactiveUSDCETH = new Signale({
    interactive: true,
    scope: "usdc ➜ eth",
  });

  // check if router is already approved to spend the USDC amount
  const allowance = await usdcContract.allowance(
    wallet.address,
    uniswapRouterAddress
  );

  interactiveUSDCETH.await(
    `[%d/4] - Check if router is already approved to spend the usdc amount...`,
    1
  );

  await new Promise((resolve) => setTimeout(resolve, 1000));

  if (maxAllowance > allowance) {
    interactiveUSDCETH.await(`[%d/4] - Approving...`, 2);
    // Approve Uniswap to spend USDC
    const approveTx = await usdcContract.approve(
      uniswapRouterAddress,
      maxAllowance
    );
    await approveTx.wait();
  } else {
    interactiveUSDCETH.success(`[%d/4] - Router already approved!...`, 2);
  }

  await new Promise((resolve) => setTimeout(resolve, 300));

  interactiveUSDCETH.await(`[%d/4] - Swaping ${amountUSDC} USDC for ETH...`, 3);

  // Swap USDC for ETH
  const swapTx =
    await uniswapRouter.swapExactTokensForETHSupportingFeeOnTransferTokens(
      amountIn,
      0, // allow any amountOut
      [USDC_ADDRESS, WETH_ADDRESS],
      wallet.address,
      deadline,
      [false, false]
    );
  const receipt = await swapTx.wait();

  interactiveUSDCETH.success(
    `[%d/4] - Swapped ${amountUSDC} USDC for ETH (tx: ${receipt.transactionHash})`,
    4
  );

  const balanceRemaining = await wallet.getBalance();
  signale.debug(
    "Remaining balance",
    ethers.utils.formatUnits(balanceRemaining, "ether").substring(0, 5) + " ETH"
  );
}

async function trade(minAmount, maxAmount) {
  const fees = await simulateSwape();

  if (fees > config.MAX_FEE_PER_SWAP) {
    signale.fatal(`Fees are too high (${fees}), aborting...`);
    return;
  }

  const randomAmountETH = getRandomValue(minAmount, maxAmount);
  await swapETHForUSDC(randomAmountETH);

  // wait for the previous transaction to complete
  const usdcBalance = await usdcContract.balanceOf(wallet.address);
  await swapUSDCForETH(ethers.utils.formatUnits(usdcBalance, 6), maxAmount);
}

function getRandomValue(min, max) {
  return Math.random() * (max - min) + min;
}

function getRandomMilliseconds(minutes) {
  const min = minutes * 0.9 * 60 * 1000; // 10% less than input in milliseconds
  const max = minutes * 1.1 * 60 * 1000; // 10% more than input in milliseconds
  return Math.random() * (max - min) + min;
}

function scheduleTrade(params) {
  const { minAmount, maxAmount, frequency } = params;

  const randomDelay = getRandomMilliseconds(frequency);

  var i = Math.floor((randomDelay / 60000) * 60);

  const interactiveCountdown = new Signale({
    interactive: true,
    scope: "countdown",
  });

  var countdownTimer = setInterval(function () {
    interactiveCountdown.await(`Next trade in ${i} seconds...`);
    i = i - 1;

    if (i <= 0) {
      clearInterval(countdownTimer);
    }
  }, 1000);

  setTimeout(async () => {
    try {
      await trade(minAmount, maxAmount);
    } catch (error) {
      console.error("Error executing trade:", error);
    }
    scheduleTrade(params);
  }, randomDelay);
}

function waitForUserInput() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question("Press ENTER to exit...", () => {
      rl.close();
      resolve();
    });
  });
}

const actions = [
  {
    type: "select",
    name: "value",
    message: "Choose what you want to do",
    choices: [
      {
        title: "Simulate",
        description:
          "Simulate swaps without executing them to get an idea of the gas costs",
        value: 0,
      },
      { title: "Make some volume!", value: 1 },
    ],
    initial: 1,
  },
];

const questions = [
  {
    type: "number",
    float: true,
    min: 0,
    name: "minAmount",
    message: "Min amount to swap (ETH)",
  },
  {
    type: "number",
    float: true,
    max: 1,
    name: "maxAmount",
    message: "Max amount to swap (ETH)",
  },
  {
    type: "number",
    name: "frequency",
    min: 1,
    max: 60,
    message: "How often to swap (minutes)",
  },
];

(async () => {
  const action = await prompts(actions);

  if (action.value === 0) {
    console.log("Simulation...");
    await simulateSwape();
    // wait for user input before closing the console
    await waitForUserInput();
  } else {
    const response = await prompts(questions);

    const confirmation = [
      {
        type: "confirm",
        name: "value",
        message: "Can you confirm?",
        initial: true,
      },
    ];

    const confirmationResponse = await prompts(confirmation);

    if (!confirmationResponse.value) {
      console.log("Aborted");
      return;
    }

    scheduleTrade(response);
  }
})();
