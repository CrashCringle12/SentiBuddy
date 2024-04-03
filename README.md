# Chrome Browser Extension to enable Sentinel Desktop Notifications 

The extension will give desktop notifications for events in the queue. You will need a new tab dedicated exclusively to the queue (It does not always need to be viewable). The amount of notifications you receive is heavily dependent on your filters particularly whether you display only New or both New & Active incidents. It’s recommended to set your dedicated queue tab’s status filter to New. 

Presently, the extension will notify of the following:

* New - A new incident has appeared in the queue that has not appeared before during your current session.
* xxxx claimed - An incident previously seen in your session, has had an Owner change.
* A ---> B - The severity of a previously seen incident in your session has changed from A → B (shows as New* on older versions)
* Updated - The status of an incident previously seen in your session has changed.

## Instructions
1. Download the extension zip here and unzip to reveal its contents.
2. Open Chrome and click on the puzzle piece icon and select Manage Extensions <br><br> ![image](https://github.com/CrashCringle12/SentiNotiMe/assets/30600688/58acfe65-4332-4362-8e1e-f4331e816de0)
3. Enable Developer Mode in the upper right corner<br><br> ![image](https://github.com/CrashCringle12/SentiNotiMe/assets/30600688/388d4aa5-7002-4f74-b895-a62f816fae5f)
4. Select “Load unpacked” and select the folder SentinelQueueNotifs that you opened in Step 1. <br><br>![image](https://github.com/CrashCringle12/SentiNotiMe/assets/30600688/c981c8d7-cad7-4b6e-940f-4cb9a87f5534)
5. Verify the extension appears in the listing.<br><br> ![image](https://github.com/CrashCringle12/SentiNotiMe/assets/30600688/0a455131-4574-4905-b719-99fa9eb3a448)
6. Open up a new tab and pull up the queue as you would normally (Including any filters) <br><br> ![image](https://github.com/CrashCringle12/SentiNotiMe/assets/30600688/a605dd46-f699-4112-a142-89f0ed879b66)
7. To toggle the extension, Press ALT+A (Windows) or CMD+A (Mac).
8. Click on any alert. A red dotted line will surround the queue and a sample notification will display signifying the extension has been enabled. <br><br> ![image](https://github.com/CrashCringle12/SentiNotiMe/assets/30600688/4c2c11eb-f96f-44f8-bde3-41d0bc78afb5)
9. **Make sure Auto-refresh Incidents** is enabled

## 🔍Filtering Alerts [out of queue] with RegEx
This extension also allows you to filter incidents by Title using regular expressions. The config.json file can be found within the extension folder. The format for config.json is the following:
~~~~
{
    "doRemoveFromFilteredFromQueue": "true",
    "filterRegexPatterns": ["^Dummy-.*", "^TestAlert -.*"]
}
~~~~
**doRemoveFromFilteredFromQueue** - If this is set to true then new incidents with a title that is matched by your provided Regex patterns will be visually removed from the queue. These incidents will still technically be in the queue (untouched), but they will be hidden on your client.

**filterRegexPatterns** - This is where you can provide a list of regex patterns to check each new title against. If an incident is matched, it will not send a notification. Additionally, if doRemoveFromFilteredFromQueue is true, this incident will be visually removed from queue.

In the above example, new incidents that begin with “^Dummy-” or “TestAlert -” will not send notifications and will be hidden in your dedicated queue.

### Notes 
Make sure you set this up before setting up the extension. If you want to make edits after the fact, you can click the Update button in the Extensions page to reload the contents of the extension. Just make sure you restart your browser.

Refreshing the page or changing filters will unhide any hidden incidents.

This does NOT actually remove anything from the queue, but removes the relevant html that displays the row of the specific alert.


## 📄 FAQ
* Feel free to minimize this window if needed.
* You are able to safely refresh and alter filters.
* Feedback and suggestions welcome 🍎!

**Do not use this tab for normal use. The extension requires a dedicated tab to use for monitoring the queue for updates. As long as this tab exists and the extension is enabled, you’ll continue to receive notifications.**

# Troubleshooting
* The extension must be loaded before navigating to the queue. If you already pulled up the queue while setting up the extension, try reloading your page or restarting Chrome.
* If you are not seeing the red dotted line:
  * Try clicking on an Incident
  * Try holding ALT first then pressing A while still holding the key. Release the keys then click on an incident.
  * Check your active Extensions (See. Step #2), and ensure the extension appears there.
* If you are not receiving notifications, check your device’s notification settings
* If you are using Focus Assist you’ll need to manually allow Chrome to give notifications.
* For any other issues, feel free to put in an issue.
