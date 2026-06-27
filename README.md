# gmailCleanUp

Automated Gmail cleanup and archiving using Google Apps Script.

`gmailCleanUp` is a configurable Gmail hygiene tool built for people who use labels as disposal rules. It can automatically delete threads in specific labels, clean up calendar invite emails, archive stale inbox threads, and send a summary report after each run.

The project is intentionally opinionated: if a thread is labeled for cleanup and not starred, it is considered disposable.

---

## Features

- Delete threads in specific Gmail labels after a set number of days
- Preserve starred threads everywhere
- Delete calendar invite emails when:
  - they are read and older than a threshold, or
  - the event date is already in the past
- Archive inbox threads older than a threshold
- Skip inbox archiving for:
  - starred threads
  - invite threads
  - protected labels
- Dry-run mode for safe testing
- Verbose logging for troubleshooting and performance analysis
- Smaller move batches to reduce Gmail mutation timeouts
- HTML email report after each run
- Count emails and threads with no user-created Gmail labels
- Single-property JSON configuration through Apps Script Script Properties
- Optional audit reporting for:
  - user labels that exist but do not match any rule
  - inbox threads with no user label by Gmail category

---

## Why this project exists

Most Gmail cleanup tools are either too conservative or too generic.

`gmailCleanUp` is designed for people who already organize mail with labels and want those labels to drive automation. Instead of guessing what is important, this script assumes:

- **starred = keep**
- **cleanup labels = disposable unless starred**
- **old inbox mail = archive unless something says otherwise**

This makes it especially useful for high-volume personal inboxes where unread clutter, notices, subscriptions, and low-value updates build up quickly.

---

## How it works

The script runs in three main phases, plus optional audit/reporting.

### 1. Invite cleanup

The script finds potential calendar invite emails by looking for `.ics` and `.vcs` attachments.

It deletes invite threads when:

- the thread is **not starred**, and
- either:
  - all messages in the thread are read and the thread is older than `INVITE_READ_DELETE_DAYS`, or
  - the invite event date has already passed

This is useful for cleaning up accepted invites that no longer need to live in Gmail.

### 2. Label cleanup

The script searches a configured list of labels and deletes matching threads when:

- the thread is older than `DELETE_THRESHOLD_DAYS`
- the thread is **not starred**

This is the core cleanup behavior.

### 3. Inbox archiving

The script archives inbox threads when:

- they are older than `ARCHIVE_THRESHOLD_DAYS`
- they are **not starred**
- they do **not** contain invite attachments
- they do **not** have a protected label

### 4. Reporting and optional audit

After cleanup, the script emails an HTML summary report showing:

- invite cleanup results
- label cleanup results
- inbox archive results
- no-user-label thread and email counts

When `ENABLE_AUDIT` is turned on, the report can also show:

- labels found that do not match any configured rule
- inbox threads with no user label by Gmail category
- unreadable label objects skipped during audit

---

## Safety model

This project is intentionally aggressive, but it still has a few built-in guardrails:

- **Starred threads are always preserved**
- **Dry-run mode** lets you test without making changes
- Invite cleanup checks event dates when possible
- Inbox archiving can ignore protected labels
- Move operations are chunked using `MOVE_BATCH_SIZE` to reduce timeout risk

If you are testing for the first time, set this in your JSON config:

```json
"DRY_RUN": true
```

Then review the emailed report before turning live mode on.

---

## Requirements

- A Gmail account
- Google Apps Script
- Permission to access Gmail in Apps Script
- Optional but recommended: Advanced Gmail service enabled for fast no-label count estimates

No external services or libraries are required.

---

## Installation

1. Create a new Google Apps Script project.
2. Paste in the contents of `gmailCleanUp.gs`.
3. Create a JSON config from `gmailCleanUp.config.example.json`.
4. In Apps Script, open **Project Settings > Script properties**.
5. Add one script property:
   - Property: `CONFIG_JSON`
   - Value: your full JSON config
6. Save the project.
7. Run `sendReportEmail()` manually once to authorize Gmail access.
8. Review the report.
9. Create a time-based trigger to run daily.

---

## Configuration

The script keeps generic defaults in code and loads your runtime settings from Apps Script **Script Properties**.

The recommended setup is one property named `CONFIG_JSON` whose value is your full JSON configuration. This avoids adding each setting one row at a time in the Apps Script UI.

Individual Script Properties can still override values from `CONFIG_JSON` when needed. For example, you can set one property named `DRY_RUN` with value `false` without editing the JSON blob.

### Create the JSON file

Start from `gmailCleanUp.config.example.json`, then edit the values for your mailbox.

Example:

```json
{
  "LABELS_TO_DELETE": [
    "subscriptions",
    "promotions",
    "orders"
  ],
  "DELETE_THRESHOLD_DAYS": 2,
  "INVITE_READ_DELETE_DAYS": 2,
  "ARCHIVE_THRESHOLD_DAYS": 10,
  "BATCH_SIZE": 100,
  "MOVE_BATCH_SIZE": 20,
  "REPORT_RECIPIENT_EMAILS": [
    "you@example.com"
  ],
  "ARCHIVE_IGNORE_LABELS": [
    "personal",
    "important"
  ],
  "INVITE_EXTENSIONS": [
    ".ics",
    ".vcs"
  ],
  "DRY_RUN": true,
  "VERBOSE_LOGS": false,
  "ENABLE_AUDIT": false,
  "NO_USER_LABEL_COUNT_MODE": "estimate",
  "NO_USER_LABEL_QUERY": "has:nouserlabels",
  "NO_USER_LABEL_FALLBACK_MAX_THREADS": 500,
  "NO_USER_LABEL_FALLBACK_COUNT_EMAILS": false,
  "PROJECT_NAME": "Gmail Cleanup Automation",
  "PROJECT_VERSION": "0.3.1",
  "PROJECT_COPYRIGHT": "",
  "PROJECT_REPO_URL": "",
  "PROJECT_REPO_TEXT": "Project Repository",
  "REPORT_SUBJECT_PREFIX": "Gmail Cleanup Report"
}
```

### Add the JSON to Apps Script

1. Open your Apps Script project.
2. Open **Project Settings**.
3. Under **Script Properties**, click **Add script property**.
4. Set **Property** to `CONFIG_JSON`.
5. Paste the full JSON as the **Value**.
6. Click **Save script properties**.

Apps Script does not automatically read local `.json` files from this repo. The JSON file is a convenient source-of-truth that you paste into `CONFIG_JSON`.

### Configuration options

#### `LABELS_TO_DELETE`

User-created Gmail labels that should be treated as cleanup rules.

Threads in these labels will be moved to trash once they are older than `DELETE_THRESHOLD_DAYS`, unless starred.

#### `DELETE_THRESHOLD_DAYS`

Age threshold for labeled cleanup.

#### `INVITE_READ_DELETE_DAYS`

Age threshold for invite emails that are already read.

#### `ARCHIVE_THRESHOLD_DAYS`

Age threshold for archiving inbox threads.

#### `BATCH_SIZE`

How many candidate threads to process at a time.

#### `MOVE_BATCH_SIZE`

How many threads to move per actual Gmail mutation call. Lower this if your mailbox is large or Apps Script is timing out during trash/archive operations.

#### `REPORT_RECIPIENT_EMAILS`

Who should receive the HTML summary report.

#### `ARCHIVE_IGNORE_LABELS`

Labels that prevent a thread from being archived from the inbox.

#### `INVITE_EXTENSIONS`

Attachment extensions treated as calendar invites.

#### `DRY_RUN`

When `true`, no changes are made. The script still evaluates threads and sends the report.

#### `VERBOSE_LOGS`

When `true`, the script logs detailed timing, batch progress, and step-by-step execution details. This is useful for debugging performance or timeouts.

#### `ENABLE_AUDIT`

When `true`, the script runs the heavier mailbox audit functions and includes the audit sections in the report. When `false`, those sections are skipped to reduce runtime.

#### `NO_USER_LABEL_COUNT_MODE`

Controls how the report counts threads and emails with no user-created Gmail labels.

- `estimate`: fastest; uses the Advanced Gmail service `resultSizeEstimate`
- `exact`: slower; paginates matching Gmail API/GmailApp results for exact counts
- `fallback`: capped GmailApp scan using `NO_USER_LABEL_FALLBACK_MAX_THREADS`

#### `NO_USER_LABEL_QUERY`

Gmail search query used for the no-label count. The default is `has:nouserlabels`.

#### `NO_USER_LABEL_FALLBACK_MAX_THREADS`

Maximum threads to scan when `NO_USER_LABEL_COUNT_MODE` is `fallback` or when the fast Gmail API estimate is unavailable.

#### `NO_USER_LABEL_FALLBACK_COUNT_EMAILS`

When `true`, fallback mode calls `getMessageCount()` on scanned threads. This is more informative but slower.

#### `PROJECT_NAME`, `PROJECT_VERSION`, `PROJECT_COPYRIGHT`, `PROJECT_REPO_URL`, `PROJECT_REPO_TEXT`

Optional values used to customize the report header and footer.

#### `REPORT_SUBJECT_PREFIX`

Prefix used in the summary report email subject.

---

## How to run

The main entry point is:

```javascript
sendReportEmail()
```

This function:

- runs invite cleanup
- runs label cleanup
- runs inbox archiving
- optionally runs mailbox auditing
- sends the final report email

---

## Advanced Gmail service

`NO_USER_LABEL_COUNT_MODE: "estimate"` uses the Advanced Gmail service for a fast count estimate. To enable it:

1. In Apps Script, open **Editor**.
2. Next to **Services**, click **Add a service**.
3. Select **Gmail API**.
4. Keep the identifier as `Gmail`.
5. Click **Add**.

If the execution log says the Gmail API has not been used or is disabled, open the Google Cloud project link shown in the log and enable the Gmail API there too.

If you do not enable the Advanced Gmail service, the script falls back to `GmailApp` counting behavior.

---

## Recommended trigger

Create a daily time-based trigger for:

```javascript
sendReportEmail
```

A common setup is once each morning.

---

## Example workflow

A typical use case might look like this:

- label low-value mail as `subscriptions`, `promotions`, `notifications`, or `orders`
- star anything you want to keep
- let the script run daily
- review the emailed report for:
  - what was deleted
  - what was archived
  - labels that are not yet tied to a rule
  - unlabeled inbox clutter by Gmail category

This creates a lightweight but effective inbox hygiene system.

---

## Reporting

The HTML report includes sections for:

- Invite Cleanup
- Label Cleanup
- Inbox Archive

When `ENABLE_AUDIT` is enabled, it also includes:

- User Labels Audit
- Unruled Labels
- Inbox Threads With No User Label by Gmail Category

In dry-run mode, the report wording changes from:

- `Deleted` → `Would Delete`
- `Archived` → `Would Archive`

That makes testing safer and clearer.

---

## Logging and performance tuning

This project now includes runtime-friendly controls to help with larger Gmail accounts.

### `VERBOSE_LOGS`

When enabled, the script logs:

- phase start and end times
- batch progress
- Gmail search timing
- attachment parsing timing
- move timing

This is useful when diagnosing execution-time limits or slow Gmail operations.

### `MOVE_BATCH_SIZE`

Large `GmailApp.moveThreadsToTrash()` and `GmailApp.moveThreadsToArchive()` calls can be slow. The script now chunks those operations into smaller move batches.

A smaller value means:
- slower total throughput in ideal conditions
- lower risk of a single Gmail mutation call stalling long enough to hit Apps Script time limits

### `ENABLE_AUDIT`

Audit is helpful, but it is also one of the more expensive parts of the script. If you want faster daily runs, disable audit and run it only when needed.

### `NO_USER_LABEL_COUNT_MODE`

The no-label count can be fast or exact:

- `estimate` is best for daily runs. It uses the Advanced Gmail service and returns Gmail API estimates.
- `exact` is useful for occasional manual checks, but can be slow on large mailboxes.
- `fallback` limits the scan using `NO_USER_LABEL_FALLBACK_MAX_THREADS`.

A practical daily-run setup is:

```json
{
  "DRY_RUN": false,
  "VERBOSE_LOGS": false,
  "ENABLE_AUDIT": false,
  "NO_USER_LABEL_COUNT_MODE": "estimate",
  "MOVE_BATCH_SIZE": 20
}
```

For debugging:

```json
{
  "DRY_RUN": true,
  "VERBOSE_LOGS": true,
  "ENABLE_AUDIT": true,
  "NO_USER_LABEL_COUNT_MODE": "fallback"
}
```

---

## Project structure

At the moment, the project is a single Apps Script file, but logically it is organized into these parts:

- **Configuration loading**
- **Entry point**
- **Invite cleanup**
- **Label cleanup**
- **Inbox archive**
- **No-user-label counting**
- **Audit and reporting**
- **Utility helpers**
- **Debug and timing helpers**

A future version may split these into separate modules if the project grows.

---

## Known limitations

- Invite detection currently relies on `.ics` and `.vcs` attachments
- Some calendar-related emails may not expose their event data in a parseable way
- Date parsing handles common iCalendar formats, but not every possible edge case
- Gmail category counts for unlabeled inbox mail can be slower on very large inboxes
- No-user-label estimates are fast but approximate when using Gmail API `resultSizeEstimate`
- Exact no-user-label counts can be slow on large mailboxes
- Gmail mutation calls can still be slow in very large mailboxes, though chunked move operations help
- This project assumes the user’s labels are meaningful cleanup rules; it does not try to infer importance

---

## Recommended best practices

- Start with `DRY_RUN: true`
- Use `CONFIG_JSON` for configuration instead of editing the script
- Keep `LABELS_TO_DELETE` intentional and curated
- Use starring as your override mechanism
- Keep `ARCHIVE_IGNORE_LABELS` small and meaningful
- Use `NO_USER_LABEL_COUNT_MODE: "estimate"` for normal daily runs
- Review the report after the first few live runs
- Add filters in Gmail to automatically apply labels upstream
- Turn off `VERBOSE_LOGS` for normal daily operation
- Turn off `ENABLE_AUDIT` if you want faster recurring runs

---

## Roadmap ideas

Potential future improvements:

- per-label retention rules
- different actions per label (`trash`, `archive`, `skip`)
- sender or domain allowlists
- better recurring invite handling
- config validation
- unit-testable invite parsing helpers
- optional report-only mode
- better performance for very large inboxes
- split scheduled jobs for cleanup vs. audit
- GitHub Actions for linting and docs checks
- more sample config templates

---

## Who this is for

This project is a good fit for people who:

- get a high volume of low-value email
- already use Gmail labels to organize mail
- want aggressive cleanup instead of conservative retention
- prefer simple rules over AI classification
- want a transparent report after each run

---

## Contributing

Contributions are welcome.

Good contribution areas include:

- performance improvements
- better invite parsing
- more flexible rule models
- documentation
- tests
- safer onboarding for new users

If you open a PR, include:

- what changed
- why it changed
- any safety or behavior impact
- example before and after behavior when relevant

---

## License

This project is licensed under the MIT License.

MIT is a permissive license that allows broad reuse, modification, distribution, and private or commercial use with minimal friction, as long as the original copyright and license notice are included.

See the [LICENSE](LICENSE) file for details.

---

## Quick start checklist

- [ ] Create Apps Script project
- [ ] Paste in script
- [ ] Create JSON config from `gmailCleanUp.config.example.json`
- [ ] Add `CONFIG_JSON` in Script Properties
- [ ] Keep `"DRY_RUN": true`
- [ ] Run `sendReportEmail()`
- [ ] Review report
- [ ] Set `"DRY_RUN": false`
- [ ] Tune `MOVE_BATCH_SIZE` if needed
- [ ] Disable `VERBOSE_LOGS` for normal runs
- [ ] Add daily trigger

---

## Disclaimer

This project can automatically move Gmail threads to trash and archive.

Use it carefully, test with dry-run mode first, and review your rules before enabling live mode.
