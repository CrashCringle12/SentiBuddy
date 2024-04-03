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
    fetch(chrome.runtime.getURL('config.json'))
        .then(response => response.json())
        .then(json => {
            config = json;  // Store the parsed JSON in the global variable
            doRemoveFromQueue = config.doRemoveFromFilteredFromQueue;
            console.log("Config loaded:", config);
            // Optionally, call any initialization functions here
        })
        .catch(error => console.error("Error loading config:", error));
}
loadConfig();

function checkTitleAgainstPatterns(title, patterns) {  
    for (let pattern of patterns) {
      let regex = new RegExp(pattern);
      if (regex.test(title)) {
        console.log(`Title matches pattern: ${pattern}`);
        return true;
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
var getTargetParents = function(element) {
  let p = [];
  let parent = element.parentElement;
  while(parent) {
    p.push(parent);
    parent = parent.parentElement;
  }

  return p
}

var checkAndUpdateIncident = function(incID, currentSeverity, owner, status) {
    var incident = incidents[incID];
    var eventType = "NONE"
    if (incident) {
        if (incident.owner != owner) {
            console.log("Incident has a new Owner")
            eventType = owner + " claimed";
        } else if (incident.severity != currentSeverity) {
            console.log("Incident ID seen before but severity changed.");
            eventType = incident.severity + " -->";
        } else if (incident.status != status) {
            eventType = "Updated";
        } else {
            console.log("This incident has been seen before");
        }
    } else {
        // New Incident ID
        console.log("New Incident ID.");
        eventType = "New"
    }

    // Update the in-memory object
    incidents[incID] = { severity: currentSeverity, status: status, owner: owner, lastSeen: new Date().toISOString() };
    return eventType;
}
// Whenever the user clicks something, create an observer that will
// notify background so the notification can be triggered.
var defaultQueue = function () {
  var e = document.querySelector(".ext-gridControl-container");
  if(!e) {
    //The node we need does not exist yet.
    //Wait 500ms and try again
    //window.setTimeout(defaultQueue,500);
    return;
}
  // After selecting the element, disable the extension.
  removeListeners();
  enabled = false;

  // Only 1 observer supported to start.
  if (observer) {
    observer.disconnect();
    DOMObserver.disconnect();
    targetElem.classList.remove(ELEMENT_CHANGED_CLASSNAME);
  }

  targetElem = e;
  observer = new MutationObserver(function() {
    // Get the column headers
    var headers = document.querySelectorAll('.fxc-gc-columnheader-content.fxc-gc-text');
    // Determine the index of each column
    var indexes = {};
    headers.forEach((header, index) => {
        var columnName = header.textContent.trim();
        indexes[columnName] = index;
    });
    // Get all elements whose ID contains "fxc-gc-cell-content"
    var elements = document.querySelectorAll('[id^="fxc-gc-cell-content"]');
    //console.log(elements.length)
    // Assuming the desired element is the third  one in the collection
    if (elements[indexes["Severity"]] && elements[indexes["Title"]]) {
        var severity = elements[indexes["Severity"]].textContent.trim();
        var title = elements[indexes["Title"]].textContent.trim();
        var workspace = ""
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
        var eventType = checkAndUpdateIncident(incID, severity, owner, status);
        console.log(incidents)
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
    
        var incMatchesRegex = checkTitleAgainstPatterns(title, config.filterRegexPatterns);
        if (incMatchesRegex && doRemoveFromQueue) {
            console.log("Hiding " + client + " " + incID);
            row.parentNode.removeChild(row);
        }
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
    
        if(eventType != "NONE" && !incMatchesRegex) {
            chrome.runtime.sendMessage(message);
        } else {
            console.log("Not sending");
        }
    } else {
        console.log("Nothing in Queue");
    }
    // Disconnect the observer temporarily so we can set the class name
    // to avoid triggering and endless loop.
    observer.disconnect();
    targetElem.classList.add(ELEMENT_CHANGED_CLASSNAME);
    observer.observe(targetElem, { childList: true, subtree: true, characterData: true, attributes: true });

  });

  observer.observe(targetElem, { childList: true, subtree: true, characterData: true, attributes: true });

  DOMObserver = new MutationObserver(function(mutations) {
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

// Old legacy code 
// Whenever the user clicks something, create an observer that will
// notify background so the notification can be triggered.
var selectFunc = function (e) {
    console.log(e)
  // Don't perform the default action on the element.
  e.preventDefault();

  // After selecting the element, disable the extension.
  removeListeners();
  enabled = false;

  // Only 1 observer supported to start.
  if (observer) {
    observer.disconnect();
    DOMObserver.disconnect();
    targetElem.classList.remove(ELEMENT_CHANGED_CLASSNAME);
  }

  // Get the column headers
  var headers = document.querySelectorAll('.fxc-gc-columnheader-content.fxc-gc-text');
  // Determine the index of each column
  var indexes = {};
  headers.forEach((header, index) => {
    var columnName = header.textContent.trim();
    indexes[columnName] = index;
  });

  targetElem = e.srcElement;
  targetParents = getTargetParents(e.srcElement);
  observer = new MutationObserver(function() {
    // Get all elements whose ID contains "fxc-gc-cell-content"
    var elements = document.querySelectorAll('[id^="fxc-gc-cell-content"]');
    console.log(elements.length)
    // Assuming the desired element is the third  one in the collection
    var severity = elements[indexes["Severity"]].textContent.trim();
    var title = elements[indexes["Title"]].textContent.trim();
    var workspace = elements[indexes["Workspace"]].textContent.trim();
    var incID = elements[indexes["Incident number"]].textContent.trim();
    var numAlerts = elements[indexes["Alerts"]].textContent.trim();
    var status = elements[indexes["Status"]].textContent.trim();
    var owner = elements[indexes["Owner"]].textContent.trim();
    var eventType = checkAndUpdateIncident(incID, severity, owner, status);
    console.log(incidents)
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
    var message = {
        type: 'notification',
        element: targetElem,
        info: {
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

    if(eventType != "NONE") {
        chrome.runtime.sendMessage(message);
    } else {
        console.log("Not sending");
    }

    // Disconnect the observer temporarily so we can set the class name
    // to avoid triggering and endless loop.
    observer.disconnect();
    targetElem.classList.add(ELEMENT_CHANGED_CLASSNAME);
    observer.observe(targetElem, { childList: true, subtree: true, characterData: true, attributes: true });

  });

  observer.observe(targetElem, { childList: true, subtree: true, characterData: true, attributes: true });

  DOMObserver = new MutationObserver(function(mutations) {
    for (const m of mutations) {
      // A removal happened in the DOM, let's
      // check if our element was removed.
      if (m.removedNodes.length > 0) {

        if (!document.body.contains(targetElem)) {

          chrome.runtime.sendMessage({ type: 'notification', element: targetElem });

          // Disconnect the DOM observer otherwise we'll get notified
          // for each change on the DOM.
          DOMObserver.disconnect()


          // Traverse up the target parents until we find the first element
          // that hasn't been removed and highlight it.

          for (let p of targetParents) {
            if(document.body.contains(p)) {
              p.classList.add(ELEMENT_CHANGED_CLASSNAME);
              break;
            }
          }
        }
      }
    }
  });
  DOMObserver.observe(document.body, { childList: true, subtree: true });
}

var addListeners = function() {
    document.addEventListener('mousemove', highlightFunc, false);
    document.addEventListener('click', selectFunc, false);
}

var removeListeners = function() {
  document.removeEventListener('mousemove', highlightFunc, false);
  document.removeEventListener('click', selectFunc, false);
  if (prevDOM != null) {
    prevDOM.classList.remove(MOUSE_VISITED_CLASSNAME);
  }
}

// Every time we get a new message toggle the plugin
chrome.runtime.onMessage.addListener(function(request) {
  selectMode = false;
  if (request.type == 'select-toggle') {
    selectMode = true;
  }
  if (request.type == 'toggle') {
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
        defaultQueue();
      } else {
        addListeners();
      }
    }
    enabled = !enabled;
  }
});