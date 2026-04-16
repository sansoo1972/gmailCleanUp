# Changelog

All notable changes to this project will be documented in this file.

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
