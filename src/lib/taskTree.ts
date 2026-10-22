import type { ProjectTask } from "../../shared/types";

export type TaskTreeItem = {
  task: ProjectTask;
  depth: number;
};

/**
 * 親子関係（parentId）に沿ってタスクを並べる。親が同じ一覧に無いタスクは最上位に置く。
 * electron/storage.cjs の orderTasksAsTree と同じ並べ方。
 */
export function orderTasksAsTree(tasks: ProjectTask[]): TaskTreeItem[] {
  const ids = new Set(tasks.map((task) => task.id));
  const childrenByParentId = new Map<string, ProjectTask[]>();
  const roots: ProjectTask[] = [];
  for (const task of tasks) {
    const parentId = task.parentId;
    if (parentId && parentId !== task.id && ids.has(parentId)) {
      const children = childrenByParentId.get(parentId) || [];
      children.push(task);
      childrenByParentId.set(parentId, children);
    } else {
      roots.push(task);
    }
  }

  const ordered: TaskTreeItem[] = [];
  const visited = new Set<ProjectTask>();
  const visit = (task: ProjectTask, depth: number) => {
    if (visited.has(task)) return;
    visited.add(task);
    ordered.push({ task, depth });
    for (const child of childrenByParentId.get(task.id) || []) visit(child, depth + 1);
  };
  for (const task of roots) visit(task, 0);
  for (const task of tasks) visit(task, 0);
  return ordered;
}

/** 親タスクの候補。自分自身と自分の子孫は親にできない。完了済みは今の親だけ残す。 */
export function parentTaskCandidates(tasks: ProjectTask[], task: ProjectTask): ProjectTask[] {
  const descendants = new Set<string>([task.id]);
  let added = true;
  while (added) {
    added = false;
    for (const item of tasks) {
      if (item.parentId && descendants.has(item.parentId) && !descendants.has(item.id)) {
        descendants.add(item.id);
        added = true;
      }
    }
  }
  return tasks.filter(
    (item) => !descendants.has(item.id) && (item.status !== "Done" || item.id === task.parentId)
  );
}
