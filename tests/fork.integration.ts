import deployedRegistry from "../src/config/artifacts/mainnet-UserRegistryImpl.abi.json";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  namehash,
  zeroAddress,
  type Address,
  type Abi,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { getDeployment } from "../src/config/deployments";
import { registryAbi } from "../src/config/abis";
import {
  buildSetupSteps,
  buildDirectRegisterStep,
  buildRegistrarRegisterSteps,
  buildSetAddrStep,
  buildSwitchResolverSteps,
  buildRevokeRegistryRolesStep,
  buildLockParentLinkStep,
  type StepCtx,
  type StepDef,
} from "../src/lib/steps";
import { recoverPending } from "../src/lib/recovery";
import { executeSequence } from "../src/lib/sequence";
import { ALL_ROLES, ROLE_REGISTRAR, ROLE_RENEW } from "../src/lib/roles";
import { MAX_EXPIRY, SUBNAME_OWNER_BITMAP } from "../src/lib/presets";
import { labelhashId } from "../src/lib/names";
import type { StepState } from "../src/state/labSession";

// Every transaction is sent only to our local Anvil fork, never the source RPC.
const account = privateKeyToAccount(generatePrivateKey());
for (const chainId of [1, 11155111])
  describe(`deployed ENSv2 fork ${chainId}`, () => {
    const network = getDeployment(chainId);
    const port = chainId === 1 ? 18545 : 18546;
    const url = `http://127.0.0.1:${port}`;
    const client = createPublicClient({
      chain: network.chain,
      transport: http(url, { retryCount: 0, timeout: 60_000 }),
    });
    const wallet = createWalletClient({
      chain: network.chain,
      account,
      transport: http(url, { retryCount: 0, timeout: 60_000 }),
    });
    let process: ChildProcess;
    let ctx: StepCtx;
    const label = "subregistry-lab-fork-only";
    const rpc = async (method: string, params: unknown[]) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const result = (await response.json()) as {
        error?: unknown;
        result?: unknown;
      };
      if (result.error) throw new Error(JSON.stringify(result.error));
      return result.result;
    };
    const run = async (
      plan: StepDef[],
      input = ctx,
      states: Record<string, StepState> = {},
      interrupt = false,
    ) => {
      return executeSequence(plan, input, {
        assertIdentity: async () => {
          expect(await client.getChainId()).toBe(chainId);
        },
        read: (p) => client.readContract({ ...p, args: p.args as unknown[] }),
        getState: (id) => states[id],
        setState: (id, value) => {
          states[id] = value;
        },
        patch: () => {},
        send: async (action) => {
          if (action.type === "deploy")
            return wallet.deployContract({
              abi: action.abi,
              bytecode: action.bytecode,
              args: action.args as unknown[],
            });
          const { request } = await client.simulateContract({
            account,
            address: action.address,
            abi: action.abi,
            functionName: action.functionName,
            args: action.args as unknown[],
          });
          return wallet.writeContract(request);
        },
        receipt: (hash) => {
          if (interrupt) throw new Error("Simulated refresh after submission");
          return client.waitForTransactionReceipt({ hash });
        },
      });
    };
    const impersonatedWrite = async (
      sender: Address,
      target: Address,
      abi: Abi,
      functionName: string,
      args: readonly unknown[],
    ) => {
      await rpc("anvil_impersonateAccount", [sender]);
      await rpc("anvil_setBalance", [sender, "0x56bc75e2d63100000"]);
      try {
        const w = createWalletClient({
          chain: network.chain,
          account: sender,
          transport: http(url, { retryCount: 0, timeout: 60_000 }),
        });
        await client.simulateContract({
          account: sender,
          address: target,
          abi: [
            ...abi,
            ...deployedRegistry.filter((item) => item.type === "error"),
          ] as Abi,
          functionName,
          args,
          gas: 5_000_000n,
        });
        const hash = await w.writeContract({
          address: target,
          abi,
          functionName,
          args,
          gas: 5_000_000n,
        });
        const receipt = await client.waitForTransactionReceipt({ hash });
        expect(receipt.status).toBe("success");
      } finally {
        await rpc("anvil_stopImpersonatingAccount", [sender]);
      }
    };
    beforeAll(async () => {
      const upstream =
        (chainId === 1
          ? processEnv("ENS_FORK_RPC_MAINNET")
          : processEnv("ENS_FORK_RPC_SEPOLIA")) ??
        (chainId === 1
          ? "https://ethereum-rpc.publicnode.com"
          : "https://ethereum-sepolia-rpc.publicnode.com");
      const upstreamClient = createPublicClient({
        transport: http(upstream, { timeout: 20_000, retryCount: 1 }),
      });
      const finalized = await upstreamClient.getBlock({
        blockTag: "finalized",
      });
      process = spawn(
        "anvil",
        [
          "--fork-url",
          upstream,
          "--fork-block-number",
          String(finalized.number),
          "--port",
          String(port),
          "--chain-id",
          String(chainId),
          "--accounts",
          "0",
          "--silent",
          "--no-rate-limit",
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let logs = "";
      process.stderr?.on("data", (data) => {
        logs += data;
      });
      const deadline = Date.now() + 90_000;
      while (true) {
        try {
          await client.getBlockNumber();
          break;
        } catch {
          if (process.exitCode !== null || Date.now() > deadline)
            throw new Error(`Anvil startup failed: ${logs}`);
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      console.log(network.chain.name, "fork started");
      await rpc("anvil_setBalance", [account.address, "0x56bc75e2d63100000"]);
      await impersonatedWrite(
        network.addresses.ETHRegistrar,
        network.addresses.ETHRegistry,
        registryAbi,
        "register",
        [
          label,
          account.address,
          zeroAddress,
          zeroAddress,
          SUBNAME_OWNER_BITMAP,
          MAX_EXPIRY,
        ],
      );
      console.log(network.chain.name, "parent registered");
      ctx = {
        chainId,
        account: account.address,
        parentLabel: label,
        ownerInitBitmap: ALL_ROLES,
        deployResolver: true,
        registrarParams: {
          pricePerYear: 5_000_000n,
          minDuration: 86400n,
          beneficiary: account.address,
          grantBitmap: ROLE_REGISTRAR | ROLE_RENEW,
        },
      };
    });
    afterAll(() => {
      process?.kill();
    });
    it("deploys registry, resolver and reproducibly built registrar through the real factory", async () => {
      ctx = await run(buildSetupSteps("standard-rentable", chainId));
      expect(ctx.userRegistry).toBeDefined();
      expect(ctx.resolver).toBeDefined();
      expect(ctx.registrar).toBeDefined();
    });
    it("registers, writes, and resolves through the deployed v2 Universal Resolver", async () => {
      await run(
        buildDirectRegisterStep({
          chainId,
          userRegistry: ctx.userRegistry!,
          label: "alice",
          owner: account.address,
          resolver: ctx.resolver!,
          roleBitmap: SUBNAME_OWNER_BITMAP,
          expiry: MAX_EXPIRY,
        }),
      );
      const name = `alice.${label}.eth`;
      await run(
        buildSetAddrStep({
          resolver: ctx.resolver!,
          fqdn: name,
          node: namehash(name),
          addr: account.address,
        }),
      );
      expect(
        await client.getEnsAddress({
          name,
          universalResolverAddress: network.addresses.UniversalResolverV2,
        }),
      ).toBe(account.address);
    });
    it("charges the configured token and renews an existing paid name", async () => {
      const tokenAbi = parseAbi([
        "function mint(address,uint256)",
        "function masterMinter() view returns(address)",
        "function configureMinter(address,uint256) returns(bool)",
      ]);
      if (chainId === 1) {
        const minter = await client.readContract({
          address: network.addresses.PaymentToken,
          abi: tokenAbi,
          functionName: "masterMinter",
        });
        await impersonatedWrite(
          minter,
          network.addresses.PaymentToken,
          tokenAbi,
          "configureMinter",
          [account.address, 100_000_000n],
        );
      }
      const minted = await wallet.writeContract({
        address: network.addresses.PaymentToken,
        abi: tokenAbi,
        functionName: "mint",
        args: [account.address, 100_000_000n],
      });
      expect(
        (await client.waitForTransactionReceipt({ hash: minted })).status,
      ).toBe("success");
      const params = {
        chainId,
        registrar: ctx.registrar!,
        userRegistry: ctx.userRegistry!,
        label: "bob",
        owner: account.address,
        payer: account.address,
        resolver: ctx.resolver!,
        duration: 365n * 86400n,
        price: 5_000_000n,
        currentAllowance: 0n,
      };
      await run(buildRegistrarRegisterSteps(params));
      const before = await client.readContract({
        address: ctx.userRegistry!,
        abi: registryAbi,
        functionName: "getState",
        args: [labelhashId("bob")],
      });
      await run(
        buildSwitchResolverSteps({
          chainId,
          userRegistry: ctx.userRegistry!,
          parentLabel: label,
          label: "bob",
          owner: account.address,
        }),
      );
      await run(
        buildRegistrarRegisterSteps({
          ...params,
          renewFromExpiry: before.expiry,
        }),
      );
      const after = await client.readContract({
        address: ctx.userRegistry!,
        abi: registryAbi,
        functionName: "getState",
        args: [labelhashId("bob")],
      });
      expect(after.expiry).toBe(before.expiry + params.duration);
    });
    it("switches a subname to a freshly initialized resolver", async () => {
      const result = await run(
        buildSwitchResolverSteps({
          chainId,
          userRegistry: ctx.userRegistry!,
          parentLabel: label,
          label: "alice",
          owner: account.address,
        }),
      );
      expect(result.subResolver).toBeDefined();
    });
    it("recovers a deployment after refresh without deploying a second proxy", async () => {
      const states: Record<string, StepState> = {};
      const isolated = { ...ctx, userRegistry: undefined };
      const plan = buildSetupSteps("fully-controlled", chainId).slice(0, 1);
      await expect(run(plan, isolated, states, true)).rejects.toThrow(
        "Simulated refresh",
      );
      const hash = states["deploy-registry"].txHash;
      const result = await run(plan, isolated, states);
      expect(states["deploy-registry"].txHash).toBe(hash);
      expect(result.userRegistry).toBeDefined();
    });
    it("recovers a wallet cancellation after the original hash disappears", async () => {
      const nonce = await client.getTransactionCount({
        address: account.address,
        blockTag: "latest",
      });
      await rpc("evm_setAutomine", [false]);
      try {
        const original = await wallet.sendTransaction({
          to: account.address,
          value: 0n,
          data: "0x1234",
          nonce,
          gas: 30_000n,
          maxFeePerGas: 100_000_000_000n,
          maxPriorityFeePerGas: 1_000_000_000n,
        });
        const transaction = await client.getTransaction({ hash: original });
        const replacement = await wallet.sendTransaction({
          to: account.address,
          value: 0n,
          nonce,
          gas: 21_000n,
          maxFeePerGas: 200_000_000_000n,
          maxPriorityFeePerGas: 2_000_000_000n,
        });
        await rpc("evm_mine", []);
        const result = await recoverPending(
          {
            status: "mining",
            txHash: original,
            transaction: {
              nonce: transaction.nonce,
              from: transaction.from,
              to: transaction.to,
              input: transaction.input,
            },
          },
          replacement,
          account.address,
          network,
          {
            receipt: async (hash) => {
              try {
                return await client.getTransactionReceipt({ hash });
              } catch {
                return null;
              }
            },
            transaction: async (hash) => {
              const tx = await client.getTransaction({ hash });
              return {
                nonce: tx.nonce,
                from: tx.from,
                to: tx.to,
                input: tx.input,
              };
            },
            minedNonce: (address) =>
              client.getTransactionCount({ address, blockTag: "latest" }),
          },
        );
        expect(result.cancelled).toBe(true);
        expect(result.confirmed).toBe(true);
        expect(result.txHash).toBe(replacement);
      } finally {
        await rpc("evm_setAutomine", [true]);
      }
    });
    it("removes all dangerous root roles and locks the current parent resource", async () => {
      // A lock must not strand another assignee's renewal grant after removing our admin.
      await expect(
        run(
          buildRevokeRegistryRolesStep({
            chainId,
            userRegistry: ctx.userRegistry!,
            account: account.address,
          }),
        ),
      ).rejects.toThrow("Other accounts hold lock permissions");
      expect(
        await client.readContract({
          address: ctx.userRegistry!,
          abi: registryAbi,
          functionName: "hasRootRoles",
          args: [ALL_ROLES, account.address],
        }),
      ).toBe(true);
      const hash = await wallet.writeContract({
        address: ctx.userRegistry!,
        abi: registryAbi,
        functionName: "revokeRootRoles",
        args: [ROLE_REGISTRAR | ROLE_RENEW, ctx.registrar!],
      });
      await client.waitForTransactionReceipt({ hash });
      await run(
        buildRevokeRegistryRolesStep({
          chainId,
          userRegistry: ctx.userRegistry!,
          account: account.address,
        }),
      );
      expect(
        await client.readContract({
          address: ctx.userRegistry!,
          abi: registryAbi,
          functionName: "isEmancipated",
        }),
      ).toBe(true);
      const resource = await client.readContract({
        address: network.addresses.ETHRegistry,
        abi: registryAbi,
        functionName: "getResource",
        args: [labelhashId(label)],
      });
      await run(
        buildLockParentLinkStep({
          chainId,
          parentLabel: label,
          parentResource: resource,
          account: account.address,
        }),
      );
    });
  });
function processEnv(name: string) {
  return globalThis.process.env[name];
}
