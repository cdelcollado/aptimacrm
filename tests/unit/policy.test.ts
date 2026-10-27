import { describe, expect, it } from "vitest";
import * as policy from "@/server/authz/policy";
import type { Principal } from "@/server/authz/policy";

const p = (role: Principal["role"], userId = "me"): Principal => ({ userId, name: "x", role, locale: "ca" });

describe("record visibility and mutation", () => {
  const mine = { ownerId: "me" };
  const theirs = { ownerId: "other" };

  it("salespeople read and mutate only records they own", () => {
    expect(policy.canRead(p("salesperson"), mine)).toBe(true);
    expect(policy.canRead(p("salesperson"), theirs)).toBe(false);
    expect(policy.canMutate(p("salesperson"), theirs)).toBe(false);
  });

  it("managers and admins read and mutate every record", () => {
    expect(policy.canRead(p("manager"), theirs)).toBe(true);
    expect(policy.canMutate(p("admin"), theirs)).toBe(true);
  });

  it("only managers and admins may reassign an owner", () => {
    expect(policy.canReassign(p("salesperson"))).toBe(false);
    expect(policy.canReassign(p("manager"))).toBe(true);
  });

  it("only managers and admins may restore archived records", () => {
    expect(policy.canRestore(p("salesperson"))).toBe(false);
    expect(policy.canRestore(p("manager"))).toBe(true);
  });
});

describe("merge and export boundaries", () => {
  it("salespeople merge only when they own both contacts", () => {
    expect(policy.canMerge(p("salesperson"), { ownerId: "me" }, { ownerId: "me" })).toBe(true);
    expect(policy.canMerge(p("salesperson"), { ownerId: "me" }, { ownerId: "other" })).toBe(false);
    expect(policy.canMerge(p("manager"), { ownerId: "a" }, { ownerId: "b" })).toBe(true);
  });

  it("only admins may run a full CRM export", () => {
    expect(policy.canExportFull(p("admin"))).toBe(true);
    expect(policy.canExportFull(p("manager"))).toBe(false);
    expect(policy.canExportFull(p("salesperson"))).toBe(false);
  });

  it("managers may export the deal snapshot, salespeople may not", () => {
    expect(policy.canExportDeals(p("manager"))).toBe(true);
    expect(policy.canExportDeals(p("salesperson"))).toBe(false);
  });

  it("only admins manage stages", () => {
    expect(policy.canManageStages(p("manager"))).toBe(false);
    expect(policy.canManageStages(p("admin"))).toBe(true);
  });
});
