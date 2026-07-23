const test = require("node:test");
const assert = require("node:assert/strict");
const { _test } = require("./storage.cjs");

test("project statuses map to ToDo task markers", () => {
  assert.equal(_test.markerFromProjectTaskStatus("Inbox"), " ");
  assert.equal(_test.markerFromProjectTaskStatus("InProgress"), "-");
  assert.equal(_test.markerFromProjectTaskStatus("Waiting"), "R");
  assert.equal(_test.markerFromProjectTaskStatus("Done"), "x");
});

test("moving an existing project task updates its ToDo marker", () => {
  const body = ["# ToDo", "- Acta", "\t- [-] Projects連携を実装する"].join("\n");
  const nextBody = _test.upsertProjectTasksInTodoBody(body, "Acta", [
    { title: "Projects連携を実装する", status: "Done" }
  ]);

  assert.match(nextBody, /\t- \[x\] Projects連携を実装する/);
  assert.doesNotMatch(nextBody, /\t- \[-\] Projects連携を実装する/);
});

test("moving a task not yet in ToDo appends it with its current status", () => {
  const body = ["# ToDo", "- Acta", "\t- [ ] 既存タスク"].join("\n");
  const nextBody = _test.upsertProjectTasksInTodoBody(body, "Acta", [
    { title: "新しいタスク", status: "Waiting" }
  ]);

  assert.match(nextBody, /\t- \[R\] 新しいタスク/);
});
