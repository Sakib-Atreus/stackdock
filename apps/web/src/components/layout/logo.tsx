/** StackDock logo: stacked containers on a dock. Same artwork as app/icon.svg. */
export function Logo({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="64" height="64" rx="14" fill="#111827" />
      <rect x="22" y="12" width="20" height="14" rx="3" fill="#ffffff" />
      <rect x="10.5" y="29" width="20" height="14" rx="3" fill="#ffffff" />
      <rect x="33.5" y="29" width="20" height="14" rx="3" fill="#ffffff" />
      <rect x="8" y="47" width="48" height="5" rx="2.5" fill="#38bdf8" />
    </svg>
  );
}
