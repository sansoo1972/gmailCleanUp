# Changelog

All notable changes to this project will be documented in this file.

## 0.3.1 - 2026-06-26

### Changed
- updated the generic script, example configuration, and README to version `0.3.1`
- expanded `.gitignore` to keep generated personal configuration profiles out of version control

## 0.3.0 - 2026-06-26

GitHub issue: [#1](https://github.com/sansoo1972/gmailCleanUp/issues/1)

### Added
- `CONFIG_JSON` Script Property support for configuring the script with one pasted JSON object
- `gmailCleanUp.config.example.json` as a generic configuration template
- no-user-label reporting for threads and emails matching `has:nouserlabels`
- configurable `NO_USER_LABEL_COUNT_MODE` with `estimate`, `exact`, and `fallback` modes
- Advanced Gmail service support for fast no-label count estimates
- optional exact no-label counting through paginated Gmail API/GmailApp scans

### Changed
- replaced hardcoded generic sample settings in `gmailCleanUp.gs` with generic defaults and Script Properties loading
- moved runtime configuration guidance from in-code `CONFIG` editing to JSON-based Script Properties
- updated README installation, configuration, performance, and Advanced Gmail service instructions
- made report title, footer, subject prefix, and no-label query configurable

## 0.2.0 - 2026-04-16

### Added
- `MOVE_BATCH_SIZE` configuration to split Gmail trash/archive operations into smaller chunks
- `VERBOSE_LOGS` configuration for detailed timing and progress logs
- `ENABLE_AUDIT` configuration to optionally skip heavier audit/reporting work
- soft-timeout warning logs to help identify long-running executions
- timing and progress helper functions for debugging Gmail performance issues

### Changed
- updated the generic script to use chunked move operations for better reliability on larger mailboxes
- made audit sections optional in the HTML report
- updated the generic configuration and documentation to reflect new runtime and debugging controls
- improved README guidance around performance tuning, logging, and audit behavior

## 0.1.0 - 2026-04-14

### Added
- Initial public project structure
- Label-based Gmail cleanup rules
- Invite-aware email deletion using `.ics` and `.vcs` attachments
- Inbox archiving for stale threads
- Dry-run mode for safe testing
- HTML summary reporting
- Audit reporting for:
  - user labels without matching rules
  - unlabeled inbox threads by Gmail category
