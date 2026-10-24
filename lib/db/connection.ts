import { getCACertificates } from "node:tls";
import type { PoolConfig } from "pg";

// node-postgres treats `sslrootcert` as a file path, so the libpq value
// `sslrootcert=system` ("use the OS trust store") makes it try to read a file
// called "system". We strip that one option and hand node-postgres an explicit
// TLS config that keeps full verification (chain + hostname), trusting the
// system store plus Node's bundled Mozilla roots. TLS is never disabled.

const VERIFYING_MODES = new Set(["verify-full", "verify-ca", "require", "prefer"]);

export interface NormalizedConnection {
  config: PoolConfig;
  /** URL with only node-postgres-safe options left, for logging-free reuse. */
  url: string;
}

function trustedRoots(): string[] {
  const roots = new Set<string>();
  for (const kind of ["system", "bundled"] as const) {
    try {
      for (const cert of getCACertificates(kind)) roots.add(cert);
    } catch {
      // Older runtimes without the store; the bundled set below still applies.
    }
  }
  return [...roots];
}

export function normalizeConnectionString(connectionString: string): NormalizedConnection {
  const url = new URL(connectionString);
  const sslmode = url.searchParams.get("sslmode");
  const rootcert = url.searchParams.get("sslrootcert");
  if (rootcert === "system") url.searchParams.delete("sslrootcert");

  // If any verifying mode (or the system root store) is requested we take over
  // TLS ourselves; pg would otherwise re-derive ssl from the URL and override us.
  if ((sslmode && VERIFYING_MODES.has(sslmode)) || rootcert === "system") {
    url.searchParams.delete("sslmode");
    const ca = trustedRoots();
    return {
      url: url.toString(),
      config: {
        connectionString: url.toString(),
        ssl: { rejectUnauthorized: true, ...(ca.length ? { ca } : {}) },
      },
    };
  }
  return { url: url.toString(), config: { connectionString: url.toString() } };
}

/** True when the URL asks for verified TLS; used by tests to prove we never downgrade. */
export function requiresVerifiedTls(connectionString: string): boolean {
  const { config } = normalizeConnectionString(connectionString);
  return typeof config.ssl === "object" && config.ssl?.rejectUnauthorized === true;
}
