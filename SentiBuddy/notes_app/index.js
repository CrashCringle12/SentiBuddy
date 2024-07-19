document.getElementById('templateCreatorBtn').addEventListener('click', (event) => {
  setActiveButton(event.target);
  loadContent(chrome.runtime.getURL("notes_app/template_creator/template-creator.html"));
});

document.getElementById('noteGeneratorBtn').addEventListener('click', (event) => {
  setActiveButton(event.target);
  loadContent(chrome.runtime.getURL("notes_app/note_generator/note-generator.html"));
});

function setActiveButton(clickedButton) {
  // Remove 'active' state from all buttons
  document.querySelectorAll('senti-button').forEach(button => {
    button.setActive(false);
  });
  
  // Set 'active' state for clicked button
  clickedButton.setActive(true);
}

function loadContent(url) {
  const frame = document.getElementById('contentFrame');
  frame.src = url;
  frame.style.display = 'block';
}

window.addEventListener('load', function() {
  window.parent.postMessage({
    type: 'resize',
    height: document.body.scrollHeight
  }, '*');
});

// // Set initial active state for the first button (optional)
// window.addEventListener('DOMContentLoaded', (event) => {
//   const firstButton = document.querySelector('senti-button');
//   if (firstButton) {
//     setActiveButton(firstButton);
//   }
// });