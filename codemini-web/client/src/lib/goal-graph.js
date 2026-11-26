const nodeWidth = 158;
const nodeHeight = 66;
const columnGap = 50;
const rowGap = 20;
const padding = 12;

// 层数取最长前置路径，同层任务可以并排阅读。任务在计划里的排列不必是依赖顺序。
export function layoutGoalGraph(tasks) {
  const nodes = tasks.map(task => ({ id: task.id, task, column: 0, successors: [], remaining: 0 }));
  const byId = new Map(nodes.map(node => [node.id, node]));
  const edges = [];
  for (const node of nodes) {
    for (const id of node.task.dependsOn) {
      const predecessor = byId.get(id);
      if (!predecessor) continue;
      predecessor.successors.push(node);
      node.remaining++;
      edges.push({ from: predecessor, to: node });
    }
  }
  const ready = nodes.filter(node => node.remaining === 0);
  for (let i = 0; i < ready.length; i++) {
    const parent = ready[i];
    for (const child of parent.successors) {
      child.column = Math.max(child.column, parent.column + 1);
      if (--child.remaining === 0) ready.push(child);
    }
  }

  const counts = [];
  let rows = 0;
  for (const node of nodes) {
    node.row = counts[node.column] || 0;
    counts[node.column] = node.row + 1;
    rows = Math.max(rows, node.row + 1);
  }
  for (const node of nodes) {
    node.x = padding + node.column * (nodeWidth + columnGap);
    node.y = padding + (node.row + (rows - counts[node.column]) / 2) * (nodeHeight + rowGap);
  }
  const width = padding * 2 + counts.length * (nodeWidth + columnGap) - columnGap;
  let height = padding * 2 + rows * (nodeHeight + rowGap) - rowGap;
  for (const edge of edges) {
    const x1 = edge.from.x + nodeWidth;
    const y1 = edge.from.y + nodeHeight / 2;
    const x2 = edge.to.x - 2;
    const y2 = edge.to.y + nodeHeight / 2;
    if (edge.to.column > edge.from.column + 1) {
      // 跨层直线会被中途的节点遮住，沿图底部绕行。
      edge.path = `M ${x1} ${y1} H ${x1 + 12} V ${height} H ${x2 - 12} V ${y2} H ${x2}`;
      height += padding;
    } else {
      edge.path = `M ${x1} ${y1} C ${x1 + 24} ${y1}, ${x2 - 24} ${y2}, ${x2} ${y2}`;
    }
  }
  return { nodes, edges, width, height, nodeWidth, nodeHeight };
}
