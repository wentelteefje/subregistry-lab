/** Earl artwork: https://docs.ens.domains/img/frens/Earl_padding.png */
export function ExperimentalNotice() {
  return (
    <aside
      aria-labelledby="experimental-notice-title"
      className="flex min-w-0 items-start gap-4 rounded-lg border border-ens-border bg-ens-card p-4 text-sm leading-relaxed"
    >
      <img
        src="/frens/earl.png"
        alt=""
        width={56}
        height={56}
        className="mt-0.5 h-14 w-14 shrink-0 object-contain"
      />
      <div className="min-w-0">
        <p id="experimental-notice-title" className="font-semibold">Experimental app</p>
        <p className="mt-1 text-ens-muted">
          Use at your own risk. Review each transaction carefully before signing.
        </p>
      </div>
    </aside>
  );
}
