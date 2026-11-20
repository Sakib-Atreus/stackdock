import { NORTHFLANK_REQUIRED_PERMISSIONS } from '@stackdock/shared';

export function TokenHelp() {
  return (
    <details className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        How to create a token with minimal permissions
      </summary>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-muted-foreground">
        <li>
          In Northflank, open your <strong>team settings → API → Roles</strong>{' '}
          and create a role (e.g. “StackDock”) with only these permissions:
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            {NORTHFLANK_REQUIRED_PERMISSIONS.map((p) => (
              <li key={p.permission}>
                <span className="text-foreground">{p.permission}</span>:{' '}
                {p.usedFor}
              </li>
            ))}
          </ul>
        </li>
        <li>
          Under <strong>API → Tokens</strong>, create a <strong>team</strong>{' '}
          token using that role. Organisation tokens aren&apos;t supported yet.
        </li>
        <li>Paste it here. Don&apos;t put it in code, chat, URLs or files.</li>
      </ol>
    </details>
  );
}
