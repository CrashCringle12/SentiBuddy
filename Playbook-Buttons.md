# Playbook Buttons (Incident Page)

SentiBuddy can add **one-click playbook buttons** to the Sentinel incident
details page, next to **Incident actions**. Each button finds the right
Logic App for the incident's client and asks for confirmation (showing the
exact playbook name) before running it.

The buttons are defined in the **master config** (the JSON file at your
Config Link / `configDataURL`) under the `playbooks` key, so a team can add,
recolor, or retarget buttons without shipping a new extension version.

-   Up to **5 buttons** are shown inline. Any more are listed under a
    **More (N) ▾** dropdown after them.
-   Buttons only appear on the full incident page
    (`#view/Microsoft_Azure_Security_Insights/IncidentPage.ReactView/...`).
-   Nothing runs without a real click on the confirmation dialog.

------------------------------------------------------------------------

# Setup

1.  Add a `playbooks` section to your master config JSON (see the example
    below).
2.  Host the JSON at an **https** URL that SentiBuddy can fetch (the same
    URL already used for `tableData` works).
3.  In SentiBuddy **Options**, set **Config Link** to that URL and save.
4.  Open any incident's full details page. The buttons appear next to
    **Incident actions**.

SentiBuddy caches the playbook config for **30 minutes**. After editing the
JSON, wait for the cache to expire or reload the extension
(`chrome://extensions` → reload) to pick up changes immediately.

If the master config has **no** `playbooks` key, **no buttons are shown** unless
you add a `playbooks` section with your buttons configured.

------------------------------------------------------------------------

# Example: Isolate Host, Block IP and Notify Owner

In this example, playbooks are named `(<client code>)-<playbook name>`:

    (acme)-isolate-host-v4
    (acme)-block-ip-playbook
    (acme)-notify-owner-playbook

and workspaces `soc-<client code><digits>` (`soc-acme1`, `soc-globex12`).

``` json
"playbooks": {
  "workspaceClientPattern": "^soc-([a-z][a-z0-9]*?)\\d*$",
  "buttons": [
    {
      "id": "notify-owner",
      "label": "Notify Owner",
      "color": "#6b2fb3",
      "icon": "✉",
      "description": "Email the affected asset's owner about this incident",
      "match": { "suffix": "-notify-owner-playbook", "versioned": true },
      "confirm": {
        "title": "Notify owner",
        "question": "Email the asset owner about this incident? This will run:",
        "button": "Yes, notify"
      }
    },
    {
      "id": "block-ip",
      "label": "Block IP",
      "color": "#107c10",
      "icon": "⛔",
      "description": "Block the incident's IP entities at the firewall",
      "match": { "suffix": "-block-ip-playbook", "versioned": true },
      "confirm": {
        "title": "Block IP addresses",
        "question": "Block this incident's IP addresses? This will run:",
        "button": "Yes, block"
      }
    },
    {
      "id": "isolate-host",
      "label": "Isolate Host",
      "color": "#c50f1f",
      "icon": "⚠",
      "description": "Isolate the incident's hosts from the network",
      "match": { "suffix": "-isolate-host", "versioned": true, "exclude": ["test"] },
      "confirm": {
        "title": "Isolate host",
        "question": "Are you sure you want to isolate this incident's hosts? This will run:",
        "button": "Yes, isolate"
      }
    }
  ]
}
```

This renders as:

    [Incident actions] [✉ Notify Owner] [⛔ Block IP] [⚠ Isolate Host]
                        purple           green        red

For a gray Block IP button instead of green, use `"color": "#605e5c"`.

How the Isolate Host button finds its playbook on `soc-acme1`:

1.  Lists the Logic Apps in the incident's resource group.
2.  Keeps names ending in `-isolate-host`, optionally followed by a
    version (`-v4`), and drops names containing `test`.
3.  The leftover text, `(acme)`, becomes the client code `acme`. If a
    client has several versions, the highest `-vN` wins.
4.  `workspaceClientPattern` turns `soc-acme1` into `acme`, so
    `(acme)-isolate-host-v4` is pre-selected.

------------------------------------------------------------------------

# Field Reference

### `playbooks`

| Field | Required | Description |
|---|---|---|
| `buttons` | yes | Array of button definitions, shown in this order. |
| `workspaceClientPattern` | no | Regex applied to the **workspace name** to extract the client code. Uses the first capture group (or a named group `client`). Case-insensitive. Defaults to the top-level `workspaceClientPattern`; set it here only when playbook client codes differ from the codes used elsewhere (e.g. without trailing digits). |

### `playbooks.buttons[]`

| Field | Required | Description |
|---|---|---|
| `id` | yes | Unique ID: lowercase letters, digits, `-` or `_` (max 40). |
| `label` | yes | Button text (max 32 characters). |
| `match` | yes | How to recognize the Logic App (see **Matching Logic Apps**). |
| `color` | no | Button and dialog color as `#rrggbb`. Text switches to dark automatically on light colors. Default `#605e5c` (gray). |
| `icon` | no | Short emoji or symbol shown before the label (1–2 characters). |
| `description` | no | Tooltip on the button. |
| `scope` | no | Where to look for the Logic App: `"resourceGroup"` (default, the incident's workspace resource group) or `"subscription"` (anywhere in the incident's subscription). |
| `confirm.title` | no | Dialog title. Default: the label. |
| `confirm.question` | no | Text above the playbook name in the dialog. |
| `confirm.button` | no | Confirm button text. Default: `Yes, run <label>`. |

Invalid buttons (missing `id`/`label`/`match`, bad regex, duplicate `id`)
are skipped. A maximum of 20 buttons is read.

------------------------------------------------------------------------

# Matching Logic Apps

Matching is **case-insensitive** and works on the Logic App **name**. Pick
the option that is consistent across your environments.

| `match` option | Matches | Example |
|---|---|---|
| `suffix` | Names ending with the text | `"suffix": "-isolate-host"` |
| `prefix` | Names starting with the text | `"prefix": "soc-"` |
| `contains` | Names containing the text | `"contains": "block-ip"` |
| `name` | One exact name | `"name": "Isolate-Host"` |
| `regex` | A regular expression | see below |
| `versioned` | `true` allows a trailing `-v<N>` after the match; highest N wins per client | `"versioned": true` |
| `exclude` | Skip names containing any of these | `"exclude": ["test", "draft"]` |

`prefix`, `suffix`, `contains` and `name` can be combined; all must match.

**Suffix is the recommended option** for environments that share a playbook
name but differ in client prefix. `(acme)-isolate-host-v4`,
`(globex)-isolate-host-v2` and `INITECH-isolate-host` all match
`"suffix": "-isolate-host", "versioned": true`. Do not put the
version in the suffix.

### Regex matching

Use `regex` when names don't follow a simple prefix/suffix. Optional
named groups give SentiBuddy the client code and version:

``` json
"match": { "regex": "^(?<client>[a-z0-9]+)_IsolateHost_v(?<version>\\d+)$" }
```

Remember to escape backslashes in JSON (`\\d`, not `\d`).

------------------------------------------------------------------------

# How the Client Is Chosen

When more than one matching Logic App is found (for example several clients
share a resource group), SentiBuddy picks one in this order:

1.  Only one match → it's used.
2.  `workspaceClientPattern` (the playbooks one, else the top-level one)
    extracts a code from the workspace name and exactly one playbook has
    that client code.
3.  A workspace name segment (split on `-`, `_`, `.`) equals a playbook's
    client code.
4.  A playbook's client code appears anywhere in the workspace name.

If none of these picks exactly one playbook, the dialog shows a
**drop-down of all matches** and the user must choose. Nothing is
pre-selected.

The **client code** is whatever is left of the Logic App name after removing
the matched text and version, with punctuation stripped.
`(acme)-isolate-host-v4` gives `acme`. For `regex` matches, it is the
`client` named group.

------------------------------------------------------------------------

# Permissions and Safety

-   Users need the same Azure rights as running the playbook from the portal.
    That typically means **Microsoft Sentinel Responder** on the workspace,
    **Microsoft Sentinel Playbook Operator** on the Logic App, and read
    access to list Logic Apps in the resource group or subscription.
    Sentinel itself also needs the **Microsoft Sentinel Automation
    Contributor** role on the playbook's resource group.
-   A button can only run a Logic App that matches **its own** `match`
    rules, in the incident's subscription. With the default `scope` it must
    also be in the incident's resource group. This is checked again when
    the run is requested, not only when the dialog opens.
-   The config is treated as untrusted input. Text is shown as plain text,
    colors must be `#rrggbb`, and lengths are capped.
-   The Config Link must be **https**.

------------------------------------------------------------------------

# Central Config Schema (addition)

``` json
"playbooks": {
  "type": "object",
  "properties": {
    "workspaceClientPattern": { "type": "string" },
    "buttons": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "label", "match"],
        "properties": {
          "id": { "type": "string", "pattern": "^[a-z0-9][a-z0-9_-]{0,39}$" },
          "label": { "type": "string", "maxLength": 32 },
          "color": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$" },
          "icon": { "type": "string" },
          "description": { "type": "string", "maxLength": 200 },
          "scope": { "enum": ["resourceGroup", "subscription"] },
          "match": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "prefix": { "type": "string" },
              "suffix": { "type": "string" },
              "contains": { "type": "string" },
              "regex": { "type": "string" },
              "versioned": { "type": "boolean" },
              "exclude": { "type": "array", "items": { "type": "string" } }
            }
          },
          "confirm": {
            "type": "object",
            "properties": {
              "title": { "type": "string", "maxLength": 60 },
              "question": { "type": "string", "maxLength": 300 },
              "button": { "type": "string", "maxLength": 40 }
            }
          }
        }
      }
    }
  }
}
```
