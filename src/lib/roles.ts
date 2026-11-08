/**
 * ENSv2 EAC role bitmaps for PermissionedRegistry / UserRegistry.
 * Values verified against contracts-v2 src/registry/libraries/RegistryRolesLib.sol
 * and src/access-control/libraries/EACBaseRolesLib.sol (main @ 48b3e2d).
 *
 * Layout: each role occupies one hex nybble in the lower 128 bits; the
 * corresponding admin role (who may grant/revoke it) is the same bit
 * shifted 128 bits up. ROLE_CAN_TRANSFER_ADMIN is admin-half only
 * (there is no user-tier transfer role).
 */

export const ROLE_REGISTRAR = 1n << 0n;
export const ROLE_REGISTER_RESERVED = 1n << 4n;
export const ROLE_SET_PARENT = 1n << 8n;
export const ROLE_UNREGISTER = 1n << 12n;
export const ROLE_RENEW = 1n << 16n;
export const ROLE_SET_SUBREGISTRY = 1n << 20n;
export const ROLE_SET_RESOLVER = 1n << 24n;
export const ROLE_WAS_RESERVED = 1n << 32n; // non-revokable tag, not grantable
export const ROLE_SET_URI = 1n << 36n;
export const ROLE_CAN_NAME = 1n << 120n;
export const ROLE_UPGRADE = 1n << 124n;
export const ROLE_CAN_TRANSFER_ADMIN = (1n << 28n) << 128n;

/** Admin counterpart of a user-tier role. */
export function adminOf(role: bigint): bigint {
  return role << 128n;
}

/** EACBaseRolesLib.ALL_ROLES: every role nybble set to 1 (user + admin halves). */
export const ALL_ROLES = BigInt(
  "0x1111111111111111111111111111111111111111111111111111111111111111",
);

export type RoleId =
  | "registrar"
  | "registerReserved"
  | "setParent"
  | "unregister"
  | "renew"
  | "setSubregistry"
  | "setResolver"
  | "setUri"
  | "canName"
  | "upgrade"
  | "canTransferAdmin";

export type RoleCatalogEntry = {
  id: RoleId;
  bit: bigint;
  /** Short badge label, e.g. for diagram edges. */
  short: string;
  /** Plain-language description of the user-tier role (registry scope). */
  label: string;
  /** Plain-language description of the admin counterpart (empty = admin-only role). */
  adminLabel: string;
  /** Row label when the role is granted to a subname owner on their own name. */
  subnameLabel?: string;
  /** Tooltip: what the permission does for a subname owner, verified against the contracts. */
  subnameDetail?: string;
  /** True when the role only exists as an admin-half bit (no user tier). */
  adminOnly?: boolean;
  /** Roles that let the holder take names away or break the setup. */
  dangerous?: boolean;
};

/** Drives the role editor UI, human-readable summaries, and diagram badges. */
export const ROLE_CATALOG: RoleCatalogEntry[] = [
  {
    id: "registrar",
    bit: ROLE_REGISTRAR,
    short: "REGISTRAR",
    label: "Register new subnames",
    adminLabel: "Grant/revoke the register permission",
  },
  {
    id: "registerReserved",
    bit: ROLE_REGISTER_RESERVED,
    short: "RESERVED",
    label: "Claim reserved subnames",
    adminLabel: "Grant/revoke the reserved-claim permission",
    dangerous: true,
  },
  {
    id: "setParent",
    bit: ROLE_SET_PARENT,
    short: "PARENT",
    label: "Change the registry's parent pointer",
    adminLabel: "Grant/revoke the parent-pointer permission",
    dangerous: true,
  },
  {
    id: "unregister",
    bit: ROLE_UNREGISTER,
    short: "UNREGISTER",
    label: "Delete registered subnames",
    adminLabel: "Grant/revoke the delete permission",
    subnameLabel: "Delete their subname",
    subnameDetail:
      "The subname owner can permanently remove their own name from the registry, freeing the label. Without this, the subname owner cannot delete it themselves. Accounts with registry-wide roles (you, until the registry is locked) can always delete any subname regardless of this setting.",
    dangerous: true,
  },
  {
    id: "renew",
    bit: ROLE_RENEW,
    short: "RENEW",
    label: "Extend subname expiry",
    adminLabel: "Grant/revoke the renew permission",
    subnameLabel: "Extend their subname's expiry",
    subnameDetail:
      "The owner can push the expiry further into the future at any time (the registry itself charges nothing; paid renewals go through a registrar). Without this, the owner depends on a registrar contract or a registry admin to keep the name alive.",
    dangerous: true,
  },
  {
    id: "setSubregistry",
    bit: ROLE_SET_SUBREGISTRY,
    short: "SUBREGISTRY",
    label: "Change a subname's own child registry",
    adminLabel: "Grant/revoke the child-registry permission",
    subnameLabel: "Give their subname its own subnames",
    subnameDetail:
      "The owner can attach a child registry to the subname, enabling deeper names like photos.alice.nick.eth, and can detach or replace that child registry later.",
    dangerous: true,
  },
  {
    id: "setResolver",
    bit: ROLE_SET_RESOLVER,
    short: "RESOLVER",
    label: "Change a subname's resolver",
    adminLabel: "Grant/revoke the resolver permission",
    subnameLabel: "Choose their subname's resolver",
    subnameDetail:
      "The owner can point the subname at a different resolver contract. This controls where records live; editing records inside a resolver is governed by that resolver's own permissions.",
    dangerous: true,
  },
  {
    id: "setUri",
    bit: ROLE_SET_URI,
    short: "URI",
    label: "Change the registry's token metadata URI",
    adminLabel: "Grant/revoke the metadata permission",
  },
  {
    id: "canName",
    bit: ROLE_CAN_NAME,
    short: "NAME",
    label: "Name the registry contract itself",
    adminLabel: "Grant/revoke the contract-naming permission",
  },
  {
    id: "upgrade",
    bit: ROLE_UPGRADE,
    short: "UPGRADE",
    label: "Upgrade the registry implementation",
    adminLabel: "Grant/revoke the upgrade permission",
    dangerous: true,
  },
  {
    id: "canTransferAdmin",
    bit: ROLE_CAN_TRANSFER_ADMIN,
    short: "TRANSFER",
    label: "Authorize subname token transfers",
    adminLabel: "",
    subnameLabel: "Transfer their subname",
    subnameDetail:
      "Allows the owner to transfer the subname. Standard safe transfers also require the registry to be emancipated; the explicit unsafe transfer path bypasses that safety check. Without it, the subname is locked to its current owner. This permission only exists in admin form.",
    adminOnly: true,
  },
];

export type ComposeEntry = { id: RoleId; admin?: boolean };

/** Compose a bitmap from catalog role ids (admin=true adds the shifted counterpart). */
export function composeBitmap(entries: ComposeEntry[]): bigint {
  let bitmap = 0n;
  for (const entry of entries) {
    const cat = ROLE_CATALOG.find((c) => c.id === entry.id);
    if (!cat) throw new Error(`unknown role id: ${entry.id}`);
    if (cat.adminOnly) {
      bitmap |= cat.bit; // already an admin-half bit
    } else if (entry.admin) {
      bitmap |= adminOf(cat.bit);
    } else {
      bitmap |= cat.bit;
    }
  }
  return bitmap;
}

export type DecomposedRole = {
  id: RoleId;
  short: string;
  label: string;
  isAdmin: boolean;
};

/** Break a bitmap into catalog entries (ignores unknown bits, e.g. WAS_RESERVED). */
export function decomposeBitmap(bitmap: bigint): DecomposedRole[] {
  const out: DecomposedRole[] = [];
  for (const cat of ROLE_CATALOG) {
    if (cat.adminOnly) {
      if ((bitmap & cat.bit) !== 0n) {
        out.push({ id: cat.id, short: cat.short, label: cat.label, isAdmin: true });
      }
      continue;
    }
    if ((bitmap & cat.bit) !== 0n) {
      out.push({ id: cat.id, short: cat.short, label: cat.label, isAdmin: false });
    }
    if ((bitmap & adminOf(cat.bit)) !== 0n) {
      out.push({ id: cat.id, short: `${cat.short}+ADMIN`, label: cat.adminLabel, isAdmin: true });
    }
  }
  return out;
}

/** Human-readable one-liners for a bitmap, for review panels. */
export function describeBitmap(bitmap: bigint): string[] {
  return decomposeBitmap(bitmap).map((r) => r.label);
}

/** True when `bitmap` contains every bit of `needed`. */
export function hasAll(bitmap: bigint, needed: bigint): boolean {
  return (bitmap & needed) === needed;
}

/** Format as 0x-prefixed 64-nybble hex, for the curious. */
export function bitmapHex(bitmap: bigint): `0x${string}` {
  return `0x${bitmap.toString(16).padStart(64, "0")}`;
}
