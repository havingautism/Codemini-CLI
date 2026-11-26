import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutGoalGraph } from '../codemini-web/client/src/lib/goal-graph.js';

test('依赖图保留并行、汇合及跨层依赖，支持未按执行顺序排列的计划', () => {
  const tasks = [
    { id: '交付', dependsOn: ['汇合', '甲'] },
    { id: '汇合', dependsOn: ['甲', '乙'] },
    { id: '乙', dependsOn: [] }, { id: '甲', dependsOn: [] },
  ];
  const graph = layoutGoalGraph(tasks);
  const nodes = Object.fromEntries(graph.nodes.map(node => [node.id, node]));
  assert.equal(nodes.甲.x, nodes.乙.x);
  assert.notEqual(nodes.甲.y, nodes.乙.y);
  assert.ok(nodes.汇合.x > nodes.甲.x && nodes.交付.x > nodes.汇合.x);
  assert.deepEqual(graph.edges.map(edge => [edge.from.id, edge.to.id]), [
    ['汇合', '交付'], ['甲', '交付'], ['甲', '汇合'], ['乙', '汇合'],
  ]);
  for (const edge of graph.edges) {
    assert.ok(edge.from.x + graph.nodeWidth < edge.to.x);
    assert.match(edge.path, /^M /);
    assert.doesNotMatch(edge.path, /NaN/);
  }
  for (const node of graph.nodes) {
    assert.ok(node.y >= 0 && node.y + graph.nodeHeight <= graph.height);
    assert.ok(node.x >= 0 && node.x + graph.nodeWidth <= graph.width);
  }
});

test('没有依赖的单任务仍有可点击空间', () => {
  const task = { id: '读文件', dependsOn: [] };
  const graph = layoutGoalGraph([task]);
  assert.equal(graph.nodes[0].task, task);
  assert.ok(graph.width >= graph.nodeWidth && graph.height >= graph.nodeHeight);
  assert.equal(graph.edges.length, 0);
});

test('跨过中间节点的多条依赖使用不同高度', () => {
  const { edges } = layoutGoalGraph([
    { id: '甲', dependsOn: [] }, { id: '乙', dependsOn: ['甲'] },
    { id: '丙', dependsOn: ['甲', '乙'] }, { id: '丁', dependsOn: ['乙', '丙'] },
  ]);
  const bypassHeights = edges.filter(edge => edge.to.column - edge.from.column > 1)
    .map(edge => / V (\d+) H /.exec(edge.path)[1]);
  assert.equal(new Set(bypassHeights).size, 2);
});
