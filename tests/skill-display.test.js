import test from "node:test";
import assert from "node:assert/strict";
import {
  groupSkillsByPackage,
  skillPackageGroupKey,
} from "../codemini-web/client/src/lib/skill-display.js";

test("groupSkillsByPackage groups remote skills and leaves local ungrouped", () => {
  const skills = [
    {
      name: "alpha",
      scope: "global",
      packageSource: "https://github.com/acme/tools",
      packageName: "acme/tools",
      source: "https://github.com/acme/tools",
      mode: "agent_requested",
      enabled: true,
    },
    {
      name: "beta",
      scope: "global",
      packageSource: "https://github.com/acme/tools",
      packageName: "acme/tools",
      source: "https://github.com/acme/tools",
      mode: "always",
      enabled: true,
    },
    {
      name: "local-one",
      scope: "global",
      source: "web-create",
      mode: "manual",
      enabled: true,
    },
    {
      name: "builtin-help",
      scope: "builtin",
      source: "builtin",
      mode: "manual",
      enabled: true,
    },
  ];

  const grouped = groupSkillsByPackage(skills);
  assert.equal(grouped.packages.length, 1);
  assert.equal(grouped.packages[0].packageName, "acme/tools");
  assert.deepEqual(
    grouped.packages[0].items.map((item) => item.name),
    ["beta", "alpha"],
  );
  assert.deepEqual(
    grouped.ungrouped.map((item) => item.name),
    ["builtin-help", "local-one"],
  );
});

test("skillPackageGroupKey groups a remote package in the single installation domain", () => {
  const globalSkill = {
    name: "alpha",
    scope: "global",
    packageSource: "owner/repo",
    source: "owner/repo",
  };
  const projectSkill = {
    name: "alpha",
    scope: "project",
    projectDir: "E:/proj",
    packageSource: "owner/repo",
    source: "owner/repo",
  };
  assert.equal(
    skillPackageGroupKey(globalSkill),
    skillPackageGroupKey(projectSkill),
  );
});
