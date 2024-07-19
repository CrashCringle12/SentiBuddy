class SentiButton extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  static get observedAttributes() {
    return ['color', 'text-color', 'text', 'active', 'icon'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue) {
      this.render();
    }
  }

  render() {
    const backgroundColor = this.getAttribute('color') || '#007bff';
    const textColor = this.getAttribute('text-color') || 'white';
    const text = this.getAttribute('text') || '';
    const icon = this.getAttribute('icon') || '';
    const id = this.getAttribute('id') || '';
    const isActive = this.hasAttribute('active');

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-block;
        }
        button {
          background-color: ${backgroundColor};
          color: ${textColor};
          border: none;
          border-radius: ${text ? '20px' : '50%'};
          padding: ${text ? '10px 20px' : '0'};
          font-size: 16px;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
          outline: none;
          position: relative;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          width: ${text ? 'auto' : '40px'};
          height: ${text ? 'auto' : '40px'};
          min-width: ${text ? '100px' : '40px'};
          min-height: 40px;
        }
        button:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
          background-color: ${this.adjustColor(backgroundColor, 20)};
        }
        button:active, button[active] {
          transform: translateY(1px);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
          background-color: ${this.adjustColor(backgroundColor, -20)};
        }
        .icon {
          font-size: 24px;
          margin-right: ${text ? '8px' : '0'};
          display: flex;
          align-items: center;
          justify-content: center;
        }
      </style>
      <button id="${id}" ${isActive ? 'active' : ''}>
        ${icon ? `<span class="icon">${this.decodeIcon(icon)}</span>` : ''}
        ${text}
      </button>
    `;
  }

  decodeIcon(icon) {
    return String.fromCodePoint(parseInt(icon.replace('\\', '0x')));
  }

  setText(newText) {
    this.setAttribute('text', newText);
  }

  getText() {
    return this.getAttribute('text') || '';
  }

  setColor(newColor) {
    this.setAttribute('color', newColor);
  }

  getColor() {
    return this.getAttribute('color') || '#007bff';
  }

  setTextColor(newColor) {
    this.setAttribute('text-color', newColor);
  }

  getTextColor() {
    return this.getAttribute('text-color') || 'white';
  }

  setActive(isActive) {
    if (isActive) {
      this.setAttribute('active', '');
    } else {
      this.removeAttribute('active');
    }
  }

  isActive() {
    return this.hasAttribute('active');
  }

  setIcon(icon) {
    this.setAttribute('icon', icon);
  }

  getIcon() {
    return this.getAttribute('icon') || '';
  }

  adjustColor(color, amount) {
    return '#' + color.replace(/^#/, '').replace(/../g, color => ('0' + Math.min(255, Math.max(0, parseInt(color, 16) + amount)).toString(16)).substr(-2));
  }
}

customElements.define('senti-button', SentiButton);