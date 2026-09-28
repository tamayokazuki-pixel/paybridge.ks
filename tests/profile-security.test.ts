import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/supabase-server", () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));

import { POST } from "@/app/api/profile/route";

it("a profile update cannot reactivate a suspended account or change its role", async () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const profile = { account_id: "PB001", status: "suspended", role: "user", is_verified: false };
  let submitted: Record<string, unknown> = {};
  mocks.getCurrentUser.mockResolvedValue({ id, email: "verified@example.org" });
  mocks.createSupabaseAdminClient.mockReturnValue({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }),
      upsert: (fields: Record<string, unknown>) => {
        submitted = fields;
        return { select: () => ({ single: async () => ({ data: { ...profile, ...fields }, error: null }) }) };
      }
    })
  });

  const response = await POST(new Request("http://localhost:3000/api/profile", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "Jane", lastName: "Doe", email: "someoneelse@example.org", username: "janedoe",
      accountType: "Personal Checking", currency: "USD - US Dollar",
      role: "admin", status: "active", is_verified: true
    })
  }));
  expect(response.status).toBe(200);
  expect(submitted).toMatchObject({ account_id: "PB001", email: "verified@example.org" });
  expect(submitted).not.toHaveProperty("role");
  expect(submitted).not.toHaveProperty("status");
  expect(submitted).not.toHaveProperty("is_verified");
  expect((await response.json()).profile.status).toBe("suspended");
});
