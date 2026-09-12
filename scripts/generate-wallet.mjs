import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

console.log("address:     ", account.address);
console.log("private key: ", privateKey);
console.log("\nFund this address with Base Sepolia ETH (a faucet, e.g. https://www.alchemy.com/faucets/base-sepolia)");
console.log("then put both values in .env as SELLER_ADDRESS / SELLER_PRIVATE_KEY (or BUYER_*).");
