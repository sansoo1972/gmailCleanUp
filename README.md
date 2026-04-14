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
- HTML email report after each run
- Audit reporting for:
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

The script runs in three main phases:

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

### 4. Reporting and audit

After cleanup, the script emails an HTML summary report showing:

- invite cleanup results
- label cleanup results
- inbox archive results
- labels found that do not match any configured rule
- inbox threads with no user label by Gmail category

---

## Safety model

This project is intentionally aggressive, but it still has a few built-in guardrails:

- **Starred threads are always preserved**
- **Dry-run mode** lets you test without making changes
- Invite cleanup checks event dates when possible
- Inbox archiving can ignore protected labels

If you are testing for the first time, start with:

```javascript
DRY_RUN: true
```

Then review the emailed report before turning live mode on.

---

## Requirements

- A Gmail account
- Google Apps Script
- Permission to access Gmail in Apps Script

No external services or libraries are required.

---

## Installation

1. Create a new Google Apps Script project.
2. Paste in the contents of the script.
3. Update the configuration section to match your Gmail labels and preferences.
4. Save the project.
5. Run `sendReportEmail()` manually once to authorize Gmail access.
6. Review the report.
7. Create a time-based trigger to run daily.

---

## Configuration

The main behavior is controlled through the `CONFIG` object.

### Example

```javascript
const CONFIG = {
  LABELS_TO_DELETE: [
    "webads",
    "customer service",
    "travel"
  ],

  DELETE_THRESHOLD_DAYS: 2,
  INVITE_READ_DELETE_DAYS: 2,
  ARCHIVE_THRESHOLD_DAYS: 10,
  BATCH_SIZE: 100,

  REPORT_RECIPIENT_EMAILS: [
    "your@email.com"
  ],

  ARCHIVE_IGNORE_LABELS: [
    "personal",
    "important-client-label"
  ],

  INVITE_EXTENSIONS: [".ics", ".vcs"],

  DRY_RUN: false
};
```

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

How many threads to process at a time.

#### `REPORT_RECIPIENT_EMAILS`

Who should receive the HTML summary report.

#### `ARCHIVE_IGNORE_LABELS`

Labels that prevent a thread from being archived from the inbox.

#### `INVITE_EXTENSIONS`

Attachment extensions treated as calendar invites.

#### `DRY_RUN`

When `true`, no changes are made. The script still evaluates threads and sends the report.

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
- runs mailbox auditing
- sends the final report email

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

- label low-value mail as `webads`, `political`, `travel`, `subscribed`, or `customer service`
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
- User Labels Found Without a Matching Rule
- Inbox Threads With No User Label by Gmail Category

In dry-run mode, the report wording changes from:

- `Deleted` → `Would Delete`
- `Archived` → `Would Archive`

That makes testing safer and clearer.

---

## Project structure

At the moment, the project is a single Apps Script file, but logically it is organized into these parts:

- **Configuration**
- **Entry point**
- **Invite cleanup**
- **Label cleanup**
- **Inbox archive**
- **Audit and reporting**
- **Utility helpers**

A future version may split these into separate modules if the project grows.

---

## Known limitations

- Invite detection currently relies on `.ics` and `.vcs` attachments
- Some calendar-related emails may not expose their event data in a parseable way
- Date parsing handles common iCalendar formats, but not every possible edge case
- Gmail category counts for unlabeled inbox mail can be slower on very large inboxes
- This project assumes the user’s labels are meaningful cleanup rules; it does not try to infer importance

---

## Recommended best practices

- Start with `DRY_RUN: true`
- Keep `LABELS_TO_DELETE` intentional and curated
- Use starring as your override mechanism
- Keep `ARCHIVE_IGNORE_LABELS` small and meaningful
- Review the report after the first few live runs
- Add filters in Gmail to automatically apply labels upstream

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
- GitHub Actions for linting and docs checks
- sample config templates

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

Choose the license that fits your goals.

A common default is:

- MIT License

If you want broad reuse with minimal friction, MIT is a strong choice.

---

## Quick start checklist

- [ ] Create Apps Script project
- [ ] Paste in script
- [ ] Update config
- [ ] Set `DRY_RUN: true`
- [ ] Run `sendReportEmail()`
- [ ] Review report
- [ ] Set `DRY_RUN: false`
- [ ] Add daily trigger

---

## Disclaimer

This project can automatically move Gmail threads to trash and archive.

Use it carefully, test with dry-run mode first, and review your rules before enabling live mode.
