import test from "node:test";
import assert from "node:assert/strict";
import {
  HOME_EMPTY_VISUAL_POOLS,
  pickHomeEmptyVisual,
} from "../codemini-web/client/src/lib/home-empty-visuals.js";

test("general pool includes the dark deco banners", () => {
  const ids = HOME_EMPTY_VISUAL_POOLS.general.map((v) => v.id);
  assert.deepEqual(ids, [
    "dark-deco-boulevard",
    "dark-deco-bar",
    "dark-deco-lounge",
  ]);
});

test("project pool includes the dark deco banners", () => {
  const ids = HOME_EMPTY_VISUAL_POOLS.project.map((v) => v.id);
  assert.deepEqual(ids, [
    "dark-deco-boulevard",
    "dark-deco-bar",
    "dark-deco-lounge",
  ]);
});

test("pickHomeEmptyVisual uses rng index within pool", () => {
  const picked = pickHomeEmptyVisual("general", () => 0.99);
  assert.equal(picked.id, "dark-deco-lounge");
});
