import { describe, expect, it } from "vitest";
import type { Identity } from "@/lib/gate";
import { canSeeNavItem } from "./nav";

const staff: Identity = {
  user: { id: "staff-1", email: "staff@example.com" },
  role: "staff",
  scopes: [],
};

const admin: Identity = {
  user: { id: "admin-1", email: "admin@example.com" },
  role: "admin",
  scopes: [],
};

describe("canSeeNavItem", () => {
  it("always exposes scoped navigation items to admins", () => {
    expect(canSeeNavItem(admin, "landing_pages:read")).toBe(true);
  });

  it("keeps scoped navigation items hidden from staff without the scope", () => {
    expect(canSeeNavItem(staff, "landing_pages:read")).toBe(false);
  });

  it("allows unscoped navigation items", () => {
    expect(canSeeNavItem(staff)).toBe(true);
  });
});
