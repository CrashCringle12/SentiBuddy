// Unique ID for the className.
const MOUSE_VISITED_CLASSNAME = 'crx_mouse_visited';
const ELEMENT_CHANGED_CLASSNAME = 'elm_changed';

let enabled = false;
let observer, targetElem, DOMObserver;
let targetParents = [];

let incidents = {};
// Previous dom, that we want to track, so we can remove the previous styling.
var prevDOM = null;

var deletedElementsComponent = document.createElement('div');
deletedElementsComponent.classList.add('deleted-nav');
var config = {};
var doRemoveFromQueue = true;
function loadConfig() {
  chrome.storage.local.get({
    doRemoveFromFilteredFromQueue: true, // Default values if not set
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
      console.log("Config loaded:", config);
    });
}
loadConfig();
var initializing = config.desktopNotifications
function checkWordAgainstPatterns(title, patterns) {
  for (let pattern of patterns) {
    let regex = new RegExp(pattern);
    if (regex.test(title)) {
      console.log(`{{ ${title} }}: matches pattern: ${pattern}`);
      return true;
    }
  }
  return false;
}


function checkTagsAgainstPatterns(tags, patterns) {
  //console.log("Testing Tags")
  for (let pattern of patterns) {
   // console.log(`"${pattern} Test`)
    let regex = new RegExp(pattern);
    // Splitting the string on the hyphen
    var tagsSplit = tags.split(',');
    // Check if the split array has at least two elements
    //console.log("Length: " + tagsSplit.length)
    if (tagsSplit.length > 1) {
      for (let tag of tagsSplit) {
        //console.log(`Testing ${tag} vs ${pattern}`)
        if (regex.test(tag)) {
          console.log(`tag ${tag} : matches pattern: ${pattern}`);
          return true;
        }
      }
    } else {
      if (regex.test(tags)) {
        console.log(`Tags ${tags}  : matches pattern: ${pattern}`);
        return true;
      }
    }
  }
  return false;
}

function getElementByXpath(path) {
  return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
}

// Highlights the DOM element when the mouse moves
var highlightFunc = function (e) {
  var srcElement = e.srcElement;

  // For NPE checking, we check safely. We need to remove the class name
  // Since we will be styling the new one after.
  if (prevDOM != null) {
    prevDOM.classList.remove(MOUSE_VISITED_CLASSNAME);
  }
  // Add a visited class name to the element. So we can style it.
  srcElement.classList.add(MOUSE_VISITED_CLASSNAME);

  // The current element is now the previous. So we can remove the class
  // during the next iteration.
  prevDOM = srcElement;
}


// getTargetParents stores the selected element hierarchy
// so it can be compared later to highlight the last existing
// parent.
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
  var incident = incidents[client+incID];
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
        } else {
          //console.log("This incident " + incID + " has been seen before");
        }
    }
  } else {
    // New Incident ID
    console.log("New Incident ID." + incID);
    eventType = "New"
  }

  // Update the in-memory object
  incidents[client+incID] = { severity: currentSeverity, status: status, owner: owner, lastSeen: new Date().toISOString() };
  return eventType;
}


// Whenever the user clicks something, create an observer that will
// notify background so the notification can be triggered.
var defaultQueue = function () {
  var e = document.querySelector(".ext-gridControl-container");
  if (!e) {
    //The node we need does not exist yet.
    //Wait 500ms and try again
    //window.setTimeout(defaultQueue,500);
    return;
  }
  // After selecting the element, disable
  removeListeners();
  enabled = false;

  // Only 1 observer supported to start.
  if (observer) {
    observer.disconnect();
    DOMObserver.disconnect();

    targetElem.classList.remove(ELEMENT_CHANGED_CLASSNAME);
  }

  targetElem = e;
  observer = new MutationObserver(function () {
    // Get the column headers
    var headers = document.querySelectorAll('.fxc-gc-columnheader-content.fxc-gc-text');
    // Determine the index of each column
    var indexes = {};
    headers.forEach((header, index) => {
      var columnName = header.textContent.trim();
      indexes[columnName] = index;
    });
    console.log("****************");

    // Get all rows in the queue
    var rows = document.querySelectorAll(".fxc-gc-row-content.fxc-gc-row-content_0")
    var sendMessage = true
    rows.forEach((row, index) => {
      elements = row.querySelectorAll('[id^="fxc-gc-cell-content"]');
      //console.log(elements.length)
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
        // Splitting the string on the hyphen
        var workspaceSplit = workspace.split('-');
        var client = workspace
        // Check if the split array has at least two elements
        if (workspaceSplit.length > 1) {
          // Set client to the second element of the array, converted to uppercase
          client = workspaceSplit[1].toUpperCase();
        } else {
          console.log("Split array does not have two elements.");
        }
        var eventType = checkAndUpdateIncident(client, incID, severity, owner, status);
        
        var incMatchesRegex = checkWordAgainstPatterns(title, config.filterTitleRegexPatterns);
        var incMatchesRegex = incMatchesRegex ? incMatchesRegex : checkWordAgainstPatterns(owner, config.filterOwnerRegexPatterns)
        var incMatchesRegex = incMatchesRegex ? incMatchesRegex : checkTagsAgainstPatterns(tags, config.filterTagsRegexPatterns)
        if (incMatchesRegex && doRemoveFromQueue) {
          console.log("Hiding " + client + " " + incID);
          row.parentNode.removeChild(row);
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

          if (eventType != "NONE" && !incMatchesRegex && config.desktopNotifications && sendMessage) {
            if (config.onlyAlertOnLatest) {
              sendMessage = false
            }
            if (message) {
              chrome.runtime.sendMessage(message);
            }
            //console.log("Sending")
          } else {
            //console.log("Not sending");
          }
        }
      } else {
        console.log("Nothing in Queue");
      }

    });
   // console.log(incidents)
    // Disconnect the observer temporarily so we can set the class name
    // to avoid triggering and endless loop.
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
      // A removal happened in the DOM, let's
      // check if our element was removed.
      if (m.removedNodes.length > 0) {

        if (!document.body.contains(targetElem)) {

          chrome.runtime.sendMessage({ type: 'notification', element: targetElem });

          // Disconnect the DOM observer otherwise we'll get notified
          // for each change on the DOM.
          DOMObserver.disconnect()


          // highlight it.
          p = getElementByXpath("//div[@class='ext-gridControl']")
          p.classList.add(ELEMENT_CHANGED_CLASSNAME);
        }
      }
    }
  });
  DOMObserver.observe(document.body, { childList: true, subtree: true });
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

// Every time we get a new message toggle the plugin
chrome.runtime.onMessage.addListener(function (request) {
  selectMode = false;
  if (request.type == 'toggle' || request.type == 'toggle-queue-filtering') {
    // Remove any previous observers listeners if there are any;
    if (observer) {
      observer.disconnect();
      DOMObserver.disconnect();
      targetElem.classList.remove(ELEMENT_CHANGED_CLASSNAME);
    }
    if (enabled) {
      removeListeners();
    } else {
      console.log(selectMode);
      if (!selectMode) {
        var e = document.querySelector(".ext-gridControl-container");
        if (!e) {
          //The node we need does not exist yet.
          //Wait 500ms and try again
          //window.setTimeout(defaultQueue,500);
          return;
        }
        enabled = false;
        targetElem = e;
        // Get the column headers
        var headers = document.querySelectorAll('.fxc-gc-columnheader-content.fxc-gc-text');
        // Determine the index of each column
        var indexes = {};
        headers.forEach((header, index) => {
          var columnName = header.textContent.trim();
          indexes[columnName] = index;
        });
        console.log("****************");

        // Get all rows in the queue
        var rows = document.querySelectorAll(".fxc-gc-row-content.fxc-gc-row-content_0")
        var sendMessage = true
        rows.forEach((row, index) => {
          elements = row.querySelectorAll('[id^="fxc-gc-cell-content"]');
          //console.log(elements.length)
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
            // Splitting the string on the hyphen
            var workspaceSplit = workspace.split('-');
            var client = workspace
            // Check if the split array has at least two elements
            if (workspaceSplit.length > 1) {
              // Set client to the second element of the array, converted to uppercase
              client = workspaceSplit[1].toUpperCase();
            } else {
              console.log("Split array does not have two elements.");
            }
            var eventType = checkAndUpdateIncident(client, incID, severity, owner, status);
            
            var incMatchesRegex = checkWordAgainstPatterns(title, config.filterTitleRegexPatterns);
            var incMatchesRegex = incMatchesRegex ? incMatchesRegex : checkWordAgainstPatterns(owner, config.filterOwnerRegexPatterns)
            var incMatchesRegex = incMatchesRegex ? incMatchesRegex : checkTagsAgainstPatterns(tags, config.filterTagsRegexPatterns)
            if (incMatchesRegex && doRemoveFromQueue) {
              console.log("Hiding " + client + " " + incID);
              row.parentNode.removeChild(row);
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

              if (eventType != "NONE" && !incMatchesRegex && config.desktopNotifications && sendMessage) {
                if (config.onlyAlertOnLatest) {
                  sendMessage = false
                }
                if (message) {
                  chrome.runtime.sendMessage(message);
                }
                //console.log("Sending")
              } else {
                //console.log("Not sending");
              }
            }
          } else {
            console.log("Nothing in Queue");
          }

        });
      // console.log(incidents)
        // Disconnect the observer temporarily so we can set the class name
        // to avoid triggering and endless loop.
        targetElem.classList.add(ELEMENT_CHANGED_CLASSNAME);
        if (initializing) {
          console.log("Finished Initializing")
          initializing = false
        }
        defaultQueue();
      } else {
        addListeners();
      }
    }
    enabled = !enabled;
  } else if (request.type === 'start-queue-filtering') {
    console.log("STARTING")
    // Call your function to start queue filtering
    defaultQueue();  // Assuming this is the function that starts the queue filtering
  }
});

