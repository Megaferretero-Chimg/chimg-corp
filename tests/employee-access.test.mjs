import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Execute the actual proxy with authentication and NextResponse isolated.
const source = readFileSync(new URL("../proxy.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "")
  .replace(/export /g, "");
const secret = "employee-access-test-secret";
const encoded = Buffer.from(JSON.stringify([])).toString("base64url");
const payload = `user-id:nomina:${encoded}`;
const token = `user:${payload}:${crypto.createHmac("sha256", secret).update(payload).digest("hex")}`;

async function request(pathname, method, user, cookie = token) {
  const context = vm.createContext({
    crypto, Buffer, Headers,
    process: { env: { SESSION_SECRET: secret } },
    getAuthenticatedUser: async (received) => {
      assert.equal(received, cookie);
      if (user instanceof Error) throw user;
      return user;
    },
    NextResponse: {
      json: (body, options) => ({ body, status: options.status }),
      next: () => ({ status: 200 }),
    },
  });
  vm.runInContext(source, context);
  return context.proxy({
    nextUrl: { pathname }, method,
    cookies: { get: () => ({ value: cookie }) },
    headers: new Headers(),
  });
}

const employeePermissions = ["view", "create", "update", "delete"].map((action) => `company.employees.${action}`);
const payrollUser = { accessRole: "nomina", permissions: employeePermissions };

test("current payroll permissions work even when the session contains no permissions", async () => {
  for (const [path, method] of [
    ["/api/company/employees", "GET"],
    ["/api/company/employees", "POST"],
    ["/api/company/employees/id", "GET"],
    ["/api/company/employees/id", "PATCH"],
    ["/api/company/employees/id", "DELETE"],
    ["/api/company/branches", "GET"],
    ["/api/company/roles", "GET"],
  ]) {
    assert.equal((await request(path, method, payrollUser)).status, 200, `${method} ${path}`);
  }
});

test("editing and termination permissions are enforced independently", async () => {
  for (const [permission, allowed, denied] of [["update", "PATCH", "DELETE"], ["delete", "DELETE", "PATCH"]]) {
    const user = { accessRole: "nomina", permissions: [`company.employees.${permission}`] };
    assert.equal((await request("/api/company/employees/id", allowed, user)).status, 200);
    assert.equal((await request("/api/company/employees/id", denied, user)).status, 403);
  }
});

test("removed permissions, disabled accounts and lookup failures fail closed", async () => {
  assert.equal((await request("/api/company/employees", "POST", { accessRole: "nomina", permissions: [] })).status, 403);
  assert.equal((await request("/api/company/employees", "POST", null)).status, 401);
  assert.equal((await request("/api/company/employees", "POST", new Error("unavailable"))).status, 503);
});

test("environment admin sessions remain supported", async () => {
  assert.equal((await request("/api/company/employees", "POST", { accessRole: "admin", permissions: [] }, "env-token")).status, 200);
});
