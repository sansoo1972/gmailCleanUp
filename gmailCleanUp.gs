// ================================
// Gmail Cleanup Automation
// Generic / Repo-Friendly Version
// ================================
//
// Behavior summary:
// 1. Delete threads in specific labels after N days unless starred.
// 2. Delete invite emails if:
//    - they are read and older than INVITE_READ_DELETE_DAYS, or
//    - the event in the .ics/.vcs file is already in the past
//    - starred invites are always preserved
// 3. Archive inbox threads older than ARCHIVE_THRESHOLD_DAYS unless:
//    - starred
//    - they contain an invite attachment
//    - they have a protected label
// 4. Email a summary report after each run.
// 5. Report labels found that are not associated with any rule.
// 6. Report inbox counts by Gmail category for threads with no user label.
// 7. Safely skip unreadable label objects instead of failing the run.
//
// Recommended trigger: daily
// ================================


// --- Configuration ---

const CONFIG = {
  // Labels whose threads should be moved to Trash after DELETE_THRESHOLD_DAYS
  // unless the thread contains a starred message.
  LABELS_TO_DELETE: [
    "webads",
    "subscriptions",
    "promotions",
    "notifications",
    "customer service",
    "orders",
    "travel",
    "financial",
    "medical",
    "jobs"
  ],

  // Threads with labels in LABELS_TO_DELETE older than this many days
  // will be moved to Trash unless starred.
  DELETE_THRESHOLD_DAYS: 2,

  // Invite threads with no unread messages older than this many days
  // will be moved to Trash unless starred.
  INVITE_READ_DELETE_DAYS: 2,

  // Inbox threads older than this many days will be archived unless they
  // are starred, contain invite attachments, or have a protected label.
  ARCHIVE_THRESHOLD_DAYS: 10,

  // Number of threads to process per batch.
  BATCH_SIZE: 100,

  // One or more addresses to receive the HTML report.
  REPORT_RECIPIENT_EMAILS: [
    "you@example.com"
  ],

  // Labels that prevent Inbox threads from being archived.
  ARCHIVE_IGNORE_LABELS: [
    "personal",
    "important",
    "vip"
  ],

  // Attachment extensions treated as calendar invites.
  INVITE_EXTENSIONS: [".ics", ".vcs"],

  // Set to true to test the script without making any Gmail changes.
  DRY_RUN: true,

  // Optional project footer shown in the HTML report.
  PROJECT_NAME: "Gmail Cleanup Automation",
  PROJECT_VERSION: "Generic",
  PROJECT_COPYRIGHT: "&copy; 2026 YourName",
  PROJECT_REPO_URL: "https://github.com/yourusername/gmailCleanUp",
  PROJECT_REPO_TEXT: "Project Repository"
};


// --- Entry Point ---

function sendReportEmail() {
  Logger.log("Starting Gmail Cleanup Automation...");
  const startedAt = new Date();

  const inviteReport = cleanUpInvites();
  const labelCleanupReport = cleanUpLabeledThreads();
  const archiveReport = archiveInbox();
  const auditReport = auditMailbox();

  const finishedAt = new Date();
  const durationSeconds = Math.round((finishedAt - startedAt) / 1000);

  const htmlBody = buildHtmlReport({
    startedAt,
    finishedAt,
    durationSeconds,
    inviteReport,
    labelCleanupReport,
    archiveReport,
    auditReport
  });

  const recipients = CONFIG.REPORT_RECIPIENT_EMAILS.join(",");

  GmailApp.sendEmail(
    recipients,
    `${CONFIG.PROJECT_NAME} Report - ${startedAt.toDateString()}`,
    "Your Gmail cleanup report is available in HTML format.",
    { htmlBody: htmlBody }
  );

  Logger.log(`Report sent to: ${recipients}`);
}


// --- Invite Cleanup ---

function cleanUpInvites() {
  Logger.log("Starting invite cleanup...");

  const report = {
    deletedReadAndOld: 0,
    deletedPastEvent: 0,
    skippedStarred: 0,
    skippedStillActionable: 0,
    failed: 0,
    processedThreads: 0
  };

  const query = `has:attachment filename:(.ics OR .vcs)`;
  const threads = GmailApp.search(query);

  Logger.log(`Found ${threads.length} threads with potential invite attachments.`);

  for (let i = 0; i < threads.length; i += CONFIG.BATCH_SIZE) {
    const batch = threads.slice(i, i + CONFIG.BATCH_SIZE);
    const threadsToTrash = [];

    for (const thread of batch) {
      report.processedThreads++;

      try {
        if (thread.hasStarredMessages()) {
          report.skippedStarred++;
          continue;
        }

        const decision = evaluateInviteThreadForDeletion(thread);

        if (decision.deleteThread) {
          threadsToTrash.push(thread);

          if (decision.reason === "read_and_old") {
            report.deletedReadAndOld++;
          } else if (decision.reason === "past_event") {
            report.deletedPastEvent++;
          }
        } else {
          report.skippedStillActionable++;
        }
      } catch (err) {
        report.failed++;
        Logger.log(`Invite cleanup failed for thread ${thread.getId()}: ${err.message}`);
      }
    }

    moveThreadsToTrash(threadsToTrash);
  }

  Logger.log(`Invite cleanup complete: ${JSON.stringify(report)}`);
  return report;
}

function evaluateInviteThreadForDeletion(thread) {
  const now = new Date();
  const lastMessageDate = thread.getLastMessageDate();
  const ageInDays = daysBetween(lastMessageDate, now);

  const messages = thread.getMessages();

  let hasInvite = false;
  let hasUnreadMessage = false;
  let mostRecentInviteEnd = null;

  for (const msg of messages) {
    if (msg.isUnread()) {
      hasUnreadMessage = true;
    }

    const inviteInfo = getInviteInfoFromMessage(msg);
    if (inviteInfo.hasInvite) {
      hasInvite = true;

      if (inviteInfo.endDate && (!mostRecentInviteEnd || inviteInfo.endDate > mostRecentInviteEnd)) {
        mostRecentInviteEnd = inviteInfo.endDate;
      }
    }
  }

  if (!hasInvite) {
    return { deleteThread: false, reason: "no_invite_found" };
  }

  if (!hasUnreadMessage && ageInDays >= CONFIG.INVITE_READ_DELETE_DAYS) {
    return { deleteThread: true, reason: "read_and_old" };
  }

  if (mostRecentInviteEnd && mostRecentInviteEnd < now) {
    return { deleteThread: true, reason: "past_event" };
  }

  return { deleteThread: false, reason: "still_actionable" };
}

function getInviteInfoFromMessage(message) {
  const attachments = message.getAttachments({
    includeInlineImages: false,
    includeAttachments: true
  });

  let latestEndDate = null;
  let foundInvite = false;

  for (const attachment of attachments) {
    const name = (attachment.getName() || "").toLowerCase();

    if (!CONFIG.INVITE_EXTENSIONS.some(ext => name.endsWith(ext))) {
      continue;
    }

    foundInvite = true;

    try {
      const content = attachment.getDataAsString();
      const parsed = parseInviteDates(content);

      if (parsed.endDate && (!latestEndDate || parsed.endDate > latestEndDate)) {
        latestEndDate = parsed.endDate;
      }
    } catch (err) {
      Logger.log(`Could not parse invite attachment "${name}": ${err.message}`);
    }
  }

  return {
    hasInvite: foundInvite,
    endDate: latestEndDate
  };
}

function parseInviteDates(icsText) {
  const unfolded = unfoldICalendarLines(icsText);

  const dtStartRaw = extractICalendarField(unfolded, "DTSTART");
  const dtEndRaw = extractICalendarField(unfolded, "DTEND");

  const startDate = dtStartRaw ? parseICalendarDate(dtStartRaw) : null;
  const endDate = dtEndRaw ? parseICalendarDate(dtEndRaw) : null;

  return {
    startDate: startDate,
    endDate: endDate || startDate
  };
}

function unfoldICalendarLines(text) {
  return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

function extractICalendarField(text, fieldName) {
  const regex = new RegExp(`^${fieldName}(?:;[^:]+)?:([^\\r\\n]+)`, "mi");
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

function parseICalendarDate(value) {
  const clean = value.trim();

  if (/^\d{8}$/.test(clean)) {
    const year = Number(clean.slice(0, 4));
    const month = Number(clean.slice(4, 6)) - 1;
    const day = Number(clean.slice(6, 8));
    return new Date(year, month, day, 23, 59, 59);
  }

  if (/^\d{8}T\d{6}Z$/.test(clean)) {
    const year = Number(clean.slice(0, 4));
    const month = Number(clean.slice(4, 6)) - 1;
    const day = Number(clean.slice(6, 8));
    const hour = Number(clean.slice(9, 11));
    const minute = Number(clean.slice(11, 13));
    const second = Number(clean.slice(13, 15));
    return new Date(Date.UTC(year, month, day, hour, minute, second));
  }

  if (/^\d{8}T\d{6}$/.test(clean)) {
    const year = Number(clean.slice(0, 4));
    const month = Number(clean.slice(4, 6)) - 1;
    const day = Number(clean.slice(6, 8));
    const hour = Number(clean.slice(9, 11));
    const minute = Number(clean.slice(11, 13));
    const second = Number(clean.slice(13, 15));
    return new Date(year, month, day, hour, minute, second);
  }

  return null;
}


// --- Label Cleanup ---

function cleanUpLabeledThreads() {
  Logger.log("Starting labeled thread cleanup...");

  const results = [];

  for (const labelName of CONFIG.LABELS_TO_DELETE) {
    let label = null;

    try {
      label = GmailApp.getUserLabelByName(labelName);
    } catch (err) {
      Logger.log(`Error reading label "${labelName}": ${err.message}`);
      results.push({
        label: labelName,
        deleted: 0,
        skipped: 0,
        failed: 1,
        status: "Label Read Error"
      });
      continue;
    }

    if (!label) {
      results.push({
        label: labelName,
        deleted: 0,
        skipped: 0,
        failed: 0,
        status: "Label Not Found"
      });
      continue;
    }

    const query = `label:"${labelName}" older_than:${CONFIG.DELETE_THRESHOLD_DAYS}d -is:starred`;
    const threads = GmailApp.search(query);

    let deleted = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < threads.length; i += CONFIG.BATCH_SIZE) {
      const batch = threads.slice(i, i + CONFIG.BATCH_SIZE);
      const threadsToTrash = [];

      for (const thread of batch) {
        try {
          if (thread.hasStarredMessages()) {
            skipped++;
            continue;
          }

          threadsToTrash.push(thread);
        } catch (err) {
          failed++;
          Logger.log(`Label cleanup failed for thread ${thread.getId()} in "${labelName}": ${err.message}`);
        }
      }

      moveThreadsToTrash(threadsToTrash);
      deleted += threadsToTrash.length;
    }

    results.push({
      label: labelName,
      deleted: deleted,
      skipped: skipped,
      failed: failed,
      status: "Completed"
    });
  }

  Logger.log("Labeled thread cleanup complete.");
  return results;
}


// --- Inbox Archive ---

function archiveInbox() {
  Logger.log("Starting inbox archive...");

  const query = `in:inbox older_than:${CONFIG.ARCHIVE_THRESHOLD_DAYS}d -is:starred`;
  const threads = GmailApp.search(query);

  const result = {
    archived: 0,
    skippedStarred: 0,
    skippedInvite: 0,
    skippedProtectedLabel: 0,
    failed: 0
  };

  for (let i = 0; i < threads.length; i += CONFIG.BATCH_SIZE) {
    const batch = threads.slice(i, i + CONFIG.BATCH_SIZE);
    const threadsToArchive = [];

    for (const thread of batch) {
      try {
        if (thread.hasStarredMessages()) {
          result.skippedStarred++;
          continue;
        }

        if (threadHasProtectedArchiveLabel(thread)) {
          result.skippedProtectedLabel++;
          continue;
        }

        if (threadContainsInviteAttachment(thread)) {
          result.skippedInvite++;
          continue;
        }

        threadsToArchive.push(thread);
      } catch (err) {
        result.failed++;
        Logger.log(`Archive failed for thread ${thread.getId()}: ${err.message}`);
      }
    }

    moveThreadsToArchive(threadsToArchive);
    result.archived += threadsToArchive.length;
  }

  Logger.log(`Inbox archive complete: ${JSON.stringify(result)}`);
  return result;
}

function threadHasProtectedArchiveLabel(thread) {
  const protectedLabels = CONFIG.ARCHIVE_IGNORE_LABELS.map(l => l.toLowerCase());
  const labels = [];

  for (const label of thread.getLabels()) {
    try {
      const name = label.getName();
      if (name) {
        labels.push(name.toLowerCase());
      }
    } catch (err) {
      Logger.log(`Skipping unreadable thread label: ${err.message}`);
    }
  }

  return labels.some(label => protectedLabels.includes(label));
}

function threadContainsInviteAttachment(thread) {
  const messages = thread.getMessages();

  for (const msg of messages) {
    const attachments = msg.getAttachments({
      includeInlineImages: false,
      includeAttachments: true
    });

    for (const attachment of attachments) {
      const name = (attachment.getName() || "").toLowerCase();
      if (CONFIG.INVITE_EXTENSIONS.some(ext => name.endsWith(ext))) {
        return true;
      }
    }
  }

  return false;
}


// --- Audit / Reporting Helpers ---

function auditMailbox() {
  Logger.log("Starting mailbox audit...");

  const labelAudit = getUnruledUserLabels();
  const unlabeledByCategory = getUnlabeledInboxCountsByCategory();

  const totalUnlabeledInboxThreads = Object.values(unlabeledByCategory)
    .reduce((sum, count) => sum + count, 0);

  const report = {
    unruledLabels: labelAudit.unruledLabels,
    unruledLabelCount: labelAudit.unruledLabels.length,
    unreadableLabelCount: labelAudit.unreadableLabelCount,
    unlabeledByCategory: unlabeledByCategory,
    totalUnlabeledInboxThreads: totalUnlabeledInboxThreads
  };

  Logger.log(`Mailbox audit complete: ${JSON.stringify(report)}`);
  return report;
}

function getUnruledUserLabels() {
  const rawLabels = GmailApp.getUserLabels();
  const allUserLabels = [];
  let unreadableLabelCount = 0;

  for (const label of rawLabels) {
    try {
      const name = label.getName();
      if (name && typeof name === "string") {
        allUserLabels.push(name);
      }
    } catch (err) {
      unreadableLabelCount++;
      Logger.log(`Skipping unreadable label object: ${err.message}`);
    }
  }

  allUserLabels.sort((a, b) => a.localeCompare(b));

  const ruledLabels = new Set([
    ...CONFIG.LABELS_TO_DELETE.map(l => l.toLowerCase()),
    ...CONFIG.ARCHIVE_IGNORE_LABELS.map(l => l.toLowerCase())
  ]);

  const unruledLabels = allUserLabels.filter(
    labelName => !ruledLabels.has(labelName.toLowerCase())
  );

  return {
    unruledLabels: unruledLabels,
    unreadableLabelCount: unreadableLabelCount
  };
}

function getUnlabeledInboxCountsByCategory() {
  const categoryQueries = {
    Primary: "in:inbox category:primary",
    Social: "in:inbox category:social",
    Promotions: "in:inbox category:promotions",
    Updates: "in:inbox category:updates",
    Forums: "in:inbox category:forums"
  };

  const counts = {};

  for (const [categoryName, query] of Object.entries(categoryQueries)) {
    const threads = GmailApp.search(query);
    let unlabeledCount = 0;

    for (const thread of threads) {
      try {
        const labels = thread.getLabels();
        if (!labels || labels.length === 0) {
          unlabeledCount++;
        }
      } catch (err) {
        Logger.log(`Could not inspect labels for thread ${thread.getId()} in category "${categoryName}": ${err.message}`);
      }
    }

    counts[categoryName] = unlabeledCount;
  }

  return counts;
}


// --- Report Builder ---

function buildHtmlReport(data) {
  const {
    startedAt,
    finishedAt,
    durationSeconds,
    inviteReport,
    labelCleanupReport,
    archiveReport,
    auditReport
  } = data;

  const isDryRun = CONFIG.DRY_RUN;
  const trashVerb = isDryRun ? "Would Delete" : "Deleted";
  const archiveVerb = isDryRun ? "Would Archive" : "Archived";

  const labelRows = labelCleanupReport.map(r => `
    <tr>
      <td>${escapeHtml(r.label)}</td>
      <td>${r.deleted}</td>
      <td>${r.skipped}</td>
      <td>${r.failed}</td>
      <td>${escapeHtml(r.status)}</td>
    </tr>
  `).join("");

  const unruledLabelRows = auditReport.unruledLabels.length
    ? auditReport.unruledLabels.map(label => `
        <tr>
          <td>${escapeHtml(label)}</td>
        </tr>
      `).join("")
    : `
        <tr>
          <td>&#x2705; None</td>
        </tr>
      `;

  const categoryRows = Object.entries(auditReport.unlabeledByCategory).map(([category, count]) => `
    <tr>
      <td>${escapeHtml(category)}</td>
      <td>${count}</td>
    </tr>
  `).join("");

  const footerLink = CONFIG.PROJECT_REPO_URL
    ? ` &nbsp;|&nbsp; <a href="${escapeHtml(CONFIG.PROJECT_REPO_URL)}" target="_blank" style="color:#666;text-decoration:underline;">${escapeHtml(CONFIG.PROJECT_REPO_TEXT || CONFIG.PROJECT_REPO_URL)}</a>`
    : "";

  return `
    <html>
      <head>
        <meta charset="UTF-8">
      </head>
      <body style="font-family:Arial,sans-serif;color:#333;line-height:1.4;">
        <h2 style="margin-bottom:8px;">&#x1F9F9; ${escapeHtml(CONFIG.PROJECT_NAME)} - ${escapeHtml(CONFIG.PROJECT_VERSION)}</h2>

        <p style="margin-top:0;">
          <strong>&#x1F552; Started:</strong> ${escapeHtml(startedAt)}<br>
          <strong>&#x2705; Finished:</strong> ${escapeHtml(finishedAt)}<br>
          <strong>&#x23F1;&#xFE0F; Duration:</strong> ${durationSeconds} seconds<br>
          <strong>${isDryRun ? "&#x1F9EA; Mode:" : "&#x1F680; Mode:"}</strong>
          ${isDryRun ? "Dry Run (no changes made)" : "Live Run"}
        </p>

        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;width:100%;">
          <tr style="background:#f2f2f2;">
            <th colspan="6" style="text-align:left;">&#x1F4C5; Invite Cleanup</th>
          </tr>
          <tr style="background:#f2f2f2;">
            <th>&#x1F4E6; Processed Threads</th>
            <th>&#x1F5D1;&#xFE0F; ${trashVerb}: Read &amp; Old</th>
            <th>&#x1F4C6; ${trashVerb}: Past Event</th>
            <th>&#x2B50; Skipped: Starred</th>
            <th>&#x23F3; Skipped: Still Actionable</th>
            <th>&#x274C; Failed</th>
          </tr>
          <tr>
            <td>${inviteReport.processedThreads}</td>
            <td>${inviteReport.deletedReadAndOld}</td>
            <td>${inviteReport.deletedPastEvent}</td>
            <td>${inviteReport.skippedStarred}</td>
            <td>${inviteReport.skippedStillActionable}</td>
            <td>${inviteReport.failed}</td>
          </tr>
        </table>

        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;width:100%;">
          <tr style="background:#f2f2f2;">
            <th colspan="5" style="text-align:left;">&#x1F3F7;&#xFE0F; Label Cleanup</th>
          </tr>
          <tr style="background:#f2f2f2;">
            <th>&#x1F3F7;&#xFE0F; Label</th>
            <th>&#x1F5D1;&#xFE0F; ${trashVerb}</th>
            <th>&#x23ED;&#xFE0F; Skipped</th>
            <th>&#x274C; Failed</th>
            <th>&#x1F4CC; Status</th>
          </tr>
          ${labelRows}
        </table>

        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;width:100%;">
          <tr style="background:#f2f2f2;">
            <th colspan="5" style="text-align:left;">&#x1F4E5; Inbox Archive</th>
          </tr>
          <tr style="background:#f2f2f2;">
            <th>&#x1F4E6; ${archiveVerb}</th>
            <th>&#x2B50; Skipped: Starred</th>
            <th>&#x1F4C5; Skipped: Invite</th>
            <th>&#x1F6E1;&#xFE0F; Skipped: Protected Label</th>
            <th>&#x274C; Failed</th>
          </tr>
          <tr>
            <td>${archiveReport.archived}</td>
            <td>${archiveReport.skippedStarred}</td>
            <td>${archiveReport.skippedInvite}</td>
            <td>${archiveReport.skippedProtectedLabel}</td>
            <td>${archiveReport.failed}</td>
          </tr>
        </table>

        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;width:100%;">
          <tr style="background:#f2f2f2;">
            <th colspan="2" style="text-align:left;">&#x1F9ED; User Labels Audit</th>
          </tr>
          <tr style="background:#f2f2f2;">
            <th>Item</th>
            <th>Count</th>
          </tr>
          <tr>
            <td>Labels found without a matching rule</td>
            <td>${auditReport.unruledLabelCount}</td>
          </tr>
          <tr style="background:#fafafa;">
            <td>Unreadable label objects skipped</td>
            <td>${auditReport.unreadableLabelCount || 0}</td>
          </tr>
        </table>

        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;width:100%;">
          <tr style="background:#f2f2f2;">
            <th colspan="1" style="text-align:left;">&#x1F4CB; Unruled Labels</th>
          </tr>
          ${unruledLabelRows}
        </table>

        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;width:100%;">
          <tr style="background:#f2f2f2;">
            <th colspan="2" style="text-align:left;">&#x1F4C2; Inbox Threads With No User Label by Gmail Category</th>
          </tr>
          <tr style="background:#f2f2f2;">
            <th>&#x1F4C1; Category</th>
            <th>&#x1F522; Count</th>
          </tr>
          ${categoryRows}
          <tr style="background:#fafafa;font-weight:bold;">
            <td>&#x1F9EE; Total</td>
            <td>${auditReport.totalUnlabeledInboxThreads}</td>
          </tr>
        </table>

        <p style="font-size:0.9em;color:#666;margin-top:20px;">
          &#x2728; Generated by ${escapeHtml(CONFIG.PROJECT_NAME)}${CONFIG.PROJECT_VERSION ? ` - ${escapeHtml(CONFIG.PROJECT_VERSION)}` : ""}
          ${CONFIG.PROJECT_COPYRIGHT ? ` &nbsp;|&nbsp; ${CONFIG.PROJECT_COPYRIGHT}` : ""}${footerLink}
        </p>
      </body>
    </html>
  `;
}


// --- Utility Functions ---

function moveThreadsToTrash(threads) {
  if (!threads || threads.length === 0) return;

  if (CONFIG.DRY_RUN) {
    Logger.log(`[DRY RUN] Would move ${threads.length} thread(s) to trash.`);
    return;
  }

  GmailApp.moveThreadsToTrash(threads);
}

function moveThreadsToArchive(threads) {
  if (!threads || threads.length === 0) return;

  if (CONFIG.DRY_RUN) {
    Logger.log(`[DRY RUN] Would archive ${threads.length} thread(s).`);
    return;
  }

  GmailApp.moveThreadsToArchive(threads);
}

function daysBetween(olderDate, newerDate) {
  return Math.floor((newerDate.getTime() - olderDate.getTime()) / (1000 * 60 * 60 * 24));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
