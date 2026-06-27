// ================================
// Gmail Cleanup Automation
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
// 5. Optionally report labels found that are not associated with any rule.
// 6. Optionally report inbox counts by Gmail category for threads with no user label.
// 7. Safely skip unreadable label objects instead of failing the run.
//
// Recommended trigger: daily
// ================================

// --- Configuration ---
// Runtime values are loaded from Apps Script Project Settings > Script properties.
// Preferred: set one CONFIG_JSON Script Property with the JSON config contents.
// Individual Script Properties can also override values by key.

const CONFIG_DEFAULTS = {
  LABELS_TO_DELETE: [],
  DELETE_THRESHOLD_DAYS: 2,
  INVITE_READ_DELETE_DAYS: 2,
  ARCHIVE_THRESHOLD_DAYS: 10,
  BATCH_SIZE: 100,
  MOVE_BATCH_SIZE: 20,
  REPORT_RECIPIENT_EMAILS: [],
  ARCHIVE_IGNORE_LABELS: [],
  INVITE_EXTENSIONS: [".ics", ".vcs"],
  DRY_RUN: true,
  VERBOSE_LOGS: false,
  ENABLE_AUDIT: false,
  NO_USER_LABEL_COUNT_MODE: "estimate",
  NO_USER_LABEL_QUERY: "has:nouserlabels",
  NO_USER_LABEL_FALLBACK_MAX_THREADS: 500,
  NO_USER_LABEL_FALLBACK_COUNT_EMAILS: false,
  PROJECT_NAME: "Gmail Cleanup Automation",
  PROJECT_VERSION: "0.3.1",
  PROJECT_COPYRIGHT: "",
  PROJECT_REPO_URL: "",
  PROJECT_REPO_TEXT: "Project Repository",
  REPORT_SUBJECT_PREFIX: "Gmail Cleanup Report",
};

const CONFIG_TYPES = {
  arrays: [
    "LABELS_TO_DELETE",
    "REPORT_RECIPIENT_EMAILS",
    "ARCHIVE_IGNORE_LABELS",
    "INVITE_EXTENSIONS",
  ],
  numbers: [
    "DELETE_THRESHOLD_DAYS",
    "INVITE_READ_DELETE_DAYS",
    "ARCHIVE_THRESHOLD_DAYS",
    "BATCH_SIZE",
    "MOVE_BATCH_SIZE",
    "NO_USER_LABEL_FALLBACK_MAX_THREADS",
  ],
  booleans: [
    "DRY_RUN",
    "VERBOSE_LOGS",
    "ENABLE_AUDIT",
    "NO_USER_LABEL_FALLBACK_COUNT_EMAILS",
  ],
};

const CONFIG = loadConfig();

function loadConfig() {
  const config = Object.assign({}, CONFIG_DEFAULTS);
  const properties = getScriptProperties();
  const jsonConfig = parseConfigJson(properties.CONFIG_JSON);

  applyConfigValues(config, jsonConfig);
  applyConfigValues(config, properties);

  return config;
}

function applyConfigValues(config, values) {
  for (const key of Object.keys(config)) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      continue;
    }

    config[key] = parseConfigValue(key, values[key], config[key]);
  }
}

function getScriptProperties() {
  if (typeof PropertiesService === "undefined") {
    return {};
  }

  return PropertiesService.getScriptProperties().getProperties();
}

function parseConfigJson(rawValue) {
  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch (err) {
    Logger.log(`[CONFIG] ERROR: Could not parse CONFIG_JSON: ${err.message}`);
    return {};
  }
}

function parseConfigValue(key, rawValue, defaultValue) {
  if (Array.isArray(rawValue)) {
    return CONFIG_TYPES.arrays.includes(key)
      ? rawValue.map((item) => String(item).trim()).filter(Boolean)
      : rawValue;
  }

  if (typeof rawValue === "number") {
    return CONFIG_TYPES.numbers.includes(key) ? rawValue : String(rawValue);
  }

  if (typeof rawValue === "boolean") {
    return CONFIG_TYPES.booleans.includes(key) ? rawValue : String(rawValue);
  }

  if (CONFIG_TYPES.arrays.includes(key)) {
    return parseConfigList(rawValue);
  }

  if (CONFIG_TYPES.numbers.includes(key)) {
    return parseConfigNumber(rawValue, defaultValue);
  }

  if (CONFIG_TYPES.booleans.includes(key)) {
    return parseConfigBoolean(rawValue, defaultValue);
  }

  return String(rawValue);
}

function parseConfigList(rawValue) {
  const value = String(rawValue || "").trim();

  if (!value) {
    return [];
  }

  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch (err) {
      Logger.log(`[CONFIG] ERROR: Could not parse JSON list: ${err.message}`);
    }
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseConfigNumber(rawValue, defaultValue) {
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : defaultValue;
}

function parseConfigBoolean(rawValue, defaultValue) {
  const value = String(rawValue).trim().toLowerCase();

  if (["true", "yes", "1", "on"].includes(value)) {
    return true;
  }

  if (["false", "no", "0", "off"].includes(value)) {
    return false;
  }

  return defaultValue;
}

function validateConfig() {
  const errors = [];
  const validNoUserLabelModes = ["estimate", "exact", "fallback"];

  if (!CONFIG.REPORT_RECIPIENT_EMAILS.length) {
    errors.push("REPORT_RECIPIENT_EMAILS must include at least one email address.");
  }

  if (!validNoUserLabelModes.includes(CONFIG.NO_USER_LABEL_COUNT_MODE)) {
    errors.push(
      `NO_USER_LABEL_COUNT_MODE must be one of: ${validNoUserLabelModes.join(", ")}.`,
    );
  }

  if (CONFIG.BATCH_SIZE < 1) {
    errors.push("BATCH_SIZE must be 1 or greater.");
  }

  if (CONFIG.MOVE_BATCH_SIZE < 1) {
    errors.push("MOVE_BATCH_SIZE must be 1 or greater.");
  }

  if (errors.length) {
    throw new Error(`Invalid Gmail cleanup configuration: ${errors.join(" ")}`);
  }
}

// --- Debug Timing Globals ---

const SCRIPT_START_MS = Date.now();
const SOFT_TIMEOUT_MS = 5 * 60 * 1000; // warn around 5 min

// --- Entry Point ---

function sendReportEmail() {
  validateConfig();

  const overallStart = startTimer("MAIN", "sendReportEmail");
  logVerbose("MAIN", "Starting Gmail Cleanup Automation...");

  const startedAt = new Date();

  const inviteStart = startTimer("MAIN", "cleanUpInvites");
  const inviteReport = cleanUpInvites();
  endTimer("MAIN", "cleanUpInvites", inviteStart);

  const labelStart = startTimer("MAIN", "cleanUpLabeledThreads");
  const labelCleanupReport = cleanUpLabeledThreads();
  endTimer("MAIN", "cleanUpLabeledThreads", labelStart);

  const archiveStart = startTimer("MAIN", "archiveInbox");
  const archiveReport = archiveInbox();
  endTimer("MAIN", "archiveInbox", archiveStart);

  const noUserLabelStart = startTimer("MAIN", "countNoUserLabelEmails");
  const noUserLabelReport = countNoUserLabelEmails();
  endTimer("MAIN", "countNoUserLabelEmails", noUserLabelStart);

  let auditReport = getEmptyAuditReport();

  if (CONFIG.ENABLE_AUDIT) {
    const auditStart = startTimer("MAIN", "auditMailbox");
    auditReport = auditMailbox();
    endTimer("MAIN", "auditMailbox", auditStart);
  }

  const finishedAt = new Date();
  const durationSeconds = Math.round((finishedAt - startedAt) / 1000);

  const reportStart = startTimer("MAIN", "buildHtmlReport");
  const htmlBody = buildHtmlReport({
    startedAt,
    finishedAt,
    durationSeconds,
    inviteReport,
    labelCleanupReport,
    archiveReport,
    noUserLabelReport,
    auditReport,
  });
  endTimer("MAIN", "buildHtmlReport", reportStart);

  const recipients = CONFIG.REPORT_RECIPIENT_EMAILS.join(",");

  const emailStart = startTimer("MAIN", `sendEmail to ${recipients}`);
  GmailApp.sendEmail(
    recipients,
    `${CONFIG.REPORT_SUBJECT_PREFIX} - ${startedAt.toDateString()}`,
    "Your Gmail cleanup report is available in HTML format.",
    { htmlBody: htmlBody },
  );
  endTimer("MAIN", `sendEmail to ${recipients}`, emailStart);

  endTimer("MAIN", "sendReportEmail", overallStart);
}

// --- Invite Cleanup ---

function cleanUpInvites() {
  const fnStart = startTimer("INVITES", "cleanUpInvites");
  logVerbose("INVITES", "Starting invite cleanup...");

  const report = {
    deletedReadAndOld: 0,
    deletedPastEvent: 0,
    skippedStarred: 0,
    skippedStillActionable: 0,
    failed: 0,
    processedThreads: 0,
  };

  const query = `has:attachment filename:(.ics OR .vcs)`;
  const searchStart = startTimer("INVITES", `GmailApp.search(${query})`);
  const threads = GmailApp.search(query);
  endTimer("INVITES", `GmailApp.search(${query})`, searchStart);

  logVerbose("INVITES", `Found ${threads.length} invite candidate threads.`);

  for (let i = 0; i < threads.length; i += CONFIG.BATCH_SIZE) {
    warnIfApproachingTimeout("INVITES");

    const batchNum = Math.floor(i / CONFIG.BATCH_SIZE) + 1;
    const batch = threads.slice(i, i + CONFIG.BATCH_SIZE);
    const batchStart = startTimer(
      "INVITES",
      `Batch ${batchNum} (${batch.length} threads)`,
    );

    const threadsToTrash = [];

    for (let j = 0; j < batch.length; j++) {
      const thread = batch[j];
      report.processedThreads++;

      if ((j + 1) % 10 === 0 || j === 0) {
        logProgress(
          "INVITES",
          j + 1,
          batch.length,
          `threadId=${thread.getId()} batch=${batchNum}`,
        );
        warnIfApproachingTimeout("INVITES");
      }

      try {
        if (thread.hasStarredMessages()) {
          report.skippedStarred++;
          continue;
        }

        const evalStart = startTimer(
          "INVITES",
          `evaluateInviteThreadForDeletion threadId=${thread.getId()}`,
        );
        const decision = evaluateInviteThreadForDeletion(thread);
        endTimer(
          "INVITES",
          `evaluateInviteThreadForDeletion threadId=${thread.getId()}`,
          evalStart,
        );

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
        logError(
          "INVITES",
          `threadId=${thread.getId()} message=${err.message}`,
        );
      }
    }

    const trashStart = startTimer(
      "INVITES",
      `moveThreadsToTrash batch=${batchNum} count=${threadsToTrash.length}`,
    );
    moveThreadsToTrash(threadsToTrash);
    endTimer(
      "INVITES",
      `moveThreadsToTrash batch=${batchNum}`,
      trashStart,
    );

    endTimer("INVITES", `Batch ${batchNum}`, batchStart);
  }

  logVerbose("INVITES", `Invite cleanup complete: ${JSON.stringify(report)}`);
  endTimer("INVITES", "cleanUpInvites", fnStart);
  return report;
}

function evaluateInviteThreadForDeletion(thread) {
  const now = new Date();
  const lastMessageDate = thread.getLastMessageDate();
  const ageInDays = daysBetween(lastMessageDate, now);

  const getMessagesStart = startTimer(
    "INVITES",
    `thread.getMessages() threadId=${thread.getId()}`,
  );
  const messages = thread.getMessages();
  endTimer(
    "INVITES",
    `thread.getMessages() threadId=${thread.getId()} count=${messages.length}`,
    getMessagesStart,
  );

  let hasInvite = false;
  let hasUnreadMessage = false;
  let mostRecentInviteEnd = null;

  for (let m = 0; m < messages.length; m++) {
    const msg = messages[m];

    if (msg.isUnread()) {
      hasUnreadMessage = true;
    }

    const inviteStart = startTimer(
      "INVITES",
      `getInviteInfoFromMessage msg ${m + 1}/${messages.length} threadId=${thread.getId()}`,
    );
    const inviteInfo = getInviteInfoFromMessage(msg);
    endTimer(
      "INVITES",
      `getInviteInfoFromMessage msg ${m + 1}/${messages.length} threadId=${thread.getId()}`,
      inviteStart,
    );

    if (inviteInfo.hasInvite) {
      hasInvite = true;

      if (
        inviteInfo.endDate &&
        (!mostRecentInviteEnd || inviteInfo.endDate > mostRecentInviteEnd)
      ) {
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
  const attachmentsStart = startTimer("INVITE_MSG", "message.getAttachments()");
  const attachments = message.getAttachments({
    includeInlineImages: false,
    includeAttachments: true,
  });
  endTimer(
    "INVITE_MSG",
    `message.getAttachments() count=${attachments.length}`,
    attachmentsStart,
  );

  let latestEndDate = null;
  let foundInvite = false;

  for (let a = 0; a < attachments.length; a++) {
    const attachment = attachments[a];
    const name = (attachment.getName() || "").toLowerCase();

    if (!CONFIG.INVITE_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      continue;
    }

    foundInvite = true;

    try {
      const readStart = startTimer(
        "INVITE_MSG",
        `attachment.getDataAsString() name=${name}`,
      );
      const content = attachment.getDataAsString();
      endTimer(
        "INVITE_MSG",
        `attachment.getDataAsString() name=${name} bytes=${content.length}`,
        readStart,
      );

      const parseStart = startTimer(
        "INVITE_MSG",
        `parseInviteDates name=${name}`,
      );
      const parsed = parseInviteDates(content);
      endTimer("INVITE_MSG", `parseInviteDates name=${name}`, parseStart);

      if (
        parsed.endDate &&
        (!latestEndDate || parsed.endDate > latestEndDate)
      ) {
        latestEndDate = parsed.endDate;
      }
    } catch (err) {
      logError(
        "INVITE_MSG",
        `Could not parse invite attachment "${name}": ${err.message}`,
      );
    }
  }

  return {
    hasInvite: foundInvite,
    endDate: latestEndDate,
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
    endDate: endDate || startDate,
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
  const fnStart = startTimer("LABELS", "cleanUpLabeledThreads");
  logVerbose("LABELS", "Starting labeled thread cleanup...");

  const results = [];

  for (const labelName of CONFIG.LABELS_TO_DELETE) {
    warnIfApproachingTimeout("LABELS");

    const labelStart = startTimer("LABELS", `label=${labelName}`);
    let label = null;

    try {
      label = GmailApp.getUserLabelByName(labelName);
    } catch (err) {
      logError("LABELS", `Error reading label "${labelName}": ${err.message}`);
      results.push({
        label: labelName,
        deleted: 0,
        skipped: 0,
        failed: 1,
        status: "Label Read Error",
      });
      continue;
    }

    if (!label) {
      logVerbose("LABELS", `Label not found: ${labelName}`);
      results.push({
        label: labelName,
        deleted: 0,
        skipped: 0,
        failed: 0,
        status: "Label Not Found",
      });
      continue;
    }

    const query = `label:"${labelName}" older_than:${CONFIG.DELETE_THRESHOLD_DAYS}d -is:starred`;
    const searchStart = startTimer("LABELS", `search ${labelName}`);
    const threads = GmailApp.search(query);
    endTimer(
      "LABELS",
      `search ${labelName} found=${threads.length}`,
      searchStart,
    );

    let deleted = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < threads.length; i += CONFIG.BATCH_SIZE) {
      warnIfApproachingTimeout("LABELS");

      const batchNum = Math.floor(i / CONFIG.BATCH_SIZE) + 1;
      const batch = threads.slice(i, i + CONFIG.BATCH_SIZE);
      const threadsToTrash = [];

      logVerbose(
        "LABELS",
        `label=${labelName} batch=${batchNum} size=${batch.length}`,
      );

      for (const thread of batch) {
        try {
          if (thread.hasStarredMessages()) {
            skipped++;
            continue;
          }

          threadsToTrash.push(thread);
        } catch (err) {
          failed++;
          logError(
            "LABELS",
            `label=${labelName} threadId=${thread.getId()} error=${err.message}`,
          );
        }
      }

      const trashStart = startTimer(
        "LABELS",
        `moveThreadsToTrash label=${labelName} batch=${batchNum} count=${threadsToTrash.length}`,
      );
      moveThreadsToTrash(threadsToTrash);
      endTimer(
        "LABELS",
        `moveThreadsToTrash label=${labelName} batch=${batchNum}`,
        trashStart,
      );

      deleted += threadsToTrash.length;
    }

    results.push({
      label: labelName,
      deleted: deleted,
      skipped: skipped,
      failed: failed,
      status: "Completed",
    });

    endTimer("LABELS", `label=${labelName}`, labelStart);
  }

  endTimer("LABELS", "cleanUpLabeledThreads", fnStart);
  return results;
}

// --- Inbox Archive ---

function archiveInbox() {
  const fnStart = startTimer("ARCHIVE", "archiveInbox");
  logVerbose("ARCHIVE", "Starting inbox archive...");

  const query = `in:inbox older_than:${CONFIG.ARCHIVE_THRESHOLD_DAYS}d -is:starred`;
  const searchStart = startTimer("ARCHIVE", `GmailApp.search(${query})`);
  const threads = GmailApp.search(query);
  endTimer("ARCHIVE", `GmailApp.search(${query})`, searchStart);

  const result = {
    archived: 0,
    skippedStarred: 0,
    skippedInvite: 0,
    skippedProtectedLabel: 0,
    failed: 0,
  };

  for (let i = 0; i < threads.length; i += CONFIG.BATCH_SIZE) {
    warnIfApproachingTimeout("ARCHIVE");

    const batchNum = Math.floor(i / CONFIG.BATCH_SIZE) + 1;
    const batch = threads.slice(i, i + CONFIG.BATCH_SIZE);
    const batchStart = startTimer(
      "ARCHIVE",
      `Batch ${batchNum} (${batch.length} threads)`,
    );

    const threadsToArchive = [];

    for (let j = 0; j < batch.length; j++) {
      const thread = batch[j];

      if ((j + 1) % 10 === 0 || j === 0) {
        logProgress(
          "ARCHIVE",
          j + 1,
          batch.length,
          `threadId=${thread.getId()} batch=${batchNum}`,
        );
      }

      try {
        if (thread.hasStarredMessages()) {
          result.skippedStarred++;
          continue;
        }

        const protectedStart = startTimer(
          "ARCHIVE",
          `threadHasProtectedArchiveLabel threadId=${thread.getId()}`,
        );
        if (threadHasProtectedArchiveLabel(thread)) {
          endTimer(
            "ARCHIVE",
            `threadHasProtectedArchiveLabel threadId=${thread.getId()} => true`,
            protectedStart,
          );
          result.skippedProtectedLabel++;
          continue;
        }
        endTimer(
          "ARCHIVE",
          `threadHasProtectedArchiveLabel threadId=${thread.getId()} => false`,
          protectedStart,
        );

        const inviteStart = startTimer(
          "ARCHIVE",
          `threadContainsInviteAttachment threadId=${thread.getId()}`,
        );
        if (threadContainsInviteAttachment(thread)) {
          endTimer(
            "ARCHIVE",
            `threadContainsInviteAttachment threadId=${thread.getId()} => true`,
            inviteStart,
          );
          result.skippedInvite++;
          continue;
        }
        endTimer(
          "ARCHIVE",
          `threadContainsInviteAttachment threadId=${thread.getId()} => false`,
          inviteStart,
        );

        threadsToArchive.push(thread);
      } catch (err) {
        result.failed++;
        logError(
          "ARCHIVE",
          `threadId=${thread.getId()} error=${err.message}`,
        );
      }
    }

    const archiveStart = startTimer(
      "ARCHIVE",
      `moveThreadsToArchive batch=${batchNum} count=${threadsToArchive.length}`,
    );
    moveThreadsToArchive(threadsToArchive);
    endTimer(
      "ARCHIVE",
      `moveThreadsToArchive batch=${batchNum}`,
      archiveStart,
    );

    result.archived += threadsToArchive.length;
    endTimer("ARCHIVE", `Batch ${batchNum}`, batchStart);
  }

  logVerbose("ARCHIVE", `Inbox archive complete: ${JSON.stringify(result)}`);
  endTimer("ARCHIVE", "archiveInbox", fnStart);
  return result;
}

function threadHasProtectedArchiveLabel(thread) {
  const protectedLabels = CONFIG.ARCHIVE_IGNORE_LABELS.map((l) =>
    l.toLowerCase(),
  );
  const labels = [];

  const labelsReadStart = startTimer(
    "ARCHIVE",
    `thread.getLabels() threadId=${thread.getId()}`,
  );
  const threadLabels = thread.getLabels();
  endTimer(
    "ARCHIVE",
    `thread.getLabels() threadId=${thread.getId()} count=${threadLabels.length}`,
    labelsReadStart,
  );

  for (const label of threadLabels) {
    try {
      const name = label.getName();
      if (name) {
        labels.push(name.toLowerCase());
      }
    } catch (err) {
      logError("ARCHIVE", `Skipping unreadable thread label: ${err.message}`);
    }
  }

  return labels.some((label) => protectedLabels.includes(label));
}

function threadContainsInviteAttachment(thread) {
  const getMessagesStart = startTimer(
    "ARCHIVE",
    `thread.getMessages() for invite scan threadId=${thread.getId()}`,
  );
  const messages = thread.getMessages();
  endTimer(
    "ARCHIVE",
    `thread.getMessages() for invite scan threadId=${thread.getId()} count=${messages.length}`,
    getMessagesStart,
  );

  for (let m = 0; m < messages.length; m++) {
    const msg = messages[m];

    const attachStart = startTimer(
      "ARCHIVE",
      `message.getAttachments() msg ${m + 1}/${messages.length} threadId=${thread.getId()}`,
    );
    const attachments = msg.getAttachments({
      includeInlineImages: false,
      includeAttachments: true,
    });
    endTimer(
      "ARCHIVE",
      `message.getAttachments() msg ${m + 1}/${messages.length} threadId=${thread.getId()} count=${attachments.length}`,
      attachStart,
    );

    for (const attachment of attachments) {
      const name = (attachment.getName() || "").toLowerCase();
      if (CONFIG.INVITE_EXTENSIONS.some((ext) => name.endsWith(ext))) {
        return true;
      }
    }
  }

  return false;
}

// --- No User Label Count ---

function countNoUserLabelEmails() {
  const fnStart = startTimer("NO_LABELS", "countNoUserLabelEmails");
  const query = CONFIG.NO_USER_LABEL_QUERY || "has:nouserlabels";
  const mode = String(CONFIG.NO_USER_LABEL_COUNT_MODE || "estimate").toLowerCase();

  if (mode === "estimate") {
    const apiReport = getNoUserLabelEstimateFromGmailApi(query);
    if (apiReport) {
      endTimer("NO_LABELS", "countNoUserLabelEmails", fnStart);
      return apiReport;
    }
  }

  if (mode === "exact") {
    const exactReport = getNoUserLabelExactCount(query);
    endTimer("NO_LABELS", "countNoUserLabelEmails", fnStart);
    return exactReport;
  }

  const fallbackReport = getNoUserLabelFallbackCount(query);
  endTimer("NO_LABELS", "countNoUserLabelEmails", fnStart);
  return fallbackReport;
}

function getNoUserLabelFallbackCount(query) {
  const batchSize = CONFIG.BATCH_SIZE || 100;
  const maxThreads = CONFIG.NO_USER_LABEL_FALLBACK_MAX_THREADS || 500;
  const countEmails = CONFIG.NO_USER_LABEL_FALLBACK_COUNT_EMAILS === true;
  let start = 0;
  let threadCount = 0;
  let emailCount = countEmails ? 0 : null;
  let failedThreads = 0;
  let truncated = false;

  while (threadCount < maxThreads) {
    warnIfApproachingTimeout("NO_LABELS");
    const remaining = maxThreads - threadCount;
    const pageSize = Math.min(batchSize, remaining);

    const searchStart = startTimer(
      "NO_LABELS",
      `GmailApp.search(${query}, ${start}, ${pageSize})`,
    );
    const threads = GmailApp.search(query, start, pageSize);
    endTimer(
      "NO_LABELS",
      `GmailApp.search(${query}, ${start}, ${pageSize}) found=${threads.length}`,
      searchStart,
    );

    if (!threads || threads.length === 0) {
      break;
    }

    threadCount += threads.length;

    for (let i = 0; i < threads.length; i++) {
      const thread = threads[i];

      if ((i + 1) % 25 === 0 || i === 0) {
        logProgress(
          "NO_LABELS",
          i + 1,
          threads.length,
          `threadId=${thread.getId()} offset=${start}`,
        );
      }

      if (countEmails) {
        try {
          emailCount += thread.getMessageCount();
        } catch (err) {
          failedThreads++;
          logError(
            "NO_LABELS",
            `Could not count messages for thread ${thread.getId()}: ${err.message}`,
          );
        }
      }
    }

    start += threads.length;

    if (threads.length < pageSize) {
      break;
    }
  }

  if (threadCount >= maxThreads) {
    truncated = true;
  }

  const report = {
    query: query,
    threadCount: threadCount,
    emailCount: emailCount,
    failedThreads: failedThreads,
    method: countEmails ? "Fallback sample with email count" : "Fallback thread sample",
    estimated: false,
    truncated: truncated,
    note: truncated
      ? `Fallback stopped after ${maxThreads} threads. Enable Advanced Gmail service for a fast full estimate.`
      : "Fallback completed without Advanced Gmail service.",
  };

  logVerbose("NO_LABELS", `No-user-label count complete: ${JSON.stringify(report)}`);
  return report;
}

function getNoUserLabelEstimateFromGmailApi(query) {
  if (typeof Gmail === "undefined" || !Gmail.Users) {
    logVerbose("NO_LABELS", "Advanced Gmail service is not available.");
    return null;
  }

  try {
    const apiStart = startTimer("NO_LABELS", `Gmail API estimate query=${query}`);
    const threadResponse = Gmail.Users.Threads.list("me", {
      q: query,
      maxResults: 1,
    });
    const messageResponse = Gmail.Users.Messages.list("me", {
      q: query,
      maxResults: 1,
    });
    endTimer("NO_LABELS", `Gmail API estimate query=${query}`, apiStart);

    return {
      query: query,
      threadCount: threadResponse.resultSizeEstimate || 0,
      emailCount: messageResponse.resultSizeEstimate || 0,
      failedThreads: 0,
      method: "Advanced Gmail service estimate",
      estimated: true,
      truncated: false,
      note: "Fast estimate from Gmail API resultSizeEstimate.",
    };
  } catch (err) {
    logError(
      "NO_LABELS",
      `Advanced Gmail service estimate failed, using fallback: ${err.message}`,
    );
    return null;
  }
}

function getNoUserLabelExactCount(query) {
  const apiReport = getNoUserLabelExactCountFromGmailApi(query);
  if (apiReport) {
    return apiReport;
  }

  const report = getNoUserLabelExactCountFromGmailApp(query);
  logVerbose("NO_LABELS", `No-user-label exact count complete: ${JSON.stringify(report)}`);
  return report;
}

function getNoUserLabelExactCountFromGmailApi(query) {
  if (typeof Gmail === "undefined" || !Gmail.Users) {
    logVerbose("NO_LABELS", "Advanced Gmail service is not available.");
    return null;
  }

  try {
    const apiStart = startTimer("NO_LABELS", `Gmail API exact count query=${query}`);
    const threadCount = countGmailApiSearchResults(Gmail.Users.Threads, query, "threads");
    const emailCount = countGmailApiSearchResults(Gmail.Users.Messages, query, "messages");
    endTimer("NO_LABELS", `Gmail API exact count query=${query}`, apiStart);

    return {
      query: query,
      threadCount: threadCount,
      emailCount: emailCount,
      failedThreads: 0,
      method: "Advanced Gmail service exact count",
      estimated: false,
      truncated: false,
      note: "Exact count from paginating Gmail API search results.",
    };
  } catch (err) {
    logError(
      "NO_LABELS",
      `Advanced Gmail service exact count failed, using GmailApp exact scan: ${err.message}`,
    );
    return null;
  }
}

function countGmailApiSearchResults(resource, query, resultKey) {
  let pageToken = null;
  let count = 0;

  do {
    warnIfApproachingTimeout("NO_LABELS");

    const response = resource.list("me", {
      q: query,
      maxResults: 500,
      pageToken: pageToken,
    });
    const results = response[resultKey] || [];
    count += results.length;
    pageToken = response.nextPageToken || null;
  } while (pageToken);

  return count;
}

function getNoUserLabelExactCountFromGmailApp(query) {
  const batchSize = CONFIG.BATCH_SIZE || 100;
  let start = 0;
  let threadCount = 0;
  let emailCount = 0;
  let failedThreads = 0;

  while (true) {
    warnIfApproachingTimeout("NO_LABELS");

    const threads = GmailApp.search(query, start, batchSize);
    if (!threads || threads.length === 0) {
      break;
    }

    threadCount += threads.length;

    for (const thread of threads) {
      try {
        emailCount += thread.getMessageCount();
      } catch (err) {
        failedThreads++;
        logError(
          "NO_LABELS",
          `Could not count messages for thread ${thread.getId()}: ${err.message}`,
        );
      }
    }

    start += threads.length;

    if (threads.length < batchSize) {
      break;
    }
  }

  return {
    query: query,
    threadCount: threadCount,
    emailCount: emailCount,
    failedThreads: failedThreads,
    method: "GmailApp exact scan",
    estimated: false,
    truncated: false,
    note: "Exact count by scanning all matching GmailApp threads; this can be slow.",
  };
}

// --- Audit / Reporting Helpers ---

function auditMailbox() {
  const fnStart = startTimer("AUDIT", "auditMailbox");
  logVerbose("AUDIT", "Starting mailbox audit...");

  const labelAuditStart = startTimer("AUDIT", "getUnruledUserLabels");
  const labelAudit = getUnruledUserLabels();
  endTimer("AUDIT", "getUnruledUserLabels", labelAuditStart);

  const unlabeledStart = startTimer(
    "AUDIT",
    "getUnlabeledInboxCountsByCategory",
  );
  const unlabeledByCategory = getUnlabeledInboxCountsByCategory();
  endTimer("AUDIT", "getUnlabeledInboxCountsByCategory", unlabeledStart);

  const totalUnlabeledInboxThreads = Object.values(unlabeledByCategory).reduce(
    (sum, count) => sum + count,
    0,
  );

  const report = {
    unruledLabels: labelAudit.unruledLabels,
    unruledLabelCount: labelAudit.unruledLabels.length,
    unreadableLabelCount: labelAudit.unreadableLabelCount,
    unlabeledByCategory: unlabeledByCategory,
    totalUnlabeledInboxThreads: totalUnlabeledInboxThreads,
  };

  logVerbose("AUDIT", `Mailbox audit complete: ${JSON.stringify(report)}`);
  endTimer("AUDIT", "auditMailbox", fnStart);
  return report;
}

function getUnruledUserLabels() {
  const labelsStart = startTimer("AUDIT", "GmailApp.getUserLabels()");
  const rawLabels = GmailApp.getUserLabels();
  endTimer(
    "AUDIT",
    `GmailApp.getUserLabels() count=${rawLabels.length}`,
    labelsStart,
  );

  const allUserLabels = [];
  let unreadableLabelCount = 0;

  for (let i = 0; i < rawLabels.length; i++) {
    const label = rawLabels[i];

    try {
      const name = label.getName();
      if (name && typeof name === "string") {
        allUserLabels.push(name);
      }
    } catch (err) {
      unreadableLabelCount++;
      logError("AUDIT", `Skipping unreadable label object: ${err.message}`);
    }
  }

  allUserLabels.sort((a, b) => a.localeCompare(b));

  const ruledLabels = new Set([
    ...CONFIG.LABELS_TO_DELETE.map((l) => l.toLowerCase()),
    ...CONFIG.ARCHIVE_IGNORE_LABELS.map((l) => l.toLowerCase()),
  ]);

  const unruledLabels = allUserLabels.filter(
    (labelName) => !ruledLabels.has(labelName.toLowerCase()),
  );

  return {
    unruledLabels: unruledLabels,
    unreadableLabelCount: unreadableLabelCount,
  };
}

function getUnlabeledInboxCountsByCategory() {
  const categoryQueries = {
    Primary: "in:inbox category:primary",
    Social: "in:inbox category:social",
    Promotions: "in:inbox category:promotions",
    Updates: "in:inbox category:updates",
    Forums: "in:inbox category:forums",
  };

  const counts = {};

  for (const [categoryName, query] of Object.entries(categoryQueries)) {
    warnIfApproachingTimeout("AUDIT");

    const searchStart = startTimer("AUDIT", `search category=${categoryName}`);
    const threads = GmailApp.search(query);
    endTimer(
      "AUDIT",
      `search category=${categoryName} found=${threads.length}`,
      searchStart,
    );

    let unlabeledCount = 0;

    for (let i = 0; i < threads.length; i++) {
      const thread = threads[i];

      if ((i + 1) % 25 === 0 || i === 0) {
        logProgress(
          "AUDIT",
          i + 1,
          threads.length,
          `category=${categoryName} threadId=${thread.getId()}`,
        );
      }

      try {
        const labelsStart = startTimer(
          "AUDIT",
          `thread.getLabels() category=${categoryName} threadId=${thread.getId()}`,
        );
        const labels = thread.getLabels();
        endTimer(
          "AUDIT",
          `thread.getLabels() category=${categoryName} threadId=${thread.getId()} count=${labels.length}`,
          labelsStart,
        );

        if (!labels || labels.length === 0) {
          unlabeledCount++;
        }
      } catch (err) {
        logError(
          "AUDIT",
          `Could not inspect labels for thread ${thread.getId()} in category "${categoryName}": ${err.message}`,
        );
      }
    }

    counts[categoryName] = unlabeledCount;
    logVerbose(
      "AUDIT",
      `category=${categoryName} unlabeledCount=${unlabeledCount}`,
    );
  }

  return counts;
}

function getEmptyAuditReport() {
  return {
    unruledLabels: [],
    unruledLabelCount: 0,
    unreadableLabelCount: 0,
    unlabeledByCategory: {
      Primary: 0,
      Social: 0,
      Promotions: 0,
      Updates: 0,
      Forums: 0,
    },
    totalUnlabeledInboxThreads: 0,
  };
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
    noUserLabelReport,
    auditReport,
  } = data;

  const isDryRun = CONFIG.DRY_RUN;
  const trashVerb = isDryRun ? "Would Delete" : "Deleted";
  const archiveVerb = isDryRun ? "Would Archive" : "Archived";
  const noUserLabelQuery = noUserLabelReport.query || "has:nouserlabels";
  const noUserLabelThreadCount = formatReportCount(noUserLabelReport.threadCount);
  const noUserLabelEmailCount = formatReportCount(noUserLabelReport.emailCount);
  const noUserLabelFailedThreads = formatReportCount(
    noUserLabelReport.failedThreads,
  );
  const noUserLabelMethod = noUserLabelReport.method || "Unknown";
  const noUserLabelNote = noUserLabelReport.note || "";
  const reportTitle = CONFIG.PROJECT_VERSION
    ? `${CONFIG.PROJECT_NAME} - ${CONFIG.PROJECT_VERSION}`
    : CONFIG.PROJECT_NAME;
  const footerLink = CONFIG.PROJECT_REPO_URL
    ? ` &nbsp;|&nbsp; <a href="${escapeHtml(CONFIG.PROJECT_REPO_URL)}" target="_blank" style="color:#666;text-decoration:underline;">${escapeHtml(CONFIG.PROJECT_REPO_TEXT || CONFIG.PROJECT_REPO_URL)}</a>`
    : "";

  const labelRows = labelCleanupReport
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.label)}</td>
      <td>${r.deleted}</td>
      <td>${r.skipped}</td>
      <td>${r.failed}</td>
      <td>${escapeHtml(r.status)}</td>
    </tr>
  `,
    )
    .join("");

  const unruledLabelRows = auditReport.unruledLabels.length
    ? auditReport.unruledLabels
        .map(
          (label) => `
        <tr>
          <td>${escapeHtml(label)}</td>
        </tr>
      `,
        )
        .join("")
    : `
        <tr>
          <td>&#x2705; None</td>
        </tr>
      `;

  const categoryRows = Object.entries(auditReport.unlabeledByCategory)
    .map(
      ([category, count]) => `
    <tr>
      <td>${escapeHtml(category)}</td>
      <td>${count}</td>
    </tr>
  `,
    )
    .join("");

  const auditSection = CONFIG.ENABLE_AUDIT
    ? `
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;width:100%;">
          <tr style="background:#f2f2f2;">
            <th colspan="2" style="text-align:left;">
              &#x1F9ED; User Labels Audit
            </th>
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
            <th colspan="1" style="text-align:left;">
              &#x1F4CB; Unruled Labels
            </th>
          </tr>
          ${unruledLabelRows}
        </table>

        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;width:100%;">
          <tr style="background:#f2f2f2;">
            <th colspan="2" style="text-align:left;">
              &#x1F4C2; Inbox Threads With No User Label by Gmail Category
            </th>
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
      `
    : "";

  return `
    <html>
      <head>
        <meta charset="UTF-8">
      </head>
      <body style="font-family:Arial,sans-serif;color:#333;line-height:1.4;">
        <h2 style="margin-bottom:8px;">&#x1F9F9; ${escapeHtml(reportTitle)}</h2>

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
            <th colspan="5" style="text-align:left;">&#x1F3F7;&#xFE0F; Emails With No User Label</th>
          </tr>
          <tr style="background:#f2f2f2;">
            <th>&#x1F50D; Query</th>
            <th>&#x1F9F5; Threads</th>
            <th>&#x2709;&#xFE0F; Emails</th>
            <th>&#x274C; Failed Threads</th>
            <th>&#x2699;&#xFE0F; Method</th>
          </tr>
          <tr>
            <td>${escapeHtml(noUserLabelQuery)}</td>
            <td>${noUserLabelThreadCount}</td>
            <td>${noUserLabelEmailCount}</td>
            <td>${noUserLabelFailedThreads}</td>
            <td>${escapeHtml(noUserLabelMethod)}</td>
          </tr>
          ${
            noUserLabelNote
              ? `
          <tr style="background:#fafafa;">
            <td colspan="5">${escapeHtml(noUserLabelNote)}</td>
          </tr>
        `
              : ""
          }
        </table>

        ${auditSection}

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
    logVerbose("MOVE", `[DRY RUN] Would move ${threads.length} thread(s) to trash.`);
    return;
  }

  const chunkSize = CONFIG.MOVE_BATCH_SIZE || 20;

  for (let i = 0; i < threads.length; i += chunkSize) {
    warnIfApproachingTimeout("MOVE");

    const chunk = threads.slice(i, i + chunkSize);
    const chunkNum = Math.floor(i / chunkSize) + 1;

    const start = startTimer(
      "MOVE",
      `GmailApp.moveThreadsToTrash chunk=${chunkNum} count=${chunk.length}`,
    );

    GmailApp.moveThreadsToTrash(chunk);

    endTimer(
      "MOVE",
      `GmailApp.moveThreadsToTrash chunk=${chunkNum} count=${chunk.length}`,
      start,
    );
  }
}

function moveThreadsToArchive(threads) {
  if (!threads || threads.length === 0) return;

  if (CONFIG.DRY_RUN) {
    logVerbose("MOVE", `[DRY RUN] Would archive ${threads.length} thread(s).`);
    return;
  }

  const chunkSize = CONFIG.MOVE_BATCH_SIZE || 20;

  for (let i = 0; i < threads.length; i += chunkSize) {
    warnIfApproachingTimeout("MOVE");

    const chunk = threads.slice(i, i + chunkSize);
    const chunkNum = Math.floor(i / chunkSize) + 1;

    const start = startTimer(
      "MOVE",
      `GmailApp.moveThreadsToArchive chunk=${chunkNum} count=${chunk.length}`,
    );

    GmailApp.moveThreadsToArchive(chunk);

    endTimer(
      "MOVE",
      `GmailApp.moveThreadsToArchive chunk=${chunkNum} count=${chunk.length}`,
      start,
    );
  }
}

function daysBetween(olderDate, newerDate) {
  return Math.floor(
    (newerDate.getTime() - olderDate.getTime()) / (1000 * 60 * 60 * 24),
  );
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatReportCount(value) {
  return value === null || typeof value === "undefined" ? "Skipped" : value;
}

// --- Debug Helpers ---

function logVerbose(section, message) {
  if (!CONFIG.VERBOSE_LOGS) return;
  Logger.log(`[${section}] ${message}`);
}

function logError(section, message) {
  Logger.log(`[${section}] ERROR: ${message}`);
}

function startTimer(section, detail) {
  const start = Date.now();
  if (CONFIG.VERBOSE_LOGS) {
    Logger.log(`[${section}] START: ${detail}`);
  }
  return start;
}

function endTimer(section, detail, startMs) {
  if (!CONFIG.VERBOSE_LOGS) return;
  const elapsed = Date.now() - startMs;
  Logger.log(`[${section}] END: ${detail} (${elapsed} ms)`);
}

function logProgress(section, index, total, extra) {
  if (!CONFIG.VERBOSE_LOGS) return;
  Logger.log(
    `[${section}] Progress: ${index}/${total}${extra ? " | " + extra : ""}`,
  );
}

function warnIfApproachingTimeout(section) {
  const elapsed = Date.now() - SCRIPT_START_MS;
  if (elapsed > SOFT_TIMEOUT_MS) {
    Logger.log(
      `[${section}] WARNING: script has been running ${elapsed} ms and may approach Apps Script execution limit.`,
    );
  }
}
