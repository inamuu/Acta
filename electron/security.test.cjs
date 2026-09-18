const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { resolveAssetPath, isTrustedSender } = require("./security.cjs");

test("assets allow local images but reject traversal, malformed URLs and symlink escapes", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "acta-security-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, "data");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "画像.png"), "image");
  await fs.writeFile(path.join(temp, "secret"), "private");
  await fs.symlink(path.join(temp, "secret"), path.join(root, "linked.png"));
  assert.equal(await resolveAssetPath(root, "acta-asset:///画像.png"), await fs.realpath(path.join(root, "画像.png")));
  for (const url of ["acta-asset:///%2e%2e%2fsecret", "acta-asset:///linked.png", "acta-asset:///%ZZ", "acta-asset:///%00", "file:///secret", "acta-asset:///"]) {
    await assert.rejects(resolveAssetPath(root, url), undefined, url);
  }
});

test("IPC accepts only registered application main frames", () => {
  const entry = "file:///app/dist/index.html";
  const frame = { url: `${entry}#section` };
  const event = { senderFrame: frame, sender: { mainFrame: frame } };
  assert.equal(isTrustedSender(event, entry), true);
  assert.equal(isTrustedSender(event, undefined), false);
  assert.equal(isTrustedSender({ ...event, senderFrame: { url: entry } }, entry), false);
  for (const url of ["file:///other/index.html", "https://example.com", `${entry}?other`, "invalid"]) {
    frame.url = url;
    assert.equal(isTrustedSender(event, entry), false);
  }
});
