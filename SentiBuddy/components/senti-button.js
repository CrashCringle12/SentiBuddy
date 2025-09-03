class SentiButton extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  static get observedAttributes() {
    return ['color', 'text-color', 'text', 'active', 'icon', 'tooltip'];
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
    const tooltip = this.getAttribute('tooltip') || '';
    const isActive = this.hasAttribute('active');

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-block;
          position: relative; /* Ensures the tooltip is positioned relative to the button */

        }
        button {
            width: 100%;
            padding: 14px;
            background: linear-gradient(135deg, ${backgroundColor}, ${this.adjustColor(backgroundColor, 50)});
            color: ${textColor};
            border: none;
            border-radius: ${text ? '20px' : '50%'};
            padding: ${text ? '10px 20px' : '0'};    

            cursor: pointer;
            font-weight: 600;
            font-size: 14px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 4px 12px rgba(136, 216, 192, 0.3);
            margin-top: 8px;
        }
  
        button:hover {
          transform: translateY(-1px);
           box-shadow: 0 8px 20px rgba(136, 216, 192, 0.4);
          background: linear-gradient(135deg, ${this.adjustColor(backgroundColor, 10)}, ${this.adjustColor(backgroundColor, 20)});
        }
        button:active, button[active] {
          transform: translateY(1px);
           box-shadow: 0 8px 20px rgba(136, 216, 192, 0.4);
          background: linear-gradient(135deg, ${this.adjustColor(backgroundColor, -10)}, ${this.adjustColor(backgroundColor, -20)});
        }
     
        .tooltiptext {
          visibility: hidden;
          width: 150px;
          background-color: #333;
          color: #fff;
          text-align: center;
          border-radius: 6px;
          padding: 10px;
          position: absolute;
          z-index: 1;
          bottom: 125%; /* Adjust position relative to the button */
          left: 50%;
          transform: translateX(-50%);
          opacity: 0;
          transition: opacity 0.3s;
        }

        .tooltiptext::after {
          content: "";
          position: absolute;
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          border-width: 5px;
          border-style: solid;
          border-color: #333 transparent transparent transparent;
        }

        button:hover .tooltiptext {
          visibility: visible;
          opacity: 1;
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
      <span class="tooltiptext">${tooltip}</span>
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