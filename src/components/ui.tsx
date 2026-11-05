import { useDeployment } from "../hooks/useDeployment";
/**
 * Small shared UI pieces, styled after the ENS Explorer (explorer.ens.dev):
 * entity chips (pink = contract addresses, blue = names), warm cards on
 * #e1e1e0 borders, rounded stat boxes.
 */

import type { ReactNode } from "react";
import { etherscanAddress } from "../lib/links";

export function shortAddr(addr?: string): string {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Explorer-style entity chip. */
export function EntityChip({
  href,
  title,
  variant,
  children,
}: {
  href?: string;
  title?: string;
  variant: "pink" | "blue" | "green" | "amber" | "neutral";
  children: ReactNode;
}) {
  const tones = {
    pink: "text-ens-pink bg-ens-pink-fill",
    blue: "text-ens-blue bg-ens-blue-fill",
    green: "text-ens-green bg-ens-green-fill",
    amber: "text-ens-amber bg-ens-amber-fill",
    neutral: "text-ens-muted bg-ens-muted-fill",
  } as const;
  const className = `inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-sm leading-tight ${tones[variant]} ${
    href ? "hover:underline decoration-dotted underline-offset-2" : ""
  }`;
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" title={title} className={className}>
        {children}
      </a>
    );
  }
  return (
    <span title={title} className={className}>
      {children}
    </span>
  );
}

/** Contract address as a pink entity chip linking to Etherscan. */
export function AddressLink({ address }: { address: string }) {
  const network = useDeployment();
  return (
    <EntityChip href={etherscanAddress(address, network.id)} title={address} variant="pink">
      {shortAddr(address)}
    </EntityChip>
  );
}

/** ENS Explorer-style avatar placeholder: slightly rounded square, pink->lavender gradient. */
export function AvatarSquare({ size = 16 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-sm align-middle"
      style={{
        width: size,
        height: size,
        background: "var(--avatar-placeholder-gradient)",
      }}
    />
  );
}

/** ENS name as a blue entity chip with avatar placeholder (optionally linked). */
export function NameChip({ name, href }: { name: string; href?: string }) {
  return (
    <EntityChip href={href} variant="blue">
      <AvatarSquare size={14} />
      <span className="ml-1.5">{name}</span>
    </EntityChip>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-sm text-ens-blue underline decoration-dotted underline-offset-2 hover:opacity-70"
    >
      {children} ↗
    </a>
  );
}

/** Explorer-style rounded stat box ("Subnames", "Role holders", ...). */
export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div
      className="flex min-w-28 flex-col gap-1 rounded-2xl border border-ens-border bg-ens-card px-4 py-3"
      title={hint}
    >
      <span className="text-xs font-medium uppercase tracking-wide text-ens-muted">
        {label}
      </span>
      <span className="text-2xl font-semibold leading-none text-ens-fg">{value}</span>
    </div>
  );
}

export function Section({
  step,
  title,
  enabled,
  children,
}: {
  step: number;
  title: string;
  enabled: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border p-5 transition-opacity ${
        enabled ? "border-ens-border bg-ens-card" : "border-ens-border bg-white opacity-50"
      }`}
    >
      <h2 className="mb-3 flex items-center gap-2 text-lg font-medium">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ens-fg text-xs text-white">
          {step}
        </span>
        {title}
      </h2>
      {enabled ? children : <p className="text-sm">Complete the previous step first.</p>}
    </section>
  );
}

/** ⓘ with a hover tooltip; pure CSS, no positioning deps. */
export function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-block align-middle">
      <span
        className="ml-1 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-neutral-400 text-[10px] leading-none text-neutral-500"
        aria-label={text}
      >
        i
      </span>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-72 -translate-x-1/2 rounded-lg border border-ens-border bg-white px-3 py-2 text-left text-xs font-normal normal-case tracking-normal text-ens-fg shadow-lg group-hover:block">
        {text}
      </span>
    </span>
  );
}

export function WarningBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
      {children}
    </div>
  );
}

export function Badge({
  tone,
  children,
}: {
  tone: "green" | "amber" | "red" | "neutral";
  children: ReactNode;
}) {
  const tones = {
    green: "bg-ens-green-fill text-ens-green",
    amber: "bg-ens-amber-fill text-ens-amber",
    red: "bg-ens-pink-fill text-ens-pink",
    neutral: "bg-ens-muted-fill text-ens-muted",
  } as const;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function formatExpiry(expiry?: bigint): string {
  if (expiry === undefined) return "";
  if (expiry >= 2n ** 64n - 1n) return "never expires";
  return new Date(Number(expiry) * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
