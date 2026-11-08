import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { decodeFunctionData, type Address } from "viem";
import type { StepState } from "../state/labSession";
import { verifiableFactoryAbi } from "../config/abis";
import { getDeployment } from "../config/deployments";
import { deriveSalt } from "../lib/salt";
import { willSendNewRequest } from "../lib/inspect";
import type { StepCtx } from "../lib/steps";

/** Predictions are review data, never evidence that a contract was deployed. */
export function useSetupPrediction(
  ctx?: StepCtx,
  steps: Record<string, StepState> = {},
) {
  const client = usePublicClient({ chainId: ctx?.chainId });
  return useQuery({
    queryKey: [
      "setup-prediction",
      ctx?.chainId,
      ctx?.account,
      ctx?.parentLabel,
      ctx?.setupNonce,
      steps["deploy-registry"]?.transaction?.input,
      steps["deploy-resolver"]?.transaction?.input,
      willSendNewRequest(steps["deploy-registry"]),
      willSendNewRequest(steps["deploy-resolver"]),
    ],
    enabled: Boolean(client && ctx?.setupNonce),
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<{
      userRegistry?: Address;
      resolver?: Address;
    }> => {
      if (!ctx?.setupNonce || !client) throw new Error("Setup not prepared");
      const address = getDeployment(ctx.chainId).addresses.VerifiableFactory;
      const predict = (label: string, id: string) => {
        const prior = steps[id];
        if (prior?.txHash && !prior.transaction && !willSendNewRequest(prior))
          return undefined;
        const saved =
          prior?.transaction && !willSendNewRequest(prior)
            ? decodeFunctionData({
                abi: verifiableFactoryAbi,
                data: prior.transaction.input,
              })
            : undefined;
        const salt =
          saved?.functionName === "deployProxy"
            ? saved.args[1]
            : deriveSalt(label, ctx.setupNonce);
        return client.readContract({
          address,
          abi: verifiableFactoryAbi,
          functionName: "predictProxyAddress",
          args: [ctx.account, salt],
        });
      };
      const [userRegistry, resolver] = await Promise.all([
        predict(ctx.parentLabel, "deploy-registry"),
        predict(`${ctx.parentLabel}-resolver`, "deploy-resolver"),
      ]);
      return { userRegistry, resolver };
    },
  });
}
