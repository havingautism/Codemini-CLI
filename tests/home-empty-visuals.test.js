import test from "node:test";
import assert from "node:assert/strict";
import {
  HOME_EMPTY_VISUAL_POOLS,
  pickHomeEmptyVisual,
} from "../codemini-web/client/src/lib/home-empty-visuals.js";

test("general pool includes loader-cat-dark", () => {
  const ids = HOME_EMPTY_VISUAL_POOLS.general.map((v) => v.id);
  assert.deepEqual(ids, [
    "printing-press",
    "celebration",
    "working-cat",
    "loader-cat-dark",
  ]);
});

test("project pool includes loader-cat-dark", () => {
  const ids = HOME_EMPTY_VISUAL_POOLS.project.map((v) => v.id);
  assert.deepEqual(ids, ["working-cat", "celebration", "loader-cat-dark"]);
});

test("pickHomeEmptyVisual uses rng index within pool", () => {
  const picked = pickHomeEmptyVisual("general", () => 0.99);
  assert.equal(picked.id, "loader-cat-dark");
});
