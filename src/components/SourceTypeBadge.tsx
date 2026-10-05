type Props = {
  sourceType?: "Issue" | "PullRequest";
};

// GitHub 由来タスクの種別を、アイコン付きのバッジで一目で見分けられるようにする。
export function SourceTypeBadge({ sourceType }: Props) {
  if (sourceType === "PullRequest") {
    return (
      <span className="sourceTypeBadge sourceTypeBadgePr" title="Pull Request">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="4" cy="3.5" r="1.75" />
          <circle cx="4" cy="12.5" r="1.75" />
          <circle cx="12" cy="12.5" r="1.75" />
          <path d="M4 5.25v5.5M12 10.75V6.5a2 2 0 0 0-2-2H7.5" />
          <path d="M9 3l-1.5 1.5L9 6" />
        </svg>
        PR
      </span>
    );
  }
  if (sourceType === "Issue") {
    return (
      <span className="sourceTypeBadge sourceTypeBadgeIssue" title="Issue">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <circle cx="8" cy="8" r="6" />
          <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
        </svg>
        Issue
      </span>
    );
  }
  return <span className="sourceTypeBadge">Task</span>;
}
