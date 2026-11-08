/** Register and renew are separate payment intents; an existing name never silently becomes a renewal. */
export function paidOperationExpiry(
  operation: "register" | "renew",
  status: number,
  expiry: bigint,
): bigint | undefined {
  if (operation === "register") {
    if (status !== 0)
      throw new Error(
        "This label is not available. To extend an existing name, explicitly choose Renew.",
      );
    return undefined;
  }
  if (status !== 2)
    throw new Error("Only an active registered name can be renewed");
  return expiry;
}
