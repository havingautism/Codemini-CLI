import test from "node:test";
import assert from "node:assert/strict";
import {
  HOME_EMPTY_VISUAL_POOLS,
  pickHomeEmptyVisual,
} from "../codemini-web/client/src/lib/home-empty-visuals.js";

test("general pool includes randomized Gemini palettes", () => {
  const ids = HOME_EMPTY_VISUAL_POOLS.general.map((v) => v.id);
  assert.deepEqual(ids, ["gemini", "aurora", "spectrum", "violet"]);
});

test("project pool uses the same theme-aware palettes", () => {
  const ids = HOME_EMPTY_VISUAL_POOLS.project.map((v) => v.id);
  assert.deepEqual(ids, ["gemini", "aurora", "spectrum", "violet"]);
  assert.ok(HOME_EMPTY_VISUAL_POOLS.project.every((v) => v.light.length === v.dark.length));
});

test("pickHomeEmptyVisual uses rng index within pool", () => {
  const picked = pickHomeEmptyVisual("general", () => 0.99);
  assert.equal(picked.id, "violet");
});
