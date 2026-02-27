const fs = require("node:fs/promises");

async function writeIfMissing(file, fallback) {
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, fallback, "utf8");
  }
}

async function ensureDataFiles({
  dataDir,
  usersFile,
  spotsFile,
  curatedFile,
  reportsFile,
  overpassCacheFile,
  placesFile
}) {
  await fs.mkdir(dataDir, { recursive: true });
  await writeIfMissing(usersFile, "[]");
  await writeIfMissing(spotsFile, "[]");
  await writeIfMissing(curatedFile, "[]");
  await writeIfMissing(reportsFile, "[]");
  await writeIfMissing(overpassCacheFile, '{"entries":[]}');
  await writeIfMissing(placesFile, '{"snapshots":{}}');
}

async function readJson(file) {
  const text = await fs.readFile(file, "utf8");
  return JSON.parse(text);
}

async function writeJson(file, value) {
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

module.exports = {
  ensureDataFiles,
  readJson,
  writeJson
};
