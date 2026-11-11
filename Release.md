# SentiBuddy v4.0.0

# ✨ New Features

### Central Configuration

-   Added support for loading configuration from an External **JSON ** via URL
-   Allows teams to distribute shared:
    -   queue filters
    -   dashboard links
    -   API Keys
    -   client reference tables
-   Config values originating from the central config display a **lock icon** in the UI

### Client / Development Reference Tabs

-   Added **Client Info** and **Development** tabs
-   Tables in these tabs are generated from config:
    -   `tableData.data` → **Client Info tab**
    -   `tableData.devData` → **Development tab**
-   Tables are **not stored locally** and must come from the central
    config

### Manual OSINT Input

-   OSINT queries can now be run by **typing IPs or hashes directly**
-   Clipboard detection still supported

### Dashboard Button

-   Added configurable **dashboard button**
-   `dashboardTitle` → button label
-   `dashboardLink` → destination URL

------------------------------------------------------------------------

# 🔐 Security

-   Added stricter **input validation and sanitization**
-   Restricted external URLs to trusted Microsoft domains
-   Various internal security hardening fixes

------------------------------------------------------------------------

# ⚙ Improvements

### UI

-   Rebuilt SentiBuddy menu from ground up with new **tab layout**
    -   **Operations** -- existing SentiBuddy tools
    -   **Client Info** -- client reference table
    -   **Development** -- infrastructure reference table
-   Redesigned **Options panel**
-   Added **Light Mode / Dark Mode**
-   Added Logo to main page
-   Colors and Emojis!
-   Added **hover descriptions** to all buttons to give better clarity on what they can do.

### Queue Safety

-   Sentinel **"Select All" checkbox** is hidden while queue filtering
    is enabled\
    Prevents accidental bulk selection when filters are active.

### Timer / Incident Counter

-   Timer and incident counter can now be **enabled or disabled from the
    menu**

------------------------------------------------------------------------
## ⚠ Breaking Changes

-   API keys are **no longer included when exporting configuration**
-   External URL validation now restricts links to
    **Microsoft/Azure/SharePoint domains**
-   Experimental **note-taking feature removed**

------------------------------------------------------------------------
# ❌ Removed

-   Experimental **note-taking functionality**

------------------------------------------------------------------------

# Example: Custom Tables (Client Info / Development Tabs)

The `tableData` object allows teams to define **custom tables** that
appear in the SentiBuddy interface.

-   `tableData.data` → displayed in the **Client Info tab**
-   `tableData.devData` → displayed in the **Development tab**
-   `tableData.schemas` → optional column and hyperlink definitions

Each object in the array becomes **one row in the table**.

Columns are rendered dynamically.

-   If `tableData.schemas` is provided, its column definitions control:
    -   display names
    -   column order
    -   hyperlink behavior
-   If `tableData.schemas` is not provided, the extension falls back to
    its built-in default layout.

### Example: Client Info Table

``` json
"tableData": {
  "schemas": {
    "data": {
      "columns": {
        "code": { "displayName": "Code" },
        "client": { "displayName": "Client" },
        "department": { "displayName": "Department" },
        "lead": { "displayName": "Client Lead" },
        "edr": {
          "displayName": "EDR",
          "hyperLink": { "urlField": "edrLink" }
        },
        "contact": {
          "displayName": "Contacts",
          "hyperLink": { "text": "Info" }
        }
      }
    }
  },
  "data": [
    {
      "code": "AppB2",
      "client": "Apple Bank",
      "department": "Banking",
      "lead": "Jimbo",
      "edr": "CrowdStrike",
      "edrLink": "https://example.com",
      "contact": "https://example.com/contact"
    },
    {
      "code": "FinX",
      "client": "FinTech Corp",
      "department": "Finance",
      "lead": "Sarah",
      "edr": "SentinelOne",
      "edrLink": "https://example.com",
      "contact": "https://example.com/contact"
    }
  ]
}
```

This renders as:

    Code | Client | Department | Client Lead | EDR | Contacts

With this behavior:

-   The **EDR** cell displays `edr` text and links to `edrLink`
-   The **Contacts** cell displays `Info` and links to `contact`
-   `edrLink` is used as a link source and is **not shown as its own
    column**

### Example: Development Table

``` json
"tableData": {
  "schemas": {
    "devData": {
      "columns": {
        "client": { "displayName": "Client" },
        "sentinelName": {
          "displayName": "Sentinel Instance",
          "hyperLink": { "urlField": "sentinelLink" }
        },
        "rgName": {
          "displayName": "Resource Group",
          "hyperLink": { "urlField": "rgLink" }
        },
        "subscriptionName": {
          "displayName": "Subscription",
          "hyperLink": { "urlField": "subscriptionLink" }
        },
        "location": { "displayName": "Location" }
      }
    }
  },
  "devData": [
    {
      "client": "Apple Bank",
      "sentinelName": "apple-prod",
      "sentinelLink": "https://portal.azure.com/",
      "rgName": "apple-security-rg",
      "rgLink": "https://portal.azure.com/",
      "subscriptionName": "Apple Security",
      "subscriptionLink": "https://portal.azure.com/",
      "location": "eastus"
    }
  ]
}
```

This renders as:

    Client | Sentinel Instance | Resource Group | Subscription | Location

### Recommendations

-   Limit tables to **\~6--7 columns** for readability in the extension
    popup
-   Use `schemas` when you want explicit column labels and ordering
-   Use `hyperLink.urlField` (or `hyperlink.urlField`) to map a display
    field to a URL field
-   URLs can be used for quick navigation to dashboards or portals

------------------------------------------------------------------------

# Central Config Schema

All fields are optional. Missing values fall back to local
configuration.

``` json
{
  "type": "object",
  "properties": {
    "desktopNotifications": { "type": "boolean" },
    "abuseipdbAPIkey": { "type": "string" },
    "ipInfoKey": { "type": "string" },
    "scamalyticsURL": { "type": "string" },
    "vtkey": { "type": "string" },
    "configDataURL": { "type": "string" },
    "doRemoveFromFilteredFromQueue": { "type": "boolean" },
    "filterOwnerRegexPatterns": { "type": "array" },
    "filterTagsRegexPatterns": { "type": "array", "items": { "type": "string" } },
    "filterTitleRegexPatterns": { "type": "array", "items": { "type": "string" } },
    "onlyAlertOnLatest": { "type": "boolean" },
    "timeTrackingEnabled": { "type": "boolean" },
    "timeTrackingIdleMinutes": { "type": "number", "minimum": 1, "maximum": 120 },
    "timeTrackingAutoPause": { "type": "boolean" },
    "timeTrackingAutoResetTime": { "type": "string", "description": "Daily local reset time HH:MM (24h); empty = never" },
    "timeEntryTitle": { "type": "string", "description": "Label of the time-entry button on the Time tab" },
    "timeEntryLink": { "type": "string", "description": "URL the time-entry button opens" },
    "workspaceClientPattern": { "type": "string", "description": "Regex mapping a workspace name to a client code (named group 'client' or group 1); used by notifications, the Enhanced Queue, time tracking and playbooks" },
    "timeTracking": {
      "type": "object",
      "properties": {
        "metricsEndpoint": { "type": "string" },
        "codeLabel": { "type": "string", "description": "What time-entry codes are called, e.g. \"Project Code\"" },
        "clients": { "type": ["array", "object"] },
        "general": { "type": "object" },
        "defaults": { "type": "object" },
        "csv": { "type": "object" }
      }
    },
    "documentation": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "title": { "type": "string", "description": "Regex matched against the incident title (case-insensitive)" },
          "url": { "type": "string", "description": "https link to the documentation page" }
        }
      }
    },
    "notifyOnMatchesOnly": { "type": "boolean" },
    "notificationRules": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "field": { "type": "string", "enum": ["title", "tags"] },
          "pattern": { "type": "string" }
        }
      }
    },
    "dashboardTitle": { "type": "string" },
    "dashboardLink": { "type": "string" },
    "incidentLookbackEndpoint": { "type": "string" },
    "slaSettings": {
      "type": "object",
      "properties": {
        "enabled": { "type": "boolean" },
        "minutes": {
          "type": "object",
          "properties": {
            "High": { "type": "number" },
            "Medium": { "type": "number" },
            "Low": { "type": "number" },
            "Informational": { "type": "number" }
          }
        },
        "warnPercent": { "type": "number", "minimum": 0, "maximum": 100 },
        "warnColor": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$" },
        "breachColor": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$" },
        "warnIntensity": { "type": "number", "minimum": 0, "maximum": 100 },
        "breachIntensity": { "type": "number", "minimum": 0, "maximum": 100 }
      }
    },
    "tableData": {
      "type": "object",
      "properties": {
        "schemas": { "type": "object" },
        "data": { "type": "array" },
        "devData": { "type": "array" }
      }
    }
  }
}
```

------------------------------------------------------------------------

# 🆕 Feature Highlights

### 🚀 Enhanced Queue

A floating panel with the full filtered incident queue across
workspaces, which also drives desktop notifications while it's on.

### 🏷 Workspace → Client Pattern

One setting turns workspace names into client codes everywhere
(notifications, the Enhanced Queue, time tracking, playbook matching).
Without it, the workspace name is used as-is.

``` json
"workspaceClientPattern": "^soc-(?<client>[a-z0-9]+)$"
```

### ⏱ Time Tracking (experimental)

-   **Records in the background by default.** Counts time for what
    you're working on in the Azure portal: an incident, a single
    workspace (Sentinel, Log Analytics Logs) or an Azure Data Explorer
    cluster. Everything else counts as **General**.
-   The **Time** tab, the portal timer and the metrics endpoint are only
    used with **Show experimental features** on. Time recorded before
    then is already there when you turn it on.
-   One tracker for every tab, so time is never counted twice. It stops
    while you're idle and can optionally pause when you leave the portal.
-   A small timer sits at the bottom centre of the portal. Time counted
    while you were away shows briefly as a red **+time** you can remove.
-   The menu's **Time** tab lists the day's hours per client. Click hours
    to edit them, drag rows to reorder or merge them, and **Export CSV**
    for your timesheet.
-   Only durations and incident numbers are stored, never incident
    content.

A *client* is any group of workspaces. With no config, each workspace
gets its own row. Example:

``` json
"timeEntryTitle": "Projector",
"timeEntryLink": "https://timesheets.example.com",
"timeTracking": {
  "codeLabel": "Project Code",
  "clients": [
    { "client": "ACME1", "code": "PRJ-1001-01", "workspaces": ["acme-sentinel-prod"], "adxClusters": ["acmeadx01"] }
  ],
  "general": { "client": "GENERAL", "code": "PRJ-0000-01" },
  "defaults": { "task": "Monitoring and Response ({shift})", "missingCode": "MISSING-CODE" }
}
```

-   `workspaceClientPattern` (above) maps most workspaces; `clients`
    covers workspaces and ADX clusters that don't follow it.
-   `timeEntryTitle` / `timeEntryLink` add a button that opens your
    time-entry system; `codeLabel` names its codes in the table and the
    export.
-   An optional `csv` block sets the export's columns (placeholders such
    as `{client}`, `{code}`, `{hours}`), date format and file name.

### 📊 Compare With Your Metrics

-   Point `timeTracking.metricsEndpoint` (or `incidentLookbackEndpoint`)
    at an HTTP endpoint, such as a Logic App, that reports each
    analyst's hours.
-   **Compare metrics** shows those hours next to SentiBuddy's with the
    difference, and can average the two in one click.
-   Requests are kept to a minimum and only made while the Time tab is
    open (so never with experimental features off): a background run at
    most every 4 hours, **Refresh** at most
    every 30 minutes, and one time-entry code lookup per day.

SentiBuddy POSTs
`{ "email": "first.last@company.com", "date": "2026-11-05", "timezone": "America/New_York" }`
and reads (all fields optional):

``` json
{
  "clients": [ { "client": "ACME1", "hours": 2.5 } ],
  "codes": { "ACME1": "PRJ-1001-01" },
  "workspaces": { "acme-sentinel-prod": "ACME1" }
}
```

The daily code lookup adds `"returnOnly": "codes-only"`; answer it with
just `codes`.

### 📖 Incident Documentation Links

A 📖 link appears next to an incident's number when its title matches an
entry (regex, case-insensitive, first match wins, `https://` only).

``` json
"documentation": [
  { "title": "Kerberoasting", "url": "https://wiki.example.com/soc/kerberoasting" },
  { "title": "^Contoso - .*Shellcode", "url": "https://wiki.example.com/soc/shellcode" }
]
```

### 🔔 Notification Rules

Desktop notifications only for incidents whose title or a tag matches a
rule:

``` json
"notifyOnMatchesOnly": true,
"notificationRules": [
  { "field": "title", "pattern": "Ransomware|Wiper" },
  { "field": "tags", "pattern": "^VIP$" }
]
```

### 🚦 Enhanced Queue SLA

Unassigned, open incidents are tinted as they approach (`warnPercent`)
and pass their severity's SLA, with a sortable **SLA** column. Nothing
is on by default: severities without minutes have no SLA, and there's
no "approaching" stage or tint until `warnPercent` and the intensities
are set.

``` json
"slaSettings": {
  "minutes": { "High": 30, "Medium": 90, "Low": 240 },
  "warnPercent": 80,
  "warnColor": "#f7b500",
  "warnIntensity": 30,
  "breachColor": "#d13438",
  "breachIntensity": 50
}
```


**Full Changelog**: https://github.com/CrashCringle12/SentiBuddy/compare/3.0.1...4.0.0
