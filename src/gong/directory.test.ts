import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.GONG_ACCESS_KEY = "test-key";
process.env.GONG_ACCESS_KEY_SECRET = "test-secret";
process.env.GONG_BASE_URL = "https://gong.test";

const { GongClient } = await import("./client.js");
const { loadUserDirectory, matchDirectoryUsers, clearUserDirectoryCache } = await import("./directory.js");

const PAGE_ONE = {
  users: [
    { id: "501", emailAddress: "Nikki.Mitchell@gonimbly.com", firstName: "Nikki", lastName: "Mitchell", title: "Account Executive", active: true, managerId: "504" },
    { id: "502", emailAddress: "brian.one@gonimbly.com", firstName: "Brian", lastName: "One", active: true },
  ],
  records: { totalRecords: 4, cursor: "page2" },
};
const PAGE_TWO = {
  users: [
    { id: "503", emailAddress: "brian.two@gonimbly.com", firstName: "Brian", lastName: "Two", active: false },
    { id: "504", emailAddress: "member@gonimbly.com", firstName: "Member", lastName: "User", active: true },
  ],
  records: { totalRecords: 4 },
};

let fetchCount = 0;
let endlessCursors = false;

globalThis.fetch = (async (input: any) => {
  fetchCount++;
  const url = String(input);
  if (endlessCursors) {
    return new Response(JSON.stringify({ users: PAGE_ONE.users, records: { cursor: `page${fetchCount + 1}` } }), { status: 200 });
  }
  const page = url.includes("cursor=page2") ? PAGE_TWO : PAGE_ONE;
  return new Response(JSON.stringify(page), { status: 200 });
}) as typeof fetch;

const client = new GongClient();

beforeEach(() => {
  fetchCount = 0;
  endlessCursors = false;
  clearUserDirectoryCache();
});

describe("loadUserDirectory", () => {
  test("assembles the complete directory across cursor pages", async () => {
    const users = await loadUserDirectory(client);
    assert.equal(users.length, 4);
    assert.equal(fetchCount, 2);
    const nikki = users.find((u) => u.userId === "501");
    assert.ok(nikki);
    assert.equal(nikki.email, "nikki.mitchell@gonimbly.com", "emails are lowercased");
    assert.equal(nikki.fullName, "Nikki Mitchell");
    assert.equal(nikki.title, "Account Executive");
    assert.equal(nikki.managerId, "504");
  });

  test("caches the directory — second load performs zero fetches", async () => {
    await loadUserDirectory(client);
    assert.equal(fetchCount, 2);
    const again = await loadUserDirectory(client);
    assert.equal(again.length, 4);
    assert.equal(fetchCount, 2, "second load must hit the cache");
  });

  test("clearUserDirectoryCache forces a refetch", async () => {
    await loadUserDirectory(client);
    clearUserDirectoryCache();
    await loadUserDirectory(client);
    assert.equal(fetchCount, 4);
  });

  test("refuses to serve an incomplete directory when the page cap is hit", async () => {
    endlessCursors = true;
    await assert.rejects(loadUserDirectory(client), /incomplete directory/);
  });
});

describe("matchDirectoryUsers", () => {
  test("matches name fragments case-insensitively", async () => {
    const users = await loadUserDirectory(client);
    const matches = matchDirectoryUsers(users, "NIKKI");
    assert.deepEqual(matches.map((u) => u.userId), ["501"]);
  });

  test("matches email fragments", async () => {
    const users = await loadUserDirectory(client);
    const matches = matchDirectoryUsers(users, "brian.two@");
    assert.deepEqual(matches.map((u) => u.userId), ["503"]);
  });

  test("returns every match, including inactive users flagged by `active`", async () => {
    const users = await loadUserDirectory(client);
    const matches = matchDirectoryUsers(users, "brian");
    assert.deepEqual(matches.map((u) => u.userId), ["502", "503"]);
    assert.equal(matches.find((u) => u.userId === "503")?.active, false);
  });

  test("blank query matches nothing", async () => {
    const users = await loadUserDirectory(client);
    assert.deepEqual(matchDirectoryUsers(users, "   "), []);
  });
});
