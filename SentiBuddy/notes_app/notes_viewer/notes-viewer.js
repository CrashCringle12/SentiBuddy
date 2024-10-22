let db;

// Function to initialize the database
function initializeDB() {
  return new Promise((resolve, reject) => {
    if (db) {
      return resolve(db); // If db is already initialized, return it
    }

    const request = indexedDB.open('TemplatesDB', 1);

    request.onerror = function (event) {
      console.error('Error opening IndexedDB:', event.target.errorCode);
      reject(event.target.errorCode);
    };

    request.onsuccess = function (event) {
      db = event.target.result;
      console.log('Database initialized');
      resolve(db);
    };

    request.onupgradeneeded = function (event) {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('templates')) {
        const objectStore = db.createObjectStore('templates', { keyPath: 'name' });
        objectStore.createIndex('name', 'name', { unique: true });
      }
    };
  });
}

// Fetching the notes and displaying them grouped by client
function displayNotesList() {
  initializeDB().then(() => {
    const transaction = db.transaction(['templates'], 'readonly');
    const templateStore = transaction.objectStore('templates');
    const request = templateStore.getAll();

    request.onsuccess = function (event) {
      const notesList = event.target.result;
      const notesListContainer = document.getElementById('notesList');
      notesListContainer.innerHTML = '';

    const notesByClient = notesList.reduce((acc, note) => {
      if (!note.client) {
        note.client = "TEMPLATE";
      }
      if (!acc[note.client]) {
        acc[note.client] = [];
      }
      acc[note.client].push(note);
      return acc;
    }, {});
    // Sort the clients, ensuring "TEMPLATES" comes first
      const sortedClients = Object.keys(notesByClient).sort((a, b) => {
        if (a === "TEMPLATE") return -1; // "TEMPLATES" should come first
        if (b === "TEMPLATE") return 1;
        return a.localeCompare(b); // Sort alphabetically after "TEMPLATES"
      });

      // Display each client and their notes
      sortedClients.forEach(client => {
        const clientHeader = document.createElement('h2');
        clientHeader.textContent = client;
        notesListContainer.appendChild(clientHeader);

        const clientNotes = notesByClient[client];
        clientNotes.forEach((note, index) => {
          const noteItem = document.createElement('div');
          noteItem.classList.add('note-item');
          if (note.isTemplate) {
            noteItem.textContent = `${note.name}`;
          } else {
            noteItem.textContent = `INC-${note.number} (${note.template || 'No Template'})`;
          }
          noteItem.addEventListener('click', () => displayNoteDetails(note.name));
          notesListContainer.appendChild(noteItem);
        });
      });
    };

    request.onerror = function (event) {
      console.error('Error fetching templates:', event.target.errorCode);
    };
  });
}

// Displaying the note details
function displayNoteDetails(noteName) {
  initializeDB().then(() => {
    const transaction = db.transaction(['templates'], 'readonly');
    const templateStore = transaction.objectStore('templates');
    const request = templateStore.get(noteName);

    request.onsuccess = function (event) {
      const note = event.target.result;
      const noteDetailsContainer = document.getElementById('noteDetails');
      console.log(note)
      if (note.isTemplate) {
        noteDetailsContainer.innerHTML = `
          <h2>${note.name}</h2>
          ${applyHtmlFormatting(note.content)}
        `;
      } else {
        noteDetailsContainer.innerHTML = `
          <h2>INC-${note.number} - ${note.client}</h2>
          ${applyHtmlFormatting(note.content)}
        `;
      }
    };

    request.onerror = function (event) {
      console.error('Error fetching note details:', event.target.errorCode);
    };
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
  