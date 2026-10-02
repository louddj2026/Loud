import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { adoptLegacyDurableFile } from "../lib/data-root.ts";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const librarySource = await readFile(new URL("../lib/dj-library.ts", import.meta.url), "utf8");
const musicSource = await readFile(new URL("../lib/music-library.ts", import.meta.url), "utf8");
const recoverySource = await readFile(new URL("../lib/teaching-batch-recovery.ts", import.meta.url), "utf8");
const teachingRouteSource = await readFile(new URL("../app/api/dj-library/teaching/route.ts", import.meta.url), "utf8");

function libraryUrl(name) {
  return pathToFileURL(path.join(projectRoot, "lib", name)).href;
}

function runNodeScript(script, { cwd, dataRoot }) {
  const env = { ...process.env, NODE_NO_WARNINGS: "1" };
  delete env.CROWD_DATA_ROOT;
  if (dataRoot) env.CROWD_DATA_ROOT = dataRoot;
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { cwd, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("every durable store resolves its location from the one shared data root", () => {
  assert.match(librarySource, /const libraryRoot = path\.join\(durableDataRoot, "dj-library"\)/);
  assert.match(musicSource, /const uploadedDirectory = path\.join\(durableDataRoot, "uploads"\)/);
  assert.match(musicSource, /const uploadedIndexFile = path\.join\(durableDataRoot, "uploaded-tracks\.json"\)/);
  assert.match(recoverySource, /const undoDirectory = path\.join\(durableDataRoot, "teaching-undo"\)/);
  assert.match(teachingRouteSource, /const undoDirectory = path\.join\(durableDataRoot, "teaching-undo"\)/);
  for (const source of [librarySource, musicSource, recoverySource, teachingRouteSource]) {
    assert.doesNotMatch(source, /process\.env\.CROWD_DATA_ROOT/);
  }
});

test("CROWD_DATA_ROOT decides the durable data root, with the project data folder as fallback", async () => {
  const configuredRoot = await mkdtemp(path.join(os.tmpdir(), "crowd-data-root-"));
  try {
    const script = `import { durableDataRoot } from ${JSON.stringify(libraryUrl("data-root.ts"))}; console.log(durableDataRoot);`;
    assert.equal(runNodeScript(script, { cwd: projectRoot, dataRoot: configuredRoot }), configuredRoot);
    assert.equal(runNodeScript(script, { cwd: projectRoot }), path.join(projectRoot, "data"));
  } finally {
    await rm(configuredRoot, { recursive: true, force: true });
  }
});

test("legacy durable files are adopted once and never overwrite a populated root", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "crowd-adopt-"));
  try {
    const legacy = path.join(directory, "legacy", "memory.json");
    const adopted = path.join(directory, "root", "nested", "memory.json");
    await rm(legacy, { force: true });
    assert.equal(adoptLegacyDurableFile(adopted, [legacy]), false);
    assert.equal(existsSync(adopted), false);
    await writeFile(path.join(directory, "legacy.json"), "legacy-content");
    assert.equal(adoptLegacyDurableFile(adopted, [adopted, path.join(directory, "legacy.json")]), true);
    assert.equal(await readFile(adopted, "utf8"), "legacy-content");
    await writeFile(path.join(directory, "legacy.json"), "newer-content");
    assert.equal(adoptLegacyDurableFile(adopted, [path.join(directory, "legacy.json")]), false);
    assert.equal(await readFile(adopted, "utf8"), "legacy-content");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the DJ memory database honours CROWD_DATA_ROOT and adopts the legacy project database", async () => {
  const legacyProject = await mkdtemp(path.join(os.tmpdir(), "crowd-legacy-project-"));
  const configuredRoot = await mkdtemp(path.join(os.tmpdir(), "crowd-configured-root-"));
  try {
    const writeScript = `import { writeDjLibraryMeta } from ${JSON.stringify(libraryUrl("dj-library.ts"))}; await writeDjLibraryMeta("data-root-check", "from-legacy"); console.log("ok");`;
    assert.equal(runNodeScript(writeScript, { cwd: legacyProject }), "ok");
    assert.ok(existsSync(path.join(legacyProject, "data", "dj-library", "crowd-library.sqlite")));
    const readScript = `import { readDjLibraryMeta } from ${JSON.stringify(libraryUrl("dj-library.ts"))}; console.log(await readDjLibraryMeta("data-root-check", "missing"));`;
    assert.equal(runNodeScript(readScript, { cwd: legacyProject, dataRoot: configuredRoot }), "from-legacy");
    assert.ok(existsSync(path.join(configuredRoot, "dj-library", "crowd-library.sqlite")));
  } finally {
    await rm(legacyProject, { recursive: true, force: true });
    await rm(configuredRoot, { recursive: true, force: true });
  }
});

test("a stranded root-level upload index is adopted even when its audio files are gone", async () => {
  const legacyProject = await mkdtemp(path.join(os.tmpdir(), "crowd-legacy-uploads-"));
  const configuredRoot = await mkdtemp(path.join(os.tmpdir(), "crowd-upload-root-"));
  try {
    const strandedTrack = {
      id: "upload-stranded00000000000000",
      name: "Stranded upload",
      file: "stranded.wav",
      duration: 0,
      album: "User uploads",
      source: "uploaded",
      relativePath: "stranded.wav",
    };
    await writeFile(path.join(legacyProject, "uploaded-tracks.json"), JSON.stringify([strandedTrack]));
    const script = `import { getMusicLibrary } from ${JSON.stringify(libraryUrl("music-library.ts"))}; const library = await getMusicLibrary(); console.log(JSON.stringify(library.tracks.map((track) => track.id)));`;
    const ids = JSON.parse(runNodeScript(script, { cwd: legacyProject, dataRoot: configuredRoot }));
    assert.ok(ids.includes("upload-stranded00000000000000"), `adopted upload missing from ${ids}`);
    assert.ok(existsSync(path.join(configuredRoot, "uploaded-tracks.json")));
  } finally {
    await rm(legacyProject, { recursive: true, force: true });
    await rm(configuredRoot, { recursive: true, force: true });
  }
});
