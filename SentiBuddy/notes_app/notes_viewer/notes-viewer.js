function displayNotesList() {
    chrome.storage.local.get({ templates: [] }, (result) => {
      const notesList = result.templates;
      const notesListContainer = document.getElementById('notesList');
      notesListContainer.innerHTML = '';
  
      // Group notes by client
      const notesByClient = notesList.reduce((acc, note) => {
        if (!note.client) {
          note.client = "TEMPLATE"
        }
        if (!acc[note.client]) {
          acc[note.client] = [];
        }
        acc[note.client].push(note);
        return acc;
      }, {});
  
      // Display each client and their notes
      for (const client in notesByClient) {
        const clientHeader = document.createElement('h2');
        clientHeader.textContent = client;
        notesListContainer.appendChild(clientHeader);
  
        const clientNotes = notesByClient[client];
        clientNotes.forEach((note, index) => {
          const noteItem = document.createElement('div');
          noteItem.classList.add('note-item');
          noteItem.textContent = `INC-${note.number} (${note.template || 'No Template'})`;
          noteItem.addEventListener('click', () => displayNoteDetails(index));
          notesListContainer.appendChild(noteItem);
        });
      }
    });
  }
  
  function displayNoteDetails(index) {
    chrome.storage.local.get({ templates: [] }, (result) => {
      const note = result.templates[index];
      const noteDetailsContainer = document.getElementById('noteDetails');
      if (note.isTemplate) {
        noteDetailsContainer.innerHTML = `
        <h2>2${note.name}</h2>
        ${applyHtmlFormatting(note.content)}
      `;
      } else {
        noteDetailsContainer.innerHTML = `
        <h2>1INC-${note.number} - ${note.client}</h2>
        ${applyHtmlFormatting(note.content)}
      `;
      }
  
    });
  }
  
  // Function to apply HTML formatting
  function applyHtmlFormatting(content) {
    let formattedContent = content;
  
    // Apply bold formatting
    formattedContent = formattedContent.replace(/\*\*(.*?)\*\*/g, '<p><strong>$1</strong></p>');
  
    // Apply code block formatting
    formattedContent = formattedContent.replace(/```([\s\S]*?)```/gs, function(match, code) {
      const codeWithoutEmptyLines = code.replace(/^\s*[\r\n]/gm, '');
      return '<pre><code>' + codeWithoutEmptyLines.replace(/\n/g, '<br>') + '</code></pre>';
    });
  
    const lines = formattedContent.split('\n');
    let insideCodeBlock = false;
    let insideBulletList = false;
    const formattedLines = [];
  
    for (const line of lines) {
      if (line.trim() === '') {
        continue;
      }
  
      if (line.startsWith('<pre><code>')) {
        insideCodeBlock = true;
        insideBulletList = false;
        formattedLines.push(line);
      } else if (line.startsWith('</pre></code>')) {
        insideCodeBlock = false;
        insideBulletList = false;
        formattedLines.push(line);
      } else if (!insideCodeBlock && !line.startsWith('<p><strong>')) {
        if (!insideBulletList) {
          insideBulletList = true;
          formattedLines.push('<ul>');
        }
        formattedLines.push(`<li>${line}</li>`);
      } else {
        if (insideBulletList) {
          formattedLines.push('</ul>');
          insideBulletList = false;
        }
        formattedLines.push(line);
      }
    }
  
    if (insideBulletList) {
      formattedLines.push('</ul>');
    }
  
    formattedContent = formattedLines.join('\n');
  
    return formattedContent;
  }
document.addEventListener('DOMContentLoaded', displayNotesList);
  