const test = require("node:test");
const assert = require("node:assert/strict");
const { _test } = require("./storage.cjs");

test("project statuses map to ToDo task markers", () => {
  assert.equal(_test.markerFromProjectTaskStatus("Backlog"), " ");
  assert.equal(_test.markerFromProjectTaskStatus("InProgress"), "-");
  assert.equal(_test.markerFromProjectTaskStatus("GitHub"), "-"); // 旧ステータスはInProgress扱い
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
    { title: "新しいタスク", status: "InProgress" }
  ]);

  assert.match(nextBody, /  - \[-\] 新しいタスク/);
});

test("GitHub search results become Issue or PR tasks with stable metadata", () => {
  const item = {
    id: "PR_1",
    isPullRequest: true,
    number: 12,
    title: "OIDC対応",
    repository: { nameWithOwner: "example/api" },
    url: "https://github.com/example/api/pull/12"
  };

  assert.deepEqual(_test.githubSearchItemContent(item), {
    title: "OIDC対応 #12",
    sourceType: "PullRequest",
    sourceUrl: "https://github.com/example/api/pull/12",
    repository: "example/api"
  });
});

test("GitHub closes tasks but keeps Acta workflow state while they remain open", () => {
  assert.equal(_test.projectTaskStatusFromGitHubItem({ state: "closed", isPullRequest: true }, { status: "InProgress", sourceState: "open" }), "Done");
  assert.equal(_test.projectTaskStatusFromGitHubItem({ state: "open", isPullRequest: true }, { status: "Backlog", sourceState: "open" }), "Backlog");
  assert.equal(_test.projectTaskStatusFromGitHubItem({ state: "open", isPullRequest: true }, null), "InProgress");
  assert.equal(_test.projectTaskStatusFromGitHubItem({ state: "open", isPullRequest: false }, { status: "InProgress", sourceState: "open" }), "InProgress");
  assert.equal(_test.projectTaskStatusFromGitHubItem({ state: "open", isPullRequest: false }, { status: "Done", sourceState: "closed" }), "InProgress");
  assert.equal(_test.projectTaskStatusFromGitHubItem({ state: "open", isPullRequest: false }, null), "InProgress");
  assert.equal(_test.githubSourceState({ state: "merged" }), "closed");
  assert.equal(_test.githubSourceState({ state: "closed" }), "closed");
  assert.equal(_test.githubSourceState({ state: "open" }), "open");
});

test("GitHub URLs are metadata and GitHub tasks stay at the project task level", () => {
  const body = _test.upsertProjectTasksInTodoBody("# ToDo", "認証基盤", [
    {
      title: "OIDC対応",
      status: "InProgress",
      source: "github",
      sourceUrl: "https://github.com/example/api/pull/12"
    }
  ]);

  assert.match(body, /  - \[-\] OIDC対応/);
  assert.doesNotMatch(body, /  - GitHub/);
  assert.doesNotMatch(body, /github\.com/);
});

test("appending a GitHub task to an existing project does not add a GitHub hierarchy", () => {
  const body = ["# ToDo", "- 認証基盤", "  - [-] 既存タスク"].join("\n");
  const nextBody = _test.upsertProjectTasksInTodoBody(body, "認証基盤", [
    { title: "OIDC対応", status: "InProgress", source: "github" }
  ]);

  assert.equal(nextBody, ["# ToDo", "- 認証基盤", "  - [-] 既存タスク", "  - [-] OIDC対応"].join("\n"));
});

test("GitHub sync only updates when source metadata or state changed", () => {
  const task = {
    title: "OIDC対応 #12",
    status: "InProgress",
    sourceUrl: "https://github.com/example/api/pull/12",
    sourceType: "PullRequest",
    repository: "example/api"
  };
  assert.equal(_test.githubTaskChanged(task, { ...task }), false);
  assert.equal(_test.githubTaskChanged(task, { ...task, status: "Done" }), true);
});

test("GitHub tasks use the same two-space indentation as local tasks in ToDo", () => {
  const body = _test.buildTodoBodyFromProjectGroups([
    {
      name: "コンテナOSの最新化",
      tasks: [
        { title: "新Op", status: "InProgress", source: "local" },
        { title: "イメージ更新 #6048", status: "InProgress", source: "github" }
      ]
    }
  ], "ToDo");

  assert.equal(
    body,
    [
      "# ToDo",
      "- コンテナOSの最新化",
      "  - [-] 新Op",
      "  - [-] イメージ更新 #6048"
    ].join("\n")
  );
  assert.doesNotMatch(body, /\t/);
});

test("ToDo groups keep the order the project screen shows", () => {
  const body = _test.buildTodoBodyFromProjectGroups([
    { name: "日経メディカルワークス", tasks: [{ title: "Valkey化", status: "InProgress" }] },
    { name: "その他", tasks: [{ title: "test", status: "InProgress" }] }
  ], "ToDo");

  assert.equal(
    body,
    [
      "# ToDo",
      "- 日経メディカルワークス",
      "  - [-] Valkey化",
      "- その他",
      "  - [-] test"
    ].join("\n")
  );
});

test("a new project group is placed by the project display order", () => {
  const body = ["# ToDo", "- その他", "  - [-] test"].join("\n");
  const nextBody = _test.upsertProjectTasksInTodoBody(
    body,
    "日経メディカルワークス",
    [{ title: "Valkey化", status: "InProgress" }],
    ["日経メディカルワークス", "その他"]
  );

  assert.equal(
    nextBody,
    [
      "# ToDo",
      "- 日経メディカルワークス",
      "  - [-] Valkey化",
      "- その他",
      "  - [-] test"
    ].join("\n")
  );
});

test("existing ToDo groups are re-sorted into the project display order", () => {
  const lines = ["# ToDo", "- その他", "  - [-] test", "- 日経メディカルワークス", "  - [-] Valkey化"];
  assert.deepEqual(_test.reorderTodoGroupBlocks(lines, ["日経メディカルワークス", "その他"]), [
    "# ToDo",
    "- 日経メディカルワークス",
    "  - [-] Valkey化",
    "- その他",
    "  - [-] test"
  ]);
});

test("groups missing from the display order go last in name order", () => {
  const lines = ["# ToDo", "- ざつだん", "  - [-] a", "- Acta", "  - [-] b", "- その他", "  - [-] c"];
  assert.deepEqual(_test.reorderTodoGroupBlocks(lines, ["その他"]), [
    "# ToDo",
    "- その他",
    "  - [-] c",
    "- Acta",
    "  - [-] b",
    "- ざつだん",
    "  - [-] a"
  ]);
});

test("deleting a project task removes its ToDo line", () => {
  const body = ["# ToDo", "- Acta", "  - [-] 残すタスク", "  - [-] 消すタスク"].join("\n");
  assert.equal(
    _test.removeProjectTasksFromTodoBody(body, "Acta", ["消すタスク"]),
    ["# ToDo", "- Acta", "  - [-] 残すタスク"].join("\n")
  );
});

test("deleting the last task of a group removes the group heading", () => {
  const body = ["# ToDo", "- Acta", "  - [-] 消すタスク", "- その他", "  - [-] test"].join("\n");
  assert.equal(
    _test.removeProjectTasksFromTodoBody(body, "Acta", ["消すタスク"]),
    ["# ToDo", "- その他", "  - [-] test"].join("\n")
  );
});

test("deleting a task not written in ToDo keeps the body as is", () => {
  const body = ["# ToDo", "- Acta", "  - [-] 残すタスク"].join("\n");
  assert.equal(_test.removeProjectTasksFromTodoBody(body, "Acta", ["未記載タスク"]), body);
  assert.equal(_test.removeProjectTasksFromTodoBody(body, "別プロジェクト", ["残すタスク"]), body);
});

test("synced InProgress tasks are appended to today's ToDo", () => {
  const body = ["# ToDo", "- Acta", "  - [-] 既存タスク"].join("\n");
  const nextBody = _test.upsertProjectTasksInTodoBody(
    body,
    "Acta",
    [{ title: "OIDC対応 #12", status: "InProgress", source: "github" }],
    ["Acta"]
  );

  assert.equal(
    nextBody,
    ["# ToDo", "- Acta", "  - [-] 既存タスク", "  - [-] OIDC対応 #12"].join("\n")
  );
});

test("existingOnly tasks only flip the marker of lines already in ToDo", () => {
  const body = ["# ToDo", "- Acta", "  - [-] OIDC対応 #12"].join("\n");
  const closed = _test.upsertProjectTasksInTodoBody(
    body,
    "Acta",
    [{ title: "OIDC対応 #12", status: "Done", existingOnly: true }],
    ["Acta"]
  );
  assert.equal(closed, ["# ToDo", "- Acta", "  - [x] OIDC対応 #12"].join("\n"));

  const untouched = _test.upsertProjectTasksInTodoBody(
    body,
    "Acta",
    [{ title: "ToDoに無いタスク", status: "Done", existingOnly: true }],
    ["Acta"]
  );
  assert.equal(untouched, body);

  const newGroup = _test.upsertProjectTasksInTodoBody(
    body,
    "その他",
    [{ title: "ToDoに無いタスク", status: "Done", existingOnly: true }],
    ["Acta", "その他"]
  );
  assert.equal(newGroup, body);
});

test("GitHub items are classified from existing Acta project task titles", () => {
  const projects = [
    { id: "aws-local", name: "AWSアカウント分割（local）", tasks: [
      { title: "jm-local: sonicmoov 向け ECR pull 専用 IAM ユーザーを追加 #4263" }
    ] },
    { id: "other", name: "その他", tasks: [] }
  ];
  const related = _test.classifyGitHubItem({
    title: "jm-local: sonicmoov MFA 自己管理ポリシーのデバイス名制限を緩和",
    number: 4269,
    repository: { nameWithOwner: "example/repo" }
  }, projects);
  assert.equal(related.project.id, "aws-local");
  assert.equal(related.kind, "similarity");

  const unrelated = _test.classifyGitHubItem({ title: "個人的な買い物", number: 1 }, projects);
  assert.equal(unrelated.project.id, "other");
  assert.equal(unrelated.kind, "other");
});

test("Electron resolves gh from PATH or Homebrew locations", () => {
  const fromPath = _test.resolveGhExecutable({
    env: { PATH: "/custom/bin:/usr/bin" },
    platform: "darwin",
    exists: (candidate) => candidate === "/custom/bin/gh"
  });
  assert.equal(fromPath, "/custom/bin/gh");

  const fromHomebrew = _test.resolveGhExecutable({
    env: { PATH: "/usr/bin" },
    platform: "darwin",
    exists: (candidate) => candidate === "/opt/homebrew/bin/gh"
  });
  assert.equal(fromHomebrew, "/opt/homebrew/bin/gh");
});
