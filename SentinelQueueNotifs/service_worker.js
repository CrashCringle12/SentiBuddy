const notificationTab = {};
function faviconURL(u) {
    const url = new URL(chrome.runtime.getURL("/_favicon/"));
    url.searchParams.set("pageUrl", u);
    url.searchParams.set("size", "32");
    return url.toString();
  }

chrome.runtime.onMessage.addListener(function(request, sender) {
  console.log(sender)
  if (request.type == 'notification') {
    console.log(request.info)
    const notId = 'notification' + Math.random();
    notificationTab[notId] = sender.tab.id;
    chrome.notifications.create(notId, {
      type: 'basic',
      //title: 'Change in ' + sender.tab.title,
      title: request.info.eventType + ' ' + request.info.severity + ' ' + request.info.client + ' ' + 'Incident w/ ' + request.info.numAlerts + ' Alert(s)',
      message: 'INC: ' + request.info.incID + ' - ' + request.info.title,
      iconUrl: faviconURL(sender.tab.url),
    });
  }
});

chrome.commands.onCommand.addListener(function (command) {
  switch (command) {
    case 'select-toggle':
    case 'toggle':
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs){
        chrome.tabs.sendMessage(tabs[0].id, { type: 'toggle' });
      });
      break;
  }
});

chrome.notifications.onClicked.addListener(function callback(notificationId) {
  var updateProperties = { 'active': true };
  chrome.tabs.update(notificationTab[notificationId], updateProperties);
  chrome.notifications.clear(notificationId);
  window.focus();
});