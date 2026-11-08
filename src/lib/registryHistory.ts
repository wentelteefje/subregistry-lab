import { registryAbi } from "../config/abis";

/** Identical filters let label and registrar discovery share one cached RPC scan. */
export const registryHistoryEvents = registryAbi.filter(
  (entry) => entry.type === "event" &&
    (entry.name === "LabelRegistered" || entry.name === "LabelReserved" || entry.name === "EACRolesChanged"),
);

export function registryHistoryError(logs: readonly { eventName?: string; args?: unknown; topics?: readonly unknown[] }[]) {
  const invalid = logs.filter((log) => {
    const args = (log.args ?? {}) as Record<string, unknown>;
    return (!log.eventName && Boolean(log.topics?.length)) ||
      ((log.eventName === "LabelRegistered" || log.eventName === "LabelReserved") && typeof args.label !== "string") ||
      (log.eventName === "EACRolesChanged" && (typeof args.account !== "string" || typeof args.resource !== "bigint"));
  }).length;
  return invalid ? `${invalid} registry history event(s) could not be decoded. Discovery is incomplete.` : undefined;
}
