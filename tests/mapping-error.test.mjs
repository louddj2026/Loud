import test from "node:test";
import assert from "node:assert/strict";
import { friendlyMappingError } from "../lib/mapping-error.ts";

test("a Python traceback reports its final exception instead of its heading", () => {
  const traceback = `Traceback (most recent call last):
  File "beat-model.py", line 42, in main
    tracker(source)
RuntimeError: Audio decoder could not read this file`;
  assert.equal(friendlyMappingError(new Error(traceback)), "Audio decoder could not read this file");
});

test("grid rejection reasons remain intact", () => {
  const stderr = `Error: Grid rejected instead of saved: no reliable final-quarter grid
    at analyse-library.mjs:55:11`;
  assert.equal(friendlyMappingError(new Error(stderr)), "Grid rejected instead of saved: no reliable final-quarter grid");
});

test("a bare traceback heading is never presented as the reason", () => {
  assert.equal(friendlyMappingError(new Error("Traceback (most recent call last):")), "Mapping failed");
});

test("Node module failures show the real error instead of the Node.js version footer", () => {
  const stderr = `node:internal/modules/package_json_reader:301
  throw new ERR_MODULE_NOT_FOUND(packageName, fileURLToPath(base), null);
        ^
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'ffmpeg-static' imported from C:\\Crowd2\\scripts\\analyse-library.mjs
    at Object.getPackageJSONURL (node:internal/modules/package_json_reader:301:9)
Node.js v24.14.0`;
  assert.equal(
    friendlyMappingError(new Error(stderr)),
    "Cannot find package 'ffmpeg-static' imported from C:\\Crowd2\\scripts\\analyse-library.mjs",
  );
});

test("a bare Node.js version footer is never shown as the mapping error", () => {
  assert.equal(friendlyMappingError(new Error("Node.js v24.14.0")), "Mapping failed");
});
