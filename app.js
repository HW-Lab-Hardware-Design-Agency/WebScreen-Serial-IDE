class WebScreenIDE {
    constructor() {
        this.serialManager = new SerialManager();
        this.codeEditor = null;
        this.currentFile = '';
        this.fileList = [];
        this.isMonitoring = false;
        
        this.init();
    }

    init() {
        this.initEditor();
        this.setupEventListeners();
        this.setupSerialEvents();
        this.updateUI();
    }

    initEditor() {
        // Initialize CodeMirror
        this.codeEditor = CodeMirror(document.getElementById('codeEditor'), {
            mode: 'javascript',
            theme: 'dracula',
            lineNumbers: true,
            lineWrapping: true,
            autoCloseBrackets: true,
            matchBrackets: true,
            indentUnit: 2,
            indentWithTabs: false,
            extraKeys: {
                'Ctrl-Space': 'autocomplete',
                'Ctrl-/': 'toggleComment',
                'Ctrl-S': () => this.saveFile(),
                'F5': () => this.runScript(),
                'Ctrl-F': 'findPersistent'
            },
            foldGutter: true,
            gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
            scrollbarStyle: 'simple',
            value: `// Welcome to WebScreen IDE!
// Write your JavaScript code here

// Create a simple label
create_label_with_text('Hello WebScreen!');

// You can use all WebScreen API functions:
// - UI: create_label(), draw_rect(), create_image()
// - Network: http_get(), wifi_connect()
// - Storage: sd_write_file(), sd_read_file()
// - Hardware: delay(), print()

// Press F5 or click Run to upload and execute
`
        });

        // Update cursor position
        this.codeEditor.on('cursorActivity', (cm) => {
            const cursor = cm.getCursor();
            document.getElementById('cursorPosition').textContent = 
                `Ln ${cursor.line + 1}, Col ${cursor.ch + 1}`;
        });

        // Mark as modified
        this.codeEditor.on('change', () => {
            this.updateFileStatus('Modified');
        });
    }

    setupEventListeners() {
        // Connection button
        document.getElementById('connectBtn').addEventListener('click', () => {
            this.toggleConnection();
        });

        // Save button
        document.getElementById('saveBtn').addEventListener('click', () => {
            this.saveFile();
        });

        // Run button
        document.getElementById('runBtn').addEventListener('click', () => {
            this.runScript();
        });

        // Clear terminal
        document.getElementById('clearBtn').addEventListener('click', () => {
            this.clearTerminal();
        });

        // Download log
        document.getElementById('downloadLog').addEventListener('click', () => {
            this.downloadLog();
        });

        // Terminal input
        const terminalInput = document.getElementById('terminalInput');
        terminalInput.addEventListener('keydown', (e) => {
            this.handleTerminalInput(e);
        });

        // Send button
        document.getElementById('sendBtn').addEventListener('click', () => {
            this.sendTerminalCommand();
        });

        // Quick commands
        document.querySelectorAll('.cmd-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const command = btn.dataset.cmd;
                this.executeCommand(command);
            });
        });

        // Tabs
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.switchTab(tab.dataset.tab);
            });
        });

        // File manager buttons
        document.getElementById('refreshFiles').addEventListener('click', () => {
            this.refreshFileList();
        });

        document.getElementById('downloadFile').addEventListener('click', () => {
            this.downloadSelectedFile();
        });

        document.getElementById('deleteFile').addEventListener('click', () => {
            this.deleteSelectedFile();
        });

        // Filename input
        document.getElementById('filename').addEventListener('input', (e) => {
            this.currentFile = e.target.value;
        });
    }

    setupSerialEvents() {
        this.serialManager.onDataReceived = (data) => {
            this.appendToTerminal(data, 'log-response');
        };

        this.serialManager.onConnectionChange = (connected) => {
            this.updateConnectionStatus(connected);
        };
    }

    async toggleConnection() {
        if (this.serialManager.isConnected) {
            await this.disconnect();
        } else {
            await this.connect();
        }
    }

    async connect() {
        const connectBtn = document.getElementById('connectBtn');
        const originalText = connectBtn.textContent;
        
        try {
            connectBtn.textContent = 'Connecting...';
            connectBtn.disabled = true;

            await this.serialManager.connect();
            this.appendToTerminal('Connected to WebScreen!', 'log-success');
            
            // Auto-refresh file list
            setTimeout(() => {
                this.refreshFileList();
            }, 1000);
            
        } catch (error) {
            this.appendToTerminal(`Connection failed: ${error.message}`, 'log-error');
        } finally {
            connectBtn.textContent = originalText;
            connectBtn.disabled = false;
        }
    }

    async disconnect() {
        try {
            await this.serialManager.disconnect();
            this.appendToTerminal('Disconnected from device', 'log-info');
        } catch (error) {
            this.appendToTerminal(`Disconnect error: ${error.message}`, 'log-error');
        }
    }

    updateConnectionStatus(connected) {
        const statusBadge = document.getElementById('connectionStatus');
        const connectBtn = document.getElementById('connectBtn');
        const deviceInfo = document.getElementById('deviceInfo');

        if (connected) {
            statusBadge.textContent = 'Connected';
            statusBadge.className = 'status-badge connected';
            connectBtn.textContent = 'Disconnect';
            deviceInfo.textContent = 'WebScreen ESP32-S3';
        } else {
            statusBadge.textContent = 'Disconnected';
            statusBadge.className = 'status-badge disconnected';
            connectBtn.textContent = 'Connect Device';
            deviceInfo.textContent = 'No device';
        }

        this.updateUI();
    }

    updateUI() {
        const connected = this.serialManager.isConnected;
        
        // Enable/disable buttons based on connection
        document.getElementById('saveBtn').disabled = !connected;
        document.getElementById('runBtn').disabled = !connected;
        document.getElementById('refreshFiles').disabled = !connected;
        document.getElementById('downloadFile').disabled = !connected;
        document.getElementById('deleteFile').disabled = !connected;
        
        // Update terminal input
        const terminalInput = document.getElementById('terminalInput');
        terminalInput.disabled = !connected;
        terminalInput.placeholder = connected ? 
            'Type command or / for help' : 
            'Connect device to use terminal';

        // Update quick command buttons
        document.querySelectorAll('.cmd-btn').forEach(btn => {
            btn.disabled = !connected;
        });
    }

    handleTerminalInput(e) {
        const input = e.target;

        if (e.key === 'Enter') {
            this.sendTerminalCommand();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prevCmd = this.serialManager.getPreviousCommand();
            if (prevCmd) {
                input.value = prevCmd;
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const nextCmd = this.serialManager.getNextCommand();
            input.value = nextCmd;
        } else if (e.key === 'Tab') {
            e.preventDefault();
            // Simple command completion
            this.handleCommandCompletion(input);
        }
    }

    handleCommandCompletion(input) {
        const value = input.value.toLowerCase();
        const commands = [
            '/help', '/stats', '/info', '/write', '/config', '/ls', 
            '/cat', '/rm', '/load', '/wget', '/ping', '/backup', 
            '/monitor', '/reboot'
        ];
        
        const matches = commands.filter(cmd => cmd.startsWith(value));
        if (matches.length === 1) {
            input.value = matches[0] + ' ';
        } else if (matches.length > 1) {
            this.appendToTerminal(`Available: ${matches.join(', ')}`, 'log-info');
        }
    }

    async sendTerminalCommand() {
        const input = document.getElementById('terminalInput');
        const command = input.value.trim();
        
        if (!command) return;

        this.appendToTerminal(`WebScreen> ${command}`, 'log-command');
        input.value = '';

        try {
            await this.serialManager.sendCommand(command);
        } catch (error) {
            this.appendToTerminal(`Error: ${error.message}`, 'log-error');
        }
    }

    async executeCommand(command) {
        this.appendToTerminal(`WebScreen> ${command}`, 'log-command');
        
        try {
            await this.serialManager.sendCommand(command);
        } catch (error) {
            this.appendToTerminal(`Error: ${error.message}`, 'log-error');
        }
    }

    appendToTerminal(text, className = 'log-response') {
        const output = document.getElementById('terminalOutput');
        const line = document.createElement('div');
        line.className = className;
        line.textContent = text;
        output.appendChild(line);
        
        // Auto-scroll to bottom
        output.scrollTop = output.scrollHeight;
        
        // Limit terminal history to prevent memory issues
        while (output.children.length > 1000) {
            output.removeChild(output.firstChild);
        }
    }

    clearTerminal() {
        document.getElementById('terminalOutput').innerHTML = '';
        this.appendToTerminal('Terminal cleared', 'log-info');
    }

    downloadLog() {
        const output = document.getElementById('terminalOutput');
        const logs = Array.from(output.children).map(line => line.textContent).join('\n');
        
        const blob = new Blob([logs], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `webscreen-log-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async saveFile() {
        if (!this.serialManager.isConnected) {
            this.appendToTerminal('Device not connected', 'log-error');
            return;
        }

        const filename = this.currentFile || document.getElementById('filename').value || 'script.js';
        const content = this.codeEditor.getValue();

        if (!content.trim()) {
            this.appendToTerminal('No content to save', 'log-warning');
            return;
        }

        try {
            this.updateFileStatus('Saving...');
            await this.serialManager.sendFile(filename, content);
            this.appendToTerminal(`File saved: ${filename}`, 'log-success');
            this.updateFileStatus('Saved');
            
            // Refresh file list
            setTimeout(() => this.refreshFileList(), 1000);
        } catch (error) {
            this.appendToTerminal(`Save failed: ${error.message}`, 'log-error');
            this.updateFileStatus('Error');
        }
    }

    async runScript() {
        const filename = this.currentFile || document.getElementById('filename').value || 'script.js';
        
        try {
            // Save first, then run
            await this.saveFile();
            
            // Wait a bit for save to complete
            setTimeout(async () => {
                await this.serialManager.loadScript(filename);
                this.appendToTerminal(`Running script: ${filename}`, 'log-success');
            }, 1500);
        } catch (error) {
            this.appendToTerminal(`Run failed: ${error.message}`, 'log-error');
        }
    }

    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });

        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('hidden', content.id !== `${tabName}-tab`);
        });

        // Refresh editor if switching back to editor tab
        if (tabName === 'editor') {
            setTimeout(() => this.codeEditor.refresh(), 100);
        }
    }

    async refreshFileList() {
        if (!this.serialManager.isConnected) return;

        try {
            this.appendToTerminal('Refreshing file list...', 'log-info');
            await this.serialManager.listFiles();
        } catch (error) {
            this.appendToTerminal(`File refresh failed: ${error.message}`, 'log-error');
        }
    }

    downloadSelectedFile() {
        // This would need to be implemented with file content retrieval
        this.appendToTerminal('File download not yet implemented', 'log-warning');
    }

    deleteSelectedFile() {
        // This would need file selection implementation
        this.appendToTerminal('File delete not yet implemented', 'log-warning');
    }

    updateFileStatus(status) {
        document.getElementById('fileStatus').textContent = status;
    }
}

// Initialize the IDE when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.webScreenIDE = new WebScreenIDE();
});