# WebScreen Serial IDE

A web-based integrated development environment for WebScreen devices, providing serial communication, code editing, and command execution capabilities.

## Features

### 🚀 **Core Features**
- **Serial Communication**: Direct Web Serial API connection to WebScreen devices
- **Code Editor**: Full-featured JavaScript editor with syntax highlighting and line numbers
- **Command Interface**: Execute all WebScreen serial commands interactively
- **File Management**: Upload, list, and manage files on the device
- **Real-time Terminal**: Live serial console with command history

### 💻 **Code Editor**
- **Syntax Highlighting**: JavaScript syntax highlighting with Dracula theme
- **Line Numbers**: Easy navigation with line numbering
- **Auto-completion**: IntelliSense-style code completion
- **Bracket Matching**: Automatic bracket pairing and highlighting
- **Code Folding**: Collapse code blocks for better navigation
- **Search & Replace**: Built-in search functionality (Ctrl+F)
- **Keyboard Shortcuts**: 
  - `Ctrl+S`: Save file to device
  - `F5`: Run script on device
  - `Ctrl+/`: Toggle comments
  - `Ctrl+Space`: Trigger autocomplete

### 🔧 **Serial Commands**
All WebScreen serial commands are supported:
- **Core**: `/help`, `/stats`, `/info`, `/reboot`
- **File Operations**: `/write`, `/ls`, `/cat`, `/rm`
- **Network**: `/wget`, `/ping`
- **Configuration**: `/config get/set`, `/backup`
- **Monitoring**: `/monitor cpu/mem/net`
- **Script Management**: `/load`, `/run`

### 🎨 **User Interface**
- **Dark Theme**: Beautiful dark theme optimized for coding
- **Responsive Layout**: Works on desktop and tablet devices
- **Split View**: Side-by-side editor and terminal
- **Quick Commands**: One-click access to common commands
- **Status Bar**: Real-time connection and cursor information

## Getting Started

### Prerequisites
- **Browser**: Chrome, Edge, or Opera (Web Serial API support required)
- **WebScreen Device**: Connected via USB with serial commands firmware

### Usage

1. **Open the IDE**
   ```
   Open index.html in a supported browser
   ```

2. **Connect Device**
   - Click "Connect Device" button
   - Select your WebScreen device from the serial port list
   - Wait for successful connection

3. **Write Code**
   - Use the JavaScript editor to write your WebScreen applications
   - Take advantage of syntax highlighting and autocomplete
   - Save your work with Ctrl+S or the Save button

4. **Execute Commands**
   - Use the terminal to execute serial commands
   - Try quick commands like `/stats` or `/help`
   - Upload and run scripts with F5 or the Run button

### Example JavaScript Code

```javascript
// Simple WebScreen application
create_label_with_text('Hello WebScreen!');
set_background_color('#2980b9');

// Network example
wifi_connect('MyNetwork', 'password');
let weather = http_get('https://api.weather.com/current');
let temp = parse_json_value(weather, 'temperature');
create_label_with_text('Temperature: ' + temp + '°C');

// Storage example
sd_write_file('/config.txt', 'My configuration');
let config = sd_read_file('/config.txt');
print('Config loaded: ' + config);
```

## Development Workflow

### 1. **Rapid Prototyping**
```
1. Write JavaScript code in the editor
2. Press F5 to upload and run immediately
3. See results on WebScreen display
4. Iterate quickly without SD card swapping
```

### 2. **File Management**
```
1. Use /ls to see existing files
2. Save scripts with custom filenames
3. Load different applications with /load
4. Backup configurations with /backup
```

### 3. **System Monitoring**
```
1. Use /stats to monitor memory usage
2. Use /monitor to see real-time system stats
3. Use /ping to test network connectivity
4. Debug issues with serial console output
```

### 4. **Configuration Management**
```
1. Use /config get to read settings
2. Use /config set to update settings
3. Use /backup to save configurations
4. Use /reboot to apply changes
```

## Technical Details

### Architecture
- **Frontend**: Vanilla JavaScript with CodeMirror editor
- **Serial Communication**: Web Serial API for device connection
- **Styling**: Modern CSS with dark theme and responsive design
- **No Backend**: Pure client-side application

### Browser Compatibility
- ✅ **Chrome 89+**: Full support
- ✅ **Edge 89+**: Full support  
- ✅ **Opera 75+**: Full support
- ❌ **Firefox**: No Web Serial API support
- ❌ **Safari**: No Web Serial API support

### File Structure
```
WebScreen-Serial-IDE/
├── index.html          # Main HTML structure
├── style.css           # CSS styling and theme
├── serial.js           # Serial communication manager
├── app.js              # Main application logic
└── README.md           # Documentation
```

## API Reference

### SerialManager Class
The core serial communication functionality:

```javascript
// Connection management
await serial.connect()
await serial.disconnect()

// Command execution
await serial.sendCommand('/help')
await serial.sendFile('script.js', content)

// WebScreen specific methods
await serial.getStats()
await serial.listFiles()
await serial.loadScript('app.js')
await serial.backup('save', 'production')
```

### WebScreenIDE Class
Main application controller:

```javascript
// Editor operations
ide.saveFile()
ide.runScript()
ide.clearTerminal()

// UI management
ide.switchTab('files')
ide.updateConnectionStatus(connected)
ide.appendToTerminal(message, className)
```

## Customization

### Themes
The IDE uses the Dracula theme by default. To change themes:

```javascript
// In app.js, modify the CodeMirror initialization:
this.codeEditor = CodeMirror(document.getElementById('codeEditor'), {
    theme: 'monokai', // Change theme here
    // ... other options
});
```

Available themes: `dracula`, `monokai`, `material`, `solarized`, etc.

### Commands
Add custom quick commands by modifying the HTML:

```html
<button class="cmd-btn" data-cmd="/custom command">Custom</button>
```

### Keyboard Shortcuts
Modify keyboard shortcuts in the editor configuration:

```javascript
extraKeys: {
    'Ctrl-R': () => this.runScript(),      // Custom shortcut
    'Ctrl-Shift-S': () => this.saveAs(),   // Save As functionality
    // ... other shortcuts
}
```

## Troubleshooting

### Connection Issues
- **Device not found**: Ensure WebScreen is connected via USB and drivers are installed
- **Permission denied**: Try disconnecting and reconnecting the device
- **Port busy**: Close other serial applications (Arduino IDE, etc.)

### Editor Issues
- **Syntax highlighting not working**: Check if JavaScript mode is loaded
- **Autocomplete not working**: Ensure show-hint addon is loaded
- **Slow performance**: Clear terminal history or reduce editor content

### Serial Communication
- **Commands not working**: Verify device is running serial commands firmware
- **Garbled output**: Check baud rate (should be 115200)
- **Timeout errors**: Ensure stable USB connection

## Contributing

### Development Setup
1. Clone the repository
2. Open `index.html` in a supported browser
3. Connect a WebScreen device for testing
4. Make modifications and test locally

### Adding Features
- **New Commands**: Add to SerialManager class methods
- **UI Components**: Modify HTML structure and CSS styling
- **Editor Features**: Extend CodeMirror configuration
- **File Operations**: Enhance file management capabilities

## License

This project follows the same license as the WebScreen project. Please refer to the main WebScreen repository for licensing details.

## Support

For issues and questions:
- **WebScreen Hardware**: [CrowdSupply](https://www.crowdsupply.com/hw-media-lab/webscreen)
- **Software Issues**: [GitHub Issues](https://github.com/HW-Lab-Hardware-Design-Agency/WebScreen-Software/issues)
- **Community**: [WebScreen Website](https://webscreen.cc)

---

Transform your WebScreen development workflow with this powerful web-based IDE!