/**
 * Subregistry configuration presets. Pure data consumed by the wizard,
 * the step builder (steps.ts), and the lock panel.
 */

import {
  ALL_ROLES,
  ROLE_REGISTER_RESERVED,
  ROLE_REGISTRAR,
  ROLE_RENEW,
  ROLE_SET_PARENT,
  ROLE_SET_RESOLVER,
  ROLE_SET_SUBREGISTRY,
  ROLE_UNREGISTER,
  ROLE_UPGRADE,
  ROLE_CAN_TRANSFER_ADMIN,
  adminOf,
} from "./roles";

export type PresetId = "fully-controlled" | "standard-rentable" | "unruggable";

/** uint64 max: "never expires" sentinel accepted by PermissionedRegistry. */
export const MAX_EXPIRY = 2n ** 64n - 1n;

/** Roles a subname owner gets on their own name (mirrors ETHRegistrar's REGISTRATION_ROLE_BITMAP). */
export const SUBNAME_OWNER_BITMAP =
  ROLE_SET_SUBREGISTRY |
  adminOf(ROLE_SET_SUBREGISTRY) |
  ROLE_SET_RESOLVER |
  adminOf(ROLE_SET_RESOLVER) |
  ROLE_CAN_TRANSFER_ADMIN;

/** Minimal subname bitmap for locked setups: records only, no structural changes. */
export const SUBNAME_MINIMAL_BITMAP = ROLE_SET_RESOLVER | adminOf(ROLE_SET_RESOLVER);

/**
 * Root roles the parent must give up (with their admins) for subnames to be
 * safe from the parent: delete, restructure, re-point, upgrade.
 * ROLE_REGISTRAR deliberately stays: it can only register AVAILABLE names.
 */
export const DANGEROUS_ROOT_BITMAP = [
  ROLE_UNREGISTER,
  ROLE_SET_SUBREGISTRY,
  ROLE_SET_RESOLVER,
  ROLE_RENEW,
  ROLE_SET_PARENT,
  ROLE_REGISTER_RESERVED,
  ROLE_UPGRADE,
].reduce((acc, role) => acc | role | adminOf(role), ROLE_CAN_TRANSFER_ADMIN);

export type LockStepId = "revoke-registry-roles" | "lock-parent-link";

export type LockStep = {
  id: LockStepId;
  title: string;
  warning: string;
  optional: boolean;
};

export type RegistrarDefaults = {
  /** Price per 365 days, in MockUSDC 6-decimal units. */
  pricePerYear: bigint;
  /** Minimum registration duration in seconds. */
  minDuration: bigint;
  /** Roles granted to the registrar contract on the registry root. */
  grantBitmap: bigint;
};

export type Preset = {
  id: PresetId;
  name: string;
  tagline: string;
  description: string;
  /** roleBitmap passed to UserRegistry.initialize for the connected wallet. */
  ownerInitBitmap: bigint;
  /** Deploy a SimpleSubnameRegistrar as part of setup? */
  registrar?: RegistrarDefaults;
  subnameDefaults: {
    roleBitmap: bigint;
    expiry: "duration" | "max";
  };
  lockPlan?: LockStep[];
};

export const PRESETS: Preset[] = [
  {
    id: "fully-controlled",
    name: "Fully controlled",
    tagline: "You keep every permission",
    description:
      "You hold all roles on the new registry: register, delete, renew, and reconfigure subnames at will. The default for experimenting.",
    ownerInitBitmap: ALL_ROLES,
    subnameDefaults: { roleBitmap: SUBNAME_OWNER_BITMAP, expiry: "duration" },
  },
  {
    id: "standard-rentable",
    name: "Standard rentable",
    tagline: "Paid subnames via a registrar",
    description:
      "Deploys the guide's SimpleSubnameRegistrar: anyone can register a subname for a yearly fee in USDC. You stay in full control of the registry.",
    ownerInitBitmap: ALL_ROLES,
    registrar: {
      pricePerYear: 5_000_000n, // 5 USDC (6 decimals)
      minDuration: 30n * 24n * 60n * 60n, // 30 days
      grantBitmap: ROLE_REGISTRAR | ROLE_RENEW,
    },
    subnameDefaults: { roleBitmap: SUBNAME_OWNER_BITMAP, expiry: "duration" },
  },
  {
    id: "unruggable",
    name: "Unruggable, unexpiring",
    tagline: "Permanent subnames while the parent is renewed",
    description:
      "Subnames are registered with a never-expiring lifetime and minimal permissions. Keep the parent .eth name renewed. After setup you can irreversibly give up the roles that could delete, re-point, or expire them - including your own.",
    ownerInitBitmap: ALL_ROLES, // full power needed during setup; locked afterwards
    subnameDefaults: { roleBitmap: SUBNAME_MINIMAL_BITMAP, expiry: "max" },
    lockPlan: [
      {
        id: "revoke-registry-roles",
        title: "Give up dangerous registry roles",
        warning:
          "After all holders remove the listed root roles, root accounts cannot delete, renew, re-point, or upgrade names, and the parent metadata is frozen. New subnames can still be registered.",
        optional: false,
      },
      {
        id: "lock-parent-link",
        title: "Lock your name's registry pointer",
        warning:
          "Irreversible: you give up the permission to change which registry your .eth name points at (the subregistry pointer in the .eth registry). The restriction lasts for this registration of the parent name; expiry and re-registration create new permissions.",
        optional: true,
      },
    ],
  },
];

export function getPreset(id: PresetId): Preset {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`unknown preset: ${id}`);
  return preset;
}
