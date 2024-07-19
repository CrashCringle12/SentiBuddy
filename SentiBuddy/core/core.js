console.log("core.js loaded");

// Unique ID for the className.
const MOUSE_VISITED_CLASSNAME = 'crx_mouse_visited';
const ELEMENT_CHANGED_CLASSNAME = 'elm_changed';

let enabled = false;
let observer, targetElem, DOMObserver;
let targetParents = [];

let incidents = {};
var initializing = true
// Previous dom, that we want to track, so we can remove the previous styling.
var prevDOM = null;

var deletedElementsComponent = document.createElement('div');
deletedElementsComponent.classList.add('deleted-nav');
var config = {};
var doRemoveFromQueue = true;

function loadConfig() {
    return new Promise((resolve) => {
        console.log("Loading config...");
        chrome.storage.local.get({
            doRemoveFromFilteredFromQueue: true,
            filterTitleRegexPatterns: [],
            filterTagsRegexPatterns: [],
            filterOwnerRegexPatterns: [],
            onlyAlertOnLatest: true,
            desktopNotifications: true
        }, (items) => {
            config = {
                doRemoveFromFilteredFromQueue: items.doRemoveFromFilteredFromQueue,
                filterTitleRegexPatterns: items.filterTitleRegexPatterns,
                filterTagsRegexPatterns: items.filterTagsRegexPatterns,
                filterOwnerRegexPatterns: items.filterOwnerRegexPatterns,
                onlyAlertOnLatest: items.onlyAlertOnLatest,
                desktopNotifications: items.desktopNotifications
            };
            doRemoveFromQueue = config.doRemoveFromFilteredFromQueue;
            console.log("Config loaded:", JSON.stringify(config, null, 2));
            console.log("Title patterns:", config.filterTitleRegexPatterns);
            console.log("Tags patterns:", config.filterTagsRegexPatterns);
            console.log("Owner patterns:", config.filterOwnerRegexPatterns);
            console.log("doRemoveFromQueue:", doRemoveFromQueue);
            resolve();
        });
    });
}

// Call loadConfig immediately and then every 5 minutes
loadConfig().then(() => {
    setInterval(loadConfig, 5 * 60 * 1000);
});

// Listen for changes in storage
chrome.storage.onChanged.addListener((changes, namespace) => {
    console.log('Storage changes detected:', changes);
    loadConfig();
});

function checkStoredPatterns() {
    chrome.storage.local.get(['filterTitleRegexPatterns', 'filterTagsRegexPatterns', 'filterOwnerRegexPatterns'], function(result) {
        console.log('Currently stored patterns:');
        console.log('Title patterns:', result.filterTitleRegexPatterns);
        console.log('Tags patterns:', result.filterTagsRegexPatterns);
        console.log('Owner patterns:', result.filterOwnerRegexPatterns);
    });
}

function checkWordAgainstPatterns(title, patterns) {
    console.log(`Checking "${title}" against patterns:`, patterns);
    for (let pattern of patterns) {
        try {
            let regex = new RegExp(pattern, 'i');
            if (regex.test(title)) {
                console.log(`Match found: "${title}" matches pattern: ${pattern}`);
                return true;
            }
        } catch (error) {
            console.error(`Invalid regex pattern: ${pattern}. Error: ${error.message}`);
        }
    }
    console.log(`No match found for: "${title}"`);
    return false;
}

function checkTagsAgainstPatterns(tags, patterns) {
    console.log(`Checking tags: "${tags}" against patterns:`, patterns);
    for (let pattern of patterns) {
        let regex = new RegExp(pattern, 'i');
        var tagsSplit = tags.split(',');
        if (tagsSplit.length > 1) {
            for (let tag of tagsSplit) {
                if (regex.test(tag)) {
                    console.log(`tag ${tag} : matches pattern: ${pattern}`);
                    return true;
                }
            }
        } else {
            if (regex.test(tags)) {
                console.log(`Tags ${tags} : matches pattern: ${pattern}`);
                return true;
            }
        }
    }
    console.log(`No tag match found for: "${tags}"`);
    return false;
}

function getElementByXpath(path) {
    return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
}

var highlightFunc = function (e) {
    var srcElement = e.srcElement;
    if (prevDOM != null) {
        prevDOM.classList.remove(MOUSE_VISITED_CLASSNAME);
    }
    srcElement.classList.add(MOUSE_VISITED_CLASSNAME);
    prevDOM = srcElement;
}

var getTargetParents = function (element) {
    let p = [];
    let parent = element.parentElement;
    while (parent) {
        p.push(parent);
        parent = parent.parentElement;
    }
    return p
}

var checkAndUpdateIncident = function (client, incID, currentSeverity, owner, status) {
    var incident = incidents[client + incID];
    var eventType = "NONE"
    if (incident) {
        if (incident.owner != "Assign to me") {
            if (incident.owner != owner) {
                console.log(incID + " Incident has a new Owner")
                eventType = owner + " claimed";
            } else if (incident.severity != currentSeverity) {
                console.log(incID + " Incident ID seen before but severity changed.");
                eventType = incident.severity + " -->";
            } else if (incident.status != status) {
                eventType = "Updated";
            }
        }
    } else {
        console.log("New Incident ID." + incID);
        eventType = "New"
    }
    incidents[client + incID] = { severity: currentSeverity, status: status, owner: owner, lastSeen: new Date().toISOString() };
    return eventType;
}

var defaultQueue = function () {
    console.log("defaultQueue function called");
    loadConfig().then(() => {
        var e = document.querySelector(".ext-gridControl-container");
        if (!e) {
            console.log("Grid container not found");
            return;
        }
        removeListeners();
        enabled = false;

        if (observer) {
            observer.disconnect();
            DOMObserver.disconnect();
            targetElem.classList.remove(ELEMENT_CHANGED_CLASSNAME);
        }

        targetElem = e;
        observer = new MutationObserver(function () {
            console.log("MutationObserver triggered");
            var headers = document.querySelectorAll('.fxc-gc-columnheader-content.fxc-gc-text');
            var indexes = {};
            headers.forEach((header, index) => {
                var columnName = header.textContent.trim();
                indexes[columnName] = index;
            });
            console.log("Column indexes:", indexes);

            var rows = document.querySelectorAll(".fxc-gc-row-content.fxc-gc-row-content_0")
            console.log("Starting queue processing. Total rows:", rows.length);
            var sendMessage = true
            rows.forEach((row, index) => {
                elements = row.querySelectorAll('[id^="fxc-gc-cell-content"]');
                if (elements[indexes["Severity"]] && elements[indexes["Title"]]) {
                    var severity = elements[indexes["Severity"]].textContent.trim();
                    var title = elements[indexes["Title"]].textContent.trim();
                    var workspace = "";
                    if (elements[indexes["Workspace"]]) {
                        workspace = elements[indexes["Workspace"]].textContent.trim();
                    } else {
                        workspace = document.querySelector('.fxs-blade-title-subtitleText.msportalfx-tooltip-overflow.fxs-portal-subtext').textContent.trim();
                        workspace = workspace.match(/'([^']+)'/)[1];
                    }
                    var incID = elements[indexes["Incident number"]].textContent.trim();
                    var numAlerts = elements[indexes["Alerts"]].textContent.trim();
                    var status = elements[indexes["Status"]].textContent.trim();
                    var owner = elements[indexes["Owner"]].textContent.trim();
                    var row = elements[indexes["Owner"]].parentNode.parentNode;
                    var tags = elements[indexes["Tags"]].textContent.trim();
                    var workspaceSplit = workspace.split('-');
                    var client = workspace
                    if (workspaceSplit.length > 1) {
                        client = workspaceSplit[1].toUpperCase();
                    } else {
                        console.log("Split array does not have two elements.");
                    }
                    var eventType = checkAndUpdateIncident(client, incID, severity, owner, status);

                    console.log(`Processing incident: ${incID}, Title: "${title}", Client: ${client}`);
                    
                    var incMatchesRegex = checkWordAgainstPatterns(title, config.filterTitleRegexPatterns);
                    console.log(`Title match result: ${incMatchesRegex}`);
                    
                    if (!incMatchesRegex) {
                        incMatchesRegex = checkWordAgainstPatterns(owner, config.filterOwnerRegexPatterns);
                        console.log(`Owner match result: ${incMatchesRegex}`);
                    }
                    
                    if (!incMatchesRegex) {
                        incMatchesRegex = checkTagsAgainstPatterns(tags, config.filterTagsRegexPatterns);
                        console.log(`Tags match result: ${incMatchesRegex}`);
                    }

                    console.log(`Final match result: ${incMatchesRegex}, doRemoveFromQueue: ${doRemoveFromQueue}`);

                    if (incMatchesRegex && doRemoveFromQueue) {
                        console.log(`Attempting to hide ${client} ${incID}`);
                        try {
                            row.style.display = 'none';  // First, try hiding it
                            console.log(`Row hidden: ${row.style.display === 'none'}`);
                            
                            // Then, try removing it
                            let removed = row.parentNode.removeChild(row);
                            console.log(`Row removed: ${removed !== null}`);
                        } catch (error) {
                            console.error(`Error hiding/removing row: ${error.message}`);
                        }
                    } else {
                        console.log(`Not hiding ${client} ${incID}`);
                    }

                    if (!initializing) {
                        var message = {
                            type: 'notification',
                            element: targetElem,
                            info: {
                                element: row,
                                severity: severity,
                                title: title,
                                client: client,
                                workspace: workspace,
                                incID: incID,
                                status: status,
                                owner: owner,
                                eventType: eventType,
                                numAlerts: numAlerts
                            }
                        };

                        if (eventType != "NONE" && !incMatchesRegex && sendMessage) {
                            chrome.storage.local.get({ desktopNotifications: false }, (items) => {
                                if (items.desktopNotifications) {
                                    if (config.onlyAlertOnLatest) {
                                        sendMessage = false;
                                    }
                                    if (message) {
                                        console.log("Sending notification message:", message);
                                        chrome.runtime.sendMessage(message);
                                    }
                                }
                            });
                        }
                    }
                } else {
                    console.log("Nothing in Queue");
                }
            });
            console.log("Finished queue processing. Visible rows:", document.querySelectorAll(".fxc-gc-row-content.fxc-gc-row-content_0:not([style*='display: none'])").length);
            observer.disconnect();
            targetElem.classList.add(ELEMENT_CHANGED_CLASSNAME);
            observer.observe(targetElem, { childList: true, subtree: true, characterData: true, attributes: true });
            if (initializing) {
                console.log("Finished Initializing")
                initializing = false
            }
        });

        observer.observe(targetElem, { childList: true, subtree: true, characterData: true, attributes: true });

        DOMObserver = new MutationObserver(function (mutations) {
            for (const m of mutations) {
                if (m.removedNodes.length > 0) {
                    if (!document.body.contains(targetElem)) {
                        chrome.runtime.sendMessage({ type: 'notification', element: targetElem });
                        DOMObserver.disconnect()
                        p = getElementByXpath("//div[@class='ext-gridControl']")
                        p.classList.add(ELEMENT_CHANGED_CLASSNAME);
                    }
                }
            }
        });
        DOMObserver.observe(document.body, { childList: true, subtree: true });
    });
}

var addListeners = function () {
    document.addEventListener('mousemove', highlightFunc, false);
}

var removeListeners = function () {
    document.removeEventListener('mousemove', highlightFunc, false);
    if (prevDOM != null) {
        prevDOM.classList.remove(MOUSE_VISITED_CLASSNAME);
    }
}

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    console.log('Message received in content script:', request);
    if (request.type === 'toggle-queue-filtering') {
        console.log('Toggling queue filtering. Current state:', enabled);
        if (observer) {
            observer.disconnect();
            DOMObserver.disconnect();
            targetElem.classList.remove(ELEMENT_CHANGED_CLASSNAME);
        }
        if (enabled) {
            removeListeners();
        } else {
            defaultQueue();
        }
        enabled = !enabled;
        console.log('Queue filtering new state:', enabled);
        sendResponse({ success: true, enabled: enabled });
    } else if (request.type === 'get-queue-state') {
        console.log('Getting queue state:', enabled);
        sendResponse({ enabled: enabled });
    } else if (request.type === 'check-patterns') {
        checkStoredPatterns();
        sendResponse({ success: true });
    }
});

// Notify the background script that the content script is ready
console.log("Sending contentScriptReady message");
chrome.runtime.sendMessage({ action: "contentScriptReady" });