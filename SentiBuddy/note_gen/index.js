document.getElementById('templateCreatorBtn').addEventListener('click', () => {
  chrome.windows.create({
      url: chrome.runtime.getURL("note_gen/template/template-creator.html"),
      type: "popup",
      width: 800,
      height: 600
  });
});

document.getElementById('noteGeneratorBtn').addEventListener('click', () => {
  chrome.windows.create({
      url: chrome.runtime.getURL("note_gen/note-generator.html"),
      type: "popup",
      width: 800,
      height: 600
  });
});
