class WebScreenIDE {
    constructor() {
        this.serialManager = new SerialManager();
        this.codeEditor = null;
        this.currentFile = '';
        this.fileList = [];
        this.isMonitoring = false;
        this.currentTheme = 'retro';
        this.isCapturingScreenshot = false;

        // File browser state
        this.currentPath = '/';
        this.selectedFile = null;
        this.fileListData = [];
        this.fileListLines = [];

        this.init();
    }

    init() {
        this.loadTheme();
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
        // Theme toggle button
        document.getElementById('themeToggle').addEventListener('click', () => {
            this.toggleTheme();
        });

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

        // Run & set as default button (/load <file> save)
        document.getElementById('runSaveBtn').addEventListener('click', () => {
            this.runScript(true);
        });

        // Eval selection button (/eval)
        document.getElementById('evalBtn').addEventListener('click', () => {
            this.evalSelection();
        });

        // Screenshot button (/screenshot)
        document.getElementById('screenshotBtn').addEventListener('click', () => {
            this.captureScreenshot();
        });

        // Screenshot overlay controls
        document.getElementById('screenshotClose').addEventListener('click', () => {
            this.hideScreenshotOverlay();
        });

        document.getElementById('screenshotDownload').addEventListener('click', () => {
            this.downloadScreenshot();
        });

        document.getElementById('screenshotOverlay').addEventListener('click', (e) => {
            // Close when clicking the dimmed backdrop (not the modal itself)
            if (e.target.id === 'screenshotOverlay') {
                this.hideScreenshotOverlay();
            }
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

        document.getElementById('deleteFile').addEventListener('click', () => {
            this.deleteSelectedFile();
        });

        // File upload
        const dropzone = document.getElementById('dropzone');
        const fileInput = document.getElementById('fileInput');
        const uploadBtn = document.getElementById('uploadBtn');

        if (uploadBtn) {
            uploadBtn.addEventListener('click', () => fileInput.click());
        }

        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    this.uploadFiles(e.target.files);
                    e.target.value = '';
                }
            });
        }

        if (dropzone) {
            dropzone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropzone.classList.add('dragover');
            });

            dropzone.addEventListener('dragleave', () => {
                dropzone.classList.remove('dragover');
            });

            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.classList.remove('dragover');
                if (e.dataTransfer.files.length > 0) {
                    this.uploadFiles(e.dataTransfer.files);
                }
            });
        }

        // Filename input
        document.getElementById('filename').addEventListener('input', (e) => {
            this.currentFile = e.target.value;
            this.updateEditorMode(e.target.value);
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
        document.getElementById('runSaveBtn').disabled = !connected;
        document.getElementById('evalBtn').disabled = !connected;
        document.getElementById('screenshotBtn').disabled = !connected || this.isCapturingScreenshot;
        document.getElementById('refreshFiles').disabled = !connected;
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
            '/help', '/stats', '/info', '/write', '/upload', '/config', '/ls',
            '/cat', '/rm', '/load', '/restart_app', '/eval', '/errors', '/gc',
            '/wget', '/ping', '/backup', '/monitor', '/brightness', '/time',
            '/settime', '/reboot', '/mkdir', '/download', '/screenshot',
            '/factory_reset'
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
        if (text.includes('\x1b')) {
            this.renderAnsiInto(line, text);
        } else {
            // Fast path: plain text renders exactly as before
            line.textContent = text;
        }
        output.appendChild(line);
        
        // Auto-scroll to bottom
        output.scrollTop = output.scrollHeight;
        
        // Limit terminal history to prevent memory issues
        while (output.children.length > 1000) {
            output.removeChild(output.firstChild);
        }
    }

    // ANSI parsing adapted from ESPConnect (MIT, The Last Outpost Workshop)
    // Converts ESC[...m SGR sequences (16 basic fg/bg colors, bold, reset) into
    // classed spans. Text is inserted via textContent/createTextNode, so it is
    // always HTML-safe. Non-SGR CSI sequences are stripped and ignored.
    renderAnsiInto(container, text) {
        const state = { fg: null, bg: null, bold: false };
        let buf = '';

        const flush = () => {
            if (!buf) return;
            const classes = [];
            if (state.bold) classes.push('ansi-bold');
            if (state.fg !== null) classes.push(`ansi-fg-${state.fg}`);
            if (state.bg !== null) classes.push(`ansi-bg-${state.bg}`);
            if (classes.length) {
                const span = document.createElement('span');
                span.className = classes.join(' ');
                span.textContent = buf;
                container.appendChild(span);
            } else {
                container.appendChild(document.createTextNode(buf));
            }
            buf = '';
        };

        let i = 0;
        while (i < text.length) {
            const ch = text[i];
            if (ch === '\x1b' && text[i + 1] === '[') {
                // Find the CSI final byte (0x40-0x7E)
                let end = -1;
                for (let j = i + 2; j < text.length; j++) {
                    const cc = text.charCodeAt(j);
                    if (cc >= 0x40 && cc <= 0x7e) { end = j; break; }
                }
                if (end === -1) break; // truncated sequence: drop the remainder
                flush();
                if (text[end] === 'm') {
                    const codes = (text.slice(i + 2, end) || '0')
                        .split(';')
                        .map(t => (t === '' ? 0 : parseInt(t, 10)));
                    for (let k = 0; k < codes.length; k++) {
                        const code = codes[k];
                        if (Number.isNaN(code)) continue;
                        if (code === 0) { state.fg = null; state.bg = null; state.bold = false; }
                        else if (code === 1) state.bold = true;
                        else if (code === 22) state.bold = false;
                        else if (code === 39) state.fg = null;
                        else if (code === 49) state.bg = null;
                        else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) state.fg = code;
                        else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) state.bg = code;
                        else if (code === 38 || code === 48) {
                            // Skip unsupported 256-color / truecolor parameters
                            const mode = codes[k + 1];
                            if (mode === 5) k += 2;
                            else if (mode === 2) k += 4;
                        }
                    }
                }
                i = end + 1;
                continue;
            }
            if (ch === '\x1b') { i++; continue; } // lone ESC: drop it
            buf += ch;
            i++;
        }
        flush();
    }

    // Screenshot capture (/screenshot): decodes the RGB565 block from the
    // device and renders it onto a canvas in a modal overlay.
    async captureScreenshot() {
        if (!this.serialManager.isConnected || this.isCapturingScreenshot) return;

        this.isCapturingScreenshot = true;
        this.updateUI();
        this.appendToTerminal('WebScreen> /screenshot', 'log-command');

        try {
            const shot = await this.serialManager.captureScreenshot(30000);
            this.renderScreenshot(shot);
            this.appendToTerminal(`Screenshot captured (${shot.width}x${shot.height})`, 'log-success');
        } catch (error) {
            this.appendToTerminal(`Screenshot failed: ${error.message}`, 'log-error');
        } finally {
            this.isCapturingScreenshot = false;
            this.updateUI();
        }
    }

    renderScreenshot({ width, height, swap, bytes }) {
        const canvas = document.getElementById('screenshotCanvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const image = ctx.createImageData(width, height);
        const pixels = Math.min(width * height, bytes.length >> 1);

        for (let i = 0; i < pixels; i++) {
            const b0 = bytes[2 * i];
            const b1 = bytes[2 * i + 1];
            // RGB565; _SWAP means high byte first
            const c = swap ? (b0 << 8) | b1 : (b1 << 8) | b0;
            const j = i * 4;
            image.data[j] = Math.round(((c >> 11) & 31) * 255 / 31);
            image.data[j + 1] = Math.round(((c >> 5) & 63) * 255 / 63);
            image.data[j + 2] = Math.round((c & 31) * 255 / 31);
            image.data[j + 3] = 255;
        }

        ctx.putImageData(image, 0, 0);

        const title = document.getElementById('screenshotTitle');
        if (title) title.textContent = `Device Screenshot (${width}x${height})`;
        document.getElementById('screenshotOverlay').style.display = 'flex';
    }

    hideScreenshotOverlay() {
        document.getElementById('screenshotOverlay').style.display = 'none';
    }

    downloadScreenshot() {
        const canvas = document.getElementById('screenshotCanvas');
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `webscreen-screenshot-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
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

    // Resolves to true once the upload has fully completed, false otherwise.
    async saveFile() {
        if (!this.serialManager.isConnected) {
            this.appendToTerminal('Device not connected', 'log-error');
            return false;
        }

        const filename = this.currentFile || document.getElementById('filename').value || 'script.js';
        const content = this.codeEditor.getValue();

        if (!content.trim()) {
            this.appendToTerminal('No content to save', 'log-warning');
            return false;
        }

        // Ensure filename has path prefix
        const fullPath = filename.startsWith('/') ? filename : '/' + filename;

        try {
            this.updateFileStatus('Saving...');
            await this.serialManager.uploadFile(fullPath, content, (sent, total) => {
                const percent = total > 0 ? Math.round((sent / total) * 100) : 0;
                this.updateFileStatus(`Saving... ${percent}%`);
            });
            this.appendToTerminal(`File saved: ${fullPath}`, 'log-success');
            this.updateFileStatus('Saved');

            // Refresh file list
            setTimeout(() => this.refreshFileList(), 1000);
            return true;
        } catch (error) {
            this.appendToTerminal(`Save failed: ${error.message}`, 'log-error');
            this.updateFileStatus('Error');
            return false;
        }
    }

    async runScript(setDefault = false) {
        const filename = this.currentFile || document.getElementById('filename').value || 'script.js';

        // Only run .js files
        if (!filename.endsWith('.js')) {
            this.appendToTerminal('Can only run JavaScript (.js) files', 'log-warning');
            return;
        }

        // Ensure filename has path prefix for loading
        const fullPath = filename.startsWith('/') ? filename : '/' + filename;

        try {
            // Save first; saveFile() resolves only after the upload has completed
            const saved = await this.saveFile();
            if (!saved) return;

            await this.serialManager.loadScript(fullPath, setDefault);
            this.appendToTerminal(
                setDefault
                    ? `Running script (saved as default): ${fullPath}`
                    : `Running script: ${fullPath}`,
                'log-success'
            );
        } catch (error) {
            this.appendToTerminal(`Run failed: ${error.message}`, 'log-error');
        }
    }

    // Send the current editor selection (or current line) to the running app via /eval
    async evalSelection() {
        if (!this.serialManager.isConnected) {
            this.appendToTerminal('Device not connected', 'log-error');
            return;
        }

        let code = this.codeEditor.getSelection();
        if (!code || !code.trim()) {
            code = this.codeEditor.getLine(this.codeEditor.getCursor().line) || '';
        }

        // /eval takes a single line; collapse newlines
        code = code.replace(/\r?\n/g, ' ').trim();

        if (!code) {
            this.appendToTerminal('Nothing to eval: selection and current line are empty', 'log-warning');
            return;
        }

        if (code.length > 255) {
            this.appendToTerminal(`Eval aborted: snippet is ${code.length} chars (/eval max is 255)`, 'log-warning');
            return;
        }

        await this.executeCommand(`/eval ${code}`);
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
            this.fileListLines = [];

            // Temporarily capture file listing output
            const originalHandler = this.serialManager.onDataReceived;
            let collecting = false;

            this.serialManager.onDataReceived = (line) => {
                // Also pass to original handler for terminal display
                if (originalHandler) originalHandler(line);

                // Check for listing start
                if (line.includes('Directory listing') || (line.includes('Type') && line.includes('Size') && line.includes('Name'))) {
                    collecting = true;
                    return;
                }

                // Skip separator lines
                if (line.match(/^-+$/) || line.includes('--------------------------------')) {
                    return;
                }

                // Check for listing end
                if (line.includes('WebScreen>') || (line.includes('Total:') && line.includes('files'))) {
                    collecting = false;
                    return;
                }

                if (collecting && line.trim()) {
                    this.fileListLines.push(line);
                }
            };

            await this.serialManager.listFiles(this.currentPath);

            // Wait a bit for response
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Restore original handler
            this.serialManager.onDataReceived = originalHandler;

            // Parse collected lines
            this.fileListData = this.serialManager.parseFileListing(this.fileListLines);
            this.renderFileList();

        } catch (error) {
            this.appendToTerminal(`File refresh failed: ${error.message}`, 'log-error');
        }
    }

    renderFileList() {
        const fileListEl = document.getElementById('fileList');
        const currentPathEl = document.getElementById('currentPath');

        if (currentPathEl) {
            currentPathEl.textContent = this.currentPath;
        }

        if (this.fileListData.length === 0) {
            fileListEl.innerHTML = '<p class="placeholder">No files found</p>';
            return;
        }

        // Sort: directories first, then files
        const sorted = [...this.fileListData].sort((a, b) => {
            if (a.type === 'dir' && b.type !== 'dir') return -1;
            if (a.type !== 'dir' && b.type === 'dir') return 1;
            return a.name.localeCompare(b.name);
        });

        fileListEl.innerHTML = sorted.map(file => {
            const icon = file.type === 'dir' ? 'fa-folder' : this.getFileIcon(file.name);
            const iconClass = file.type === 'dir' ? 'folder' : '';
            const size = file.type === 'file' ? this.formatBytes(file.size) : '';

            return `
                <div class="file-item" data-name="${file.name}" data-type="${file.type}">
                    <i class="fas ${icon} file-icon ${iconClass}"></i>
                    <span class="file-name">${file.name}</span>
                    <span class="file-size">${size}</span>
                </div>
            `;
        }).join('');

        // Add click handlers
        fileListEl.querySelectorAll('.file-item').forEach(item => {
            item.addEventListener('click', () => {
                // Toggle selection
                fileListEl.querySelectorAll('.file-item').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
                this.selectedFile = {
                    name: item.dataset.name,
                    type: item.dataset.type
                };
            });

            item.addEventListener('dblclick', () => {
                if (item.dataset.type === 'dir') {
                    // Navigate into directory
                    this.currentPath = this.currentPath + item.dataset.name + '/';
                    this.refreshFileList();
                } else {
                    // Load file into editor
                    this.loadFileIntoEditor(item.dataset.name);
                }
            });
        });
    }

    getFileIcon(filename) {
        const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
        const iconMap = {
            '.js': 'fa-file-code',
            '.json': 'fa-file-code',
            '.txt': 'fa-file-alt',
            '.md': 'fa-file-alt',
            '.html': 'fa-file-code',
            '.css': 'fa-file-code',
            '.png': 'fa-file-image',
            '.jpg': 'fa-file-image',
            '.jpeg': 'fa-file-image',
            '.gif': 'fa-file-image',
            '.svg': 'fa-file-image'
        };
        return iconMap[ext] || 'fa-file';
    }

    getEditorMode(filename) {
        const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
        const modeMap = {
            '.js': 'javascript',
            '.json': { name: 'javascript', json: true },
            '.html': 'htmlmixed',
            '.htm': 'htmlmixed',
            '.css': 'css',
            '.xml': 'xml',
            '.svg': 'xml',
            '.md': 'markdown',
            '.txt': 'text/plain'
        };
        return modeMap[ext] || 'javascript';
    }

    updateEditorMode(filename) {
        if (!this.codeEditor) return;
        const mode = this.getEditorMode(filename);
        this.codeEditor.setOption('mode', mode);
    }

    async loadFileIntoEditor(filename) {
        if (!this.serialManager.isConnected) return;

        try {
            this.appendToTerminal(`Loading ${filename}...`, 'log-info');
            let content = '';
            let collecting = false;

            const originalHandler = this.serialManager.onDataReceived;
            this.serialManager.onDataReceived = (line) => {
                if (originalHandler) originalHandler(line);

                if (line.includes(`--- ${this.currentPath}${filename}`) || line.includes('--- /')) {
                    collecting = true;
                    return;
                }

                if (line.includes('--- End of file ---') || line.includes('WebScreen>')) {
                    collecting = false;
                    return;
                }

                if (collecting) {
                    content += line + '\n';
                }
            };

            await this.serialManager.catFile(this.currentPath + filename);
            await new Promise(resolve => setTimeout(resolve, 2000));

            this.serialManager.onDataReceived = originalHandler;

            if (content.trim()) {
                this.codeEditor.setValue(content.trim());
                document.getElementById('filename').value = filename;
                this.currentFile = filename;
                this.updateEditorMode(filename);
                this.switchTab('editor');
                this.appendToTerminal(`Loaded ${filename}`, 'log-info');
            }
        } catch (error) {
            this.appendToTerminal(`Failed to load file: ${error.message}`, 'log-error');
        }
    }

    async deleteSelectedFile() {
        if (!this.serialManager.isConnected || !this.selectedFile) {
            this.appendToTerminal('No file selected', 'log-warning');
            return;
        }

        if (!confirm(`Delete ${this.selectedFile.name}?`)) return;

        try {
            const fullPath = this.currentPath + this.selectedFile.name;
            await this.serialManager.deleteFile(fullPath);
            this.appendToTerminal(`Deleted ${this.selectedFile.name}`, 'log-info');
            this.selectedFile = null;
            await this.refreshFileList();
        } catch (error) {
            this.appendToTerminal(`Delete failed: ${error.message}`, 'log-error');
        }
    }

    async uploadFiles(files) {
        if (!this.serialManager.isConnected) {
            this.appendToTerminal('Device not connected', 'log-error');
            return;
        }

        for (const file of files) {
            try {
                this.showUploadProgress(file.name, 0, file.size);

                const textExtensions = ['.js', '.json', '.txt', '.html', '.css', '.xml', '.csv', '.md'];
                const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
                const isTextFile = textExtensions.includes(ext);

                const content = await this.readFileFromBrowser(file, !isTextFile);
                const fullPath = this.currentPath + file.name;

                this.appendToTerminal(`Uploading ${file.name}...`, 'log-info');

                await this.serialManager.uploadFile(fullPath, content, (sent, total) => {
                    this.updateUploadProgress(file.name, sent, total);
                });

                this.hideUploadProgress();
                this.appendToTerminal(`Uploaded ${file.name}`, 'log-info');
            } catch (error) {
                this.hideUploadProgress();
                this.appendToTerminal(`Upload failed: ${error.message}`, 'log-error');
            }
        }

        await this.refreshFileList();
    }

    readFileFromBrowser(file, asBinary = false) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            if (asBinary) {
                reader.readAsArrayBuffer(file);
            } else {
                reader.readAsText(file);
            }
        });
    }

    showUploadProgress(filename, sent, total) {
        const overlay = document.getElementById('uploadProgressOverlay');
        const fileNameEl = document.getElementById('uploadFileName');
        const progressBar = document.getElementById('uploadProgressBar');
        const percentEl = document.getElementById('uploadProgressPercent');
        const bytesEl = document.getElementById('uploadProgressBytes');

        if (overlay) {
            overlay.style.display = 'flex';
            fileNameEl.textContent = `Uploading ${filename}...`;
            progressBar.style.width = '0%';
            percentEl.textContent = '0%';
            bytesEl.textContent = `0 B / ${this.formatBytes(total)}`;
        }
    }

    updateUploadProgress(filename, sent, total) {
        const progressBar = document.getElementById('uploadProgressBar');
        const percentEl = document.getElementById('uploadProgressPercent');
        const bytesEl = document.getElementById('uploadProgressBytes');

        if (progressBar) {
            const percent = total > 0 ? Math.round((sent / total) * 100) : 0;
            progressBar.style.width = `${percent}%`;
            percentEl.textContent = `${percent}%`;
            bytesEl.textContent = `${this.formatBytes(sent)} / ${this.formatBytes(total)}`;
        }
    }

    hideUploadProgress() {
        const overlay = document.getElementById('uploadProgressOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    updateFileStatus(status) {
        const el = document.getElementById('fileStatus');
        if (el) el.textContent = status;
    }

    // Theme Management
    loadTheme() {
        // Check for URL parameter first
        const urlParams = new URLSearchParams(window.location.search);
        const urlTheme = urlParams.get('mode');
        
        let theme;
        if (urlTheme && (urlTheme === 'retro' || urlTheme === 'focus')) {
            theme = urlTheme;
            // Save URL theme to localStorage
            localStorage.setItem('webscreen-ide-theme', theme);
        } else {
            // Fall back to saved theme or default
            theme = localStorage.getItem('webscreen-ide-theme') || 'retro';
        }
        
        this.setTheme(theme);
    }

    setTheme(theme) {
        this.currentTheme = theme;
        document.body.setAttribute('data-theme', theme);
        
        // Update theme label
        const themeLabel = document.getElementById('themeLabel');
        themeLabel.textContent = theme === 'retro' ? 'Focus' : 'Retro';
        
        // Update CodeMirror theme
        if (this.codeEditor) {
            const cmTheme = theme === 'focus' ? 'default' : 'dracula';
            this.codeEditor.setOption('theme', cmTheme);
        }
        
        // Save to localStorage
        localStorage.setItem('webscreen-ide-theme', theme);
    }

    toggleTheme() {
        const newTheme = this.currentTheme === 'retro' ? 'focus' : 'retro';
        this.setTheme(newTheme);
    }

}

// Initialize the IDE when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.webScreenIDE = new WebScreenIDE();
});