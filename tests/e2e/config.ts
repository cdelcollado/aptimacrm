/** Fixed endpoints and credentials for the browser test stack. Local only; never used outside tests. */
export const E2E = {
  appPort: 3100,
  dbPort: 54330,
  databaseUrl: "postgres://aptima:aptima@127.0.0.1:54330/aptima_e2e",
  password: "e2e-password-123",
  inboundSecret: "e2e-inbound-secret-0123456789abcdef",
  baseUrl: "http://localhost:3100",
} as const;

export const USERS = {
  admin: "admin@aptima.test",
  manager: "manager@aptima.test",
  ana: "ana@aptima.test",
  joan: "joan@aptima.test",
} as const;
