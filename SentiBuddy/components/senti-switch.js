class SentiSwitch extends HTMLElement {
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
             
        .tooltiptext {
          visibility: hidden;
          width: 120px;
          background-color: #555;
          color: #fff;
          text-align: center;
          border-radius: 6px;
          padding: 5px 0;
          position: absolute;
          z-index: 1;
          bottom: 125%;
          left: 50%;
          margin-left: -60px;
          opacity: 0;
          transition: opacity 0.3s;
        }

        .tooltiptext::after {
          content: "";
          position: absolute;
          top: 100%;
          left: 50%;
          margin-left: -5px;
          border-width: 5px;
          border-style: solid;
          border-color: #555 transparent transparent transparent;
        }

        .icon {
          font-size: 24px;
          margin-right: ${text ? '8px' : '0'};
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .switch {
          position: relative;
          display: inline-block;
          width: 60px;
          height: 34px;
        }

        .switch input { 
          opacity: 0;
          width: 0;
          height: 0;
        }

        .slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: #ccc;
          -webkit-transition: .4s;
          transition: .4s;
        }

        .slider:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
          visibility: visible;
          opacity: 1;
          background-color: ${this.adjustColor(backgroundColor, 20)};
        }
        .slider:hover .tooltiptext {
          visibility: visible;
          opacity: 1;
        }

        .slider:before {
          position: absolute;
          content: "";
          height: 26px;
          width: 26px;
          left: 4px;
          bottom: 4px;
          background-color: white;
          -webkit-transition: .4s;
          transition: .4s;
        }

        input:checked + .slider {
          background-color: #2196F3;
        }

        input:focus + .slider {
          box-shadow: 0 0 1px #2196F3;
        }

        input:checked + .slider:before {
          -webkit-transform: translateX(26px);
          -ms-transform: translateX(26px);
          transform: translateX(26px);
        }

        /* Rounded sliders */
        .slider.round {
          border-radius: 34px;
        }

        .slider.round:before {
          border-radius: 50%;
        }
      </style>
      <label class="switch">
        ${text}
        <input type="checkbox" id="${id}">
        <span class="slider round"></span>
        <span class="tooltiptext">Tooltip text</span>
      </label>
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

customElements.define('senti-switch', SentiSwitch);