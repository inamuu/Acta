const test = require("node:test");
const assert = require("node:assert/strict");
const { _test } = require("./storage.cjs");

test("project statuses map to ToDo task markers", () => {
  assert.equal(_test.markerFromProjectTaskStatus("Backlog"), " ");
  assert.equal(_test.markerFromProjectTaskStatus("InProgress"), "-");
  assert.equal(_test.markerFromProjectTaskStatus("GitHub"), "-");
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
    { title: "新しいタスク", status: "GitHub" }
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
  assert.equal(_test.projectTaskStatusFromGitHubItem({ state: "closed", isPullRequest: true }, { status: "GitHub", sourceState: "open" }), "Done");
  assert.equal(_test.projectTaskStatusFromGitHubItem({ state: "open", isPullRequest: true }, { status: "Backlog", sourceState: "open" }), "GitHub");
  assert.equal(_test.projectTaskStatusFromGitHubItem({ state: "open", isPullRequest: false }, { status: "InProgress", sourceState: "open" }), "InProgress");
  assert.equal(_test.projectTaskStatusFromGitHubItem({ state: "open", isPullRequest: false }, { status: "Done", sourceState: "closed" }), "Backlog");
  assert.equal(_test.projectTaskStatusFromGitHubItem({ state: "open", isPullRequest: false }, null), "Backlog");
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
    { title: "OIDC対応", status: "GitHub", source: "github" }
  ]);

  assert.equal(nextBody, ["# ToDo", "- 認証基盤", "  - [-] 既存タスク", "  - [-] OIDC対応"].join("\n"));
});

test("GitHub sync only updates when source metadata or state changed", () => {
  const task = {
    title: "OIDC対応 #12",
    status: "GitHub",
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
        { title: "イメージ更新 #6048", status: "GitHub", source: "github" }
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
