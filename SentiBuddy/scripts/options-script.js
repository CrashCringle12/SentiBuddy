// Listener for Open Config Command
chrome.runtime.sendMessage({action: "contentScriptReady"});

chrome.runtime.onMessage.addListener(
  function(request, sender, sendResponse) {
    console.log('Message received in content script:', request);
    if (request.action === "open-config") {
      console.log('Opening config file...');
      openConfigFile();
      sendResponse({status: "success"});
    }
    return true;  // Indicates that sendResponse will be called asynchronously
  }
);

function openConfigFile() {
  console.log('Attempting to open options page...');
  chrome.runtime.openOptionsPage(function() {
    if (chrome.runtime.lastError) {
      console.error('Error opening options page:', chrome.runtime.lastError);
    }
  });
}