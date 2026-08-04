import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectWaveScoutEntries,
  isActivelyRunningScout,
  isQuestionSettled,
  isRealScoutRunId,
  isScoutShownOnBoard,
  unresolvedDependencyIds,
} from "../codemini-web/client/src/lib/research-board-scouts.js";

describe("research-board-scouts", () => {
  it("recognizes store scout run ids (sr_), not session ids (rs_)", () => {
    assert.equal(isRealScoutRunId("sr_abc"), true);
    assert.equal(isRealScoutRunId("rs_session"), false);
    assert.equal(isRealScoutRunId("rq_question"), false);
  });

  it("hides waiting / queue stubs from the investigation board", () => {
    const questions = [
      { id: "rq_1", text: "Q1", status: "open", dependsOn: [] },
      { id: "rq_2", text: "Q2", status: "open", dependsOn: ["rq_1"] },
    ];
    assert.equal(
      isScoutShownOnBoard(
        { id: "rq_2", questionId: "rq_2", status: "waiting" },
        { scoutRunId: "rq_2", questionId: "rq_2", status: "waiting", waitingOn: ["rq_1"] },
        questions[1],
        questions,
      ),
      false,
    );
    assert.equal(
      isScoutShownOnBoard(
        { id: "rq_2", questionId: "rq_2", status: "pending" },
        { scoutRunId: "rq_2", questionId: "rq_2", status: "pending" },
        questions[1],
        questions,
      ),
      false,
    );
  });

  it("shows a real running sr_ scout even when waveId mismatches (empty-board regression)", () => {
    const questions = [
      { id: "rq_1", text: "Q1", status: "in_progress", dependsOn: [] },
    ];
    const wave = {
      id: "rw_persisted",
      wave: 1,
      status: "running",
      targets: [{ questionId: "rq_1" }],
      scouts: [],
    };
    const liveList = [{
      scoutRunId: "sr_abc",
      questionId: "rq_1",
      name: "Scout 1",
      status: "running",
      waveId: "rw_stale_or_live",
      wave: 1,
      searchCount: 2,
      fetchCount: 1,
      coverage: [{ text: "criterion A", status: "open" }],
    }];

    const visible = collectWaveScoutEntries({
      wave,
      waveIndex: 0,
      waveCount: 1,
      liveList,
      questions,
    });

    assert.equal(visible.length, 1);
    assert.equal(visible[0].id, "sr_abc");
    assert.equal(visible[0].status, "running");
    assert.equal(visible[0].searchCount, 2);
  });

  it("does not put waiting dependents on the board while upstream runs", () => {
    const questions = [
      { id: "rq_1", text: "Q1", status: "in_progress", dependsOn: [] },
      { id: "rq_2", text: "Q2", status: "open", dependsOn: ["rq_1"] },
    ];
    const wave = {
      id: "rw_1",
      wave: 1,
      status: "running",
      targets: [{ questionId: "rq_1" }, { questionId: "rq_2" }],
      scouts: [],
    };
    const liveList = [
      {
        scoutRunId: "sr_1",
        questionId: "rq_1",
        status: "running",
        waveId: "rw_1",
      },
      {
        scoutRunId: "rq_2",
        questionId: "rq_2",
        status: "waiting",
        waitingOn: ["rq_1"],
        waveId: "rw_1",
      },
    ];

    const visible = collectWaveScoutEntries({
      wave,
      waveIndex: 0,
      waveCount: 1,
      liveList,
      questions,
    });

    assert.deepEqual(visible.map((s) => s.id), ["sr_1"]);
  });

  it("treats only sr_ running as actively running (子问题 status)", () => {
    assert.equal(isActivelyRunningScout({ status: "running", scoutRunId: "sr_1" }), true);
    assert.equal(isActivelyRunningScout({ status: "running", scoutRunId: "rq_2" }), false);
    assert.equal(isActivelyRunningScout({ status: "running", scoutRunId: "rs_session" }), false);
    assert.equal(isActivelyRunningScout({ status: "waiting", scoutRunId: "sr_1" }), false);
  });

  it("unresolvedDependencyIds waits until upstream is settled", () => {
    const questions = [
      { id: "rq_1", text: "Q1", status: "in_progress", dependsOn: [] },
      { id: "rq_2", text: "Q2", status: "open", dependsOn: ["rq_1"] },
    ];
    assert.deepEqual(unresolvedDependencyIds(questions[1], questions), ["rq_1"]);
    questions[0].status = "done";
    assert.deepEqual(unresolvedDependencyIds(questions[1], questions), []);
    assert.equal(isQuestionSettled(questions[0]), true);
  });
});
