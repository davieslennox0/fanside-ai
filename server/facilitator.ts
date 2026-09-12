import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmScheme as ExactEvmFacilitatorScheme } from "@x402/evm/exact/facilitator";
import { x402Facilitator } from "@x402/core/facilitator";
import { x402ResourceServer } from "@x402/core/server";
import { registerExactEvmScheme as registerServerScheme } from "@x402/evm/exact/server";
import type { FacilitatorClient } from "@x402/core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";

const chainId = Number(process.env.BASE_CHAIN_ID ?? 84532);
const chain = chainId === base.id ? base : baseSepolia;
export const NETWORK = `eip155:${chainId}` as const;

const rpcUrl = process.env.BASE_RPC_URL;
const sellerPrivateKey = process.env.SELLER_PRIVATE_KEY as Hex | undefined;

if (!rpcUrl) throw new Error("BASE_RPC_URL is not set");
if (!sellerPrivateKey) throw new Error("SELLER_PRIVATE_KEY is not set");

export const sellerAccount = privateKeyToAccount(sellerPrivateKey);
export const sellerAddress: Address = sellerAccount.address;

const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account: sellerAccount, chain, transport: http(rpcUrl) });

/**
 * Self-hosted facilitator signer: this process itself verifies buyer
 * signatures and broadcasts settlement, using this wallet as the relayer.
 * Mirrors davieslennox0/pitchook's Python x402_seller.py EvmFacilitatorSigner
 * pattern, ported onto viem via @x402/evm's own composition helper instead
 * of hand-rolling web3.py-style read/write/verify methods.
 */
const facilitatorSigner = toFacilitatorEvmSigner({
  address: sellerAddress,
  readContract: (args) => publicClient.readContract(args as never),
  verifyTypedData: (args) => publicClient.verifyTypedData(args as never),
  writeContract: async (args) => {
    const { dataSuffix, ...rest } = args;
    if (dataSuffix) {
      // Builder-code / ERC-8021 attribution suffix — not used by this project.
      throw new Error("dataSuffix is not supported by this facilitator");
    }
    return walletClient.writeContract(rest as never);
  },
  sendTransaction: (args) => walletClient.sendTransaction(args as never),
  waitForTransactionReceipt: async (args) => {
    const receipt = await publicClient.waitForTransactionReceipt(args);
    return { status: receipt.status, logs: receipt.logs };
  },
  getCode: (args) => publicClient.getCode(args),
});

const exactFacilitatorScheme = new ExactEvmFacilitatorScheme(facilitatorSigner);

const facilitator = new x402Facilitator().register(NETWORK, exactFacilitatorScheme);

/**
 * Adapts x402Facilitator (sync getSupported, {kinds,extensions,signers} shape)
 * to the FacilitatorClient interface x402ResourceServer expects (async
 * getSupported returning SupportedResponse) — the whole point of this class
 * is that it never makes an HTTP call, it just calls straight into the
 * facilitator object above running in the same process.
 */
class LocalFacilitatorClient implements FacilitatorClient {
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    return facilitator.verify(payload, requirements);
  }

  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    return facilitator.settle(payload, requirements);
  }

  async getSupported(): Promise<SupportedResponse> {
    const supported = facilitator.getSupported();
    return {
      kinds: supported.kinds,
      signers: supported.signers,
    } as SupportedResponse;
  }
}

export const resourceServer = new x402ResourceServer(new LocalFacilitatorClient());
registerServerScheme(resourceServer, { networks: [NETWORK] });

export const usdcAddress = process.env.USDC_ADDRESS as Address;
if (!usdcAddress) throw new Error("USDC_ADDRESS is not set");
