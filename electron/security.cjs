const fs = require("node:fs/promises");
const path = require("node:path");

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function resolveAssetPath(dataDir, rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== "acta-asset:" || url.username || url.password || url.port) throw new Error("Forbidden");
  const relative = decodeURIComponent(`${url.hostname}${url.pathname}`);
  if (relative.includes("\0")) throw new Error("Forbidden");
  const target = path.resolve(path.join(dataDir, relative));
  if (!isWithin(path.resolve(dataDir), target)) throw new Error("Forbidden");
  const [root, realTarget] = await Promise.all([fs.realpath(dataDir), fs.realpath(target)]);
  if (!isWithin(root, realTarget) || !(await fs.stat(realTarget)).isFile()) throw new Error("Forbidden");
  return realTarget;
}

function isTrustedSender(event, entryUrl) {
  if (!entryUrl || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
  try {
    const actual = new URL(event.senderFrame.url);
    const expected = new URL(entryUrl);
    actual.hash = "";
    expected.hash = "";
    return actual.href === expected.href;
  } catch {
    return false;
  }
}

module.exports = { resolveAssetPath, isTrustedSender };
