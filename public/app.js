class WebScreenIDE {
    constructor() {
        this.serialManager = new SerialManager();
        this.codeEditor = null;
        this.currentFile = '';
        this.fileList = [];
        this.isMonitoring = false;
        this.currentTheme = 'retro';

        // File browser state
        this.currentPath = '/';
        this.selectedFile = null;
        this.fileListData = [];
        this.fileListLines = [];

        // Embedder configuration (from official CLI package)
        this.embedderConfig = {
            authUrl: 'https://app.embedder.dev/',
            authDomain: 'embedder-dev.firebaseapp.com',
            tokenApiUrl: 'https://securetoken.googleapis.com/v1/token',
            apiKey: 'AIzaSyDuNXvHd-GvTrmXG6_2TnrfqRWo-ApPd3s',
            projectId: 'embedder-dev',
            storageBucket: 'embedder-dev.firebasestorage.app',
            messagingSenderId: '547074918538',
            appId: '1:547074918538:web:b5495d2347046fd29e8573',
            measurementId: 'G-4KT5CW28KM',
            // Backend endpoints
            backendUrl: 'https://backend-service-prod.embedder.dev',
            proxyAnthropicUrl: 'https://backend-service-prod.embedder.dev/api/v1/proxy/anthropic/',
            proxyOpenAIUrl: 'https://backend-service-prod.embedder.dev/api/v1/proxy/openai/',
            proxyGoogleUrl: 'https://backend-service-prod.embedder.dev/api/v1/proxy/google/',
            // PHP backend for authentication (no CORS issues)
            phpAuthUrl: 'auth.php'
        };

        this.embedderConversation = [];
        this.embedderSettings = {
            model: 'claude-sonnet-4-20250514',
            temperature: 0.7
        };

        // Device code authentication state
        this.deviceCodePolling = null;
        this.deviceCodeData = null;

        // Cached credentials from PHP session
        this.credentials = null;

        this.init();
    }

    init() {
        this.loadTheme();
        this.initEditor();
        this.setupEventListeners();
        this.setupSerialEvents();
        this.initEmbedder();
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
        });

        document.getElementById('loginDeviceCodeBtn').addEventListener('click', () => {
            this.startDeviceCodeAuth();
        });

        document.getElementById('logoutBtn').addEventListener('click', () => {
            this.embedderLogout();
        });

        document.getElementById('closeAuthModal').addEventListener('click', () => {
            this.closeAuthModal();
        });

        document.getElementById('authModal').addEventListener('click', (e) => {
            if (e.target.id === 'authModal') {
                this.closeAuthModal();
            }
        });

        document.getElementById('sendEmbedderMessage').addEventListener('click', () => {
            this.sendEmbedderMessage();
        });

        document.getElementById('embedderInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendEmbedderMessage();
            }
        });

        document.getElementById('sendCodeToEmbedder').addEventListener('click', () => {
            this.includeCodeInEmbedder();
        });

        document.getElementById('clearEmbedderChat').addEventListener('click', () => {
            this.clearEmbedderConversation();
        });

        document.getElementById('embedderModel').addEventListener('change', (e) => {
            this.embedderSettings.model = e.target.value;
        });

        // Embedder quick actions
        document.querySelectorAll('.embedder-quick-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const prompt = btn.dataset.prompt;
                this.embedderQuickAction(prompt);
            });
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

    // Embedder Methods
    async initEmbedder() {
        console.log('[Embedder] Initializing...');

        // Check for authentication callback
        const urlParams = new URLSearchParams(window.location.search);
        const authenticated = urlParams.get('authenticated');

        if (authenticated === 'true') {
            console.log('[Embedder] Authentication callback detected');
            this.switchTab('embedder');  // Switch to Embedder tab
            this.updateEmbedderStatus('Authentication successful!', 'success');

            // Clean URL
            const cleanUrl = window.location.pathname + window.location.hash;
            window.history.replaceState({}, document.title, cleanUrl);
        }

        // Load credentials from PHP session
        await this.loadEmbedderCredentials();

        // Update UI
        await this.updateEmbedderUI();

        // No auto-refresh to prevent excessive requests to auth.php
        // UI will update when authentication state changes (login, logout, refresh)
    }


    async handleEmbedderAuthSuccess(customToken) {
        try {
            // Switch to Embedder tab to show progress
            this.switchTab('embedder');
            this.updateEmbedderStatus('Exchanging token...', 'info');

            console.log('[Embedder] Received custom token from Embedder');
            console.log('[Embedder] Exchanging custom token for Firebase ID token...');

            // Exchange custom token for Firebase ID token
            // This is what the CLI does: wD(SD, r) = signInWithCustomToken(firebaseAuth, customToken)
            const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${this.embedderConfig.apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    token: customToken,
                    returnSecureToken: true
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error?.message || `Authentication failed: ${response.status}`);
            }

            const data = await response.json();
            console.log('[Embedder] Successfully obtained Firebase ID token');

            // Extract expiration from JWT payload (like CLI does)
            let expiresAt = Date.now() + 3600000; // Default 1 hour
            try {
                const payload = this.parseJWT(data.idToken);
                if (payload && typeof payload.exp === 'number') {
                    expiresAt = payload.exp * 1000; // Convert to milliseconds
                    console.log('[Embedder] Token expires at:', new Date(expiresAt).toISOString());
                }
            } catch (error) {
                console.warn('[Embedder] Could not parse token expiry, using default');
            }

            const credentials = {
                accessToken: data.idToken,
                idToken: data.idToken,
                refreshToken: data.refreshToken,
                expiresAt: expiresAt,
                user: {
                    uid: data.localId,
                    email: data.email || null,
                    displayName: data.displayName || null
                },
                timestamp: Date.now()
            };

            console.log('[Embedder] Saving credentials...');
            this.saveEmbedderCredentials(credentials);
            this.updateEmbedderStatus('Authentication successful! You can now chat with Embedder.', 'success');
            await this.updateEmbedderUI();
            console.log('[Embedder] Authentication complete!');

        } catch (error) {
            console.error('[Embedder] Authentication error:', error);
            this.switchTab('embedder');
            this.updateEmbedderStatus(`Authentication failed: ${error.message}`, 'error');
        }
    }

    parseJWT(token) {
        try {
            const base64Url = token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));

            return JSON.parse(jsonPayload);
        } catch (error) {
            throw new Error('Invalid JWT token');
        }
    }

    // Token validation (from CLI implementation)
    validateToken(token) {
        try {
            if (!token || token.split('.').length !== 3) {
                return false;
            }

            // Parse JWT payload
            const payload = this.parseJWT(token);

            // Check expiry
            if (typeof payload.exp === 'number' && (payload.exp * 1000) < Date.now()) {
                console.log('[Embedder] Token expired');
                return false;
            }

            // Check issuer
            if (typeof payload.iss === 'string' && !payload.iss.includes('securetoken.google.com')) {
                console.warn('[Embedder] Invalid token issuer:', payload.iss);
                return false;
            }

            return true;
        } catch (error) {
            console.error('[Embedder] Token validation error:', error);
            return false;
        }
    }

    async startDeviceCodeAuth() {
        console.log('[Embedder] Starting device code flow...');
        this.updateEmbedderStatus('Starting device code authentication...', 'info');

        try {
            const response = await fetch(`${this.embedderConfig.phpAuthUrl}?action=start_device_code`);

            if (!response.ok) {
                throw new Error(`Failed to start device auth: ${response.status}`);
            }

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Failed to start device code flow');
            }

            this.deviceCodeData = result.data;
            const { userCode, deviceCode, expiresIn, verificationUri } = result.data;

            console.log('[Embedder] Device code received:', { userCode, verificationUri });

            this.showDeviceCodeUI(userCode, verificationUri);

            const expiresAt = Date.now() + (expiresIn * 1000);
            this.startDeviceCodePolling(userCode, expiresAt);

        } catch (error) {
            console.error('[Embedder] Device code auth error:', error);
            this.updateEmbedderStatus(`Device code auth failed: ${error.message}`, 'error');
        }
    }

    showDeviceCodeUI(userCode, verificationUri) {
        document.getElementById('modalDeviceCodeValue').textContent = userCode;
        document.getElementById('modalVerificationUrl').textContent = verificationUri;
        document.getElementById('modalVerificationUrl').href = verificationUri;

        document.getElementById('authModal').classList.add('show');

        window.open(verificationUri, '_blank');

        this.updateEmbedderStatus('Waiting for authentication...', 'info');
    }

    closeAuthModal() {
        document.getElementById('authModal').classList.remove('show');
        this.cancelDeviceCodeAuth();
    }

    startDeviceCodePolling(userCode, expiresAt) {
        const POLL_INTERVAL = 3000;

        const poll = async () => {
            try {
                if (Date.now() > expiresAt) {
                    console.log('[Embedder] Device code expired, restarting...');
                    this.cancelDeviceCodeAuth();
                    this.updateEmbedderStatus('Device code expired. Please try again.', 'error');
                    return;
                }

                const response = await fetch(`${this.embedderConfig.phpAuthUrl}?action=poll_device_code`);

                if (!response.ok) {
                    throw new Error(`Polling failed: ${response.status}`);
                }

                const result = await response.json();

                if (!result.success) {
                    throw new Error(result.error || 'Polling failed');
                }

                const data = result.data;
                console.log('[Embedder] Poll response:', JSON.stringify(data));

                if (data.status === 'authorized' && (data.accessToken || data.credentialsStored)) {
                    console.log('[Embedder] Device authorized! Token exchanged by PHP backend.');
                    this.cancelDeviceCodeAuth();

                    this.updateEmbedderStatus('Device authorized! Loading credentials...', 'success');

                    await new Promise(resolve => setTimeout(resolve, 500));

                    const credentials = await this.loadEmbedderCredentials();

                    if (credentials && credentials.accessToken) {
                        console.log('[Embedder] Credentials loaded successfully!');
                        this.updateEmbedderStatus('Authentication complete!', 'success');
                        await this.updateEmbedderUI();
                    } else {
                        console.error('[Embedder] Failed to load credentials after authorization');
                        this.updateEmbedderStatus('Authorization succeeded but failed to load credentials. Please refresh the page.', 'error');
                    }

                } else if (data.status === 'authorization_pending') {
                    console.log('[Embedder] Still waiting for user to authorize...');
                    this.deviceCodePolling = setTimeout(poll, POLL_INTERVAL);

                } else if (data.status === 'code_not_found') {
                    console.log('[Embedder] Code not found, restarting...');
                    this.cancelDeviceCodeAuth();
                    this.startDeviceCodeAuth();

                } else {
                    console.error('[Embedder] Unknown poll status:', data);
                    throw new Error(data.status || 'Unknown error occurred');
                }

            } catch (error) {
                console.error('[Embedder] Polling error:', error);
                this.cancelDeviceCodeAuth();
                this.updateEmbedderStatus(`Polling failed: ${error.message}`, 'error');
            }
        };

        poll();
    }

    cancelDeviceCodeAuth() {
        if (this.deviceCodePolling) {
            clearTimeout(this.deviceCodePolling);
            this.deviceCodePolling = null;
        }

        this.deviceCodeData = null;

        document.getElementById('authModal').classList.remove('show');

        console.log('[Embedder] Device code authentication cancelled');
    }

    async embedderLogout() {
        // Cancel any ongoing device code polling
        this.cancelDeviceCodeAuth();

        try {
            const response = await fetch(`${this.embedderConfig.phpAuthUrl}?action=logout`);

            if (!response.ok) {
                throw new Error(`Logout failed: ${response.status}`);
            }

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Logout failed');
            }

            this.updateEmbedderStatus('Logged out successfully', 'info');

            this.credentials = null;
            await this.updateEmbedderUI();

        } catch (error) {
            console.error('[Embedder] Logout error:', error);
            this.updateEmbedderStatus('Logged out (with error)', 'info');
            this.credentials = null;
            await this.updateEmbedderUI();
        }
    }

    async loadEmbedderCredentials() {
        try {
            const response = await fetch(`${this.embedderConfig.phpAuthUrl}?action=get_credentials`);

            if (!response.ok) {
                console.error('[Embedder] Failed to load credentials:', response.status);
                this.credentials = null;
                return null;
            }

            const result = await response.json();

            if (!result.success) {
                console.error('[Embedder] Error loading credentials:', result.error);
                this.credentials = null;
                return null;
            }

            if (result.authenticated && result.credentials) {
                this.credentials = result.credentials;
                return result.credentials;
            }

            this.credentials = null;
            return null;

        } catch (error) {
            console.error('[Embedder] Error loading credentials:', error);
            this.credentials = null;
            return null;
        }
    }

    async updateEmbedderUI() {
        const credentials = this.credentials;
        const isAuthenticated = credentials && credentials.accessToken;
        const isExpired = credentials && Date.now() > credentials.expiresAt;

        console.log('[Embedder] UI Update - Authenticated:', isAuthenticated, 'Expired:', isExpired);

        document.getElementById('authMethodSelection').classList.toggle('hidden', isAuthenticated);
        document.getElementById('authenticatedActions').classList.toggle('hidden', !isAuthenticated);
        document.getElementById('userSection').classList.toggle('hidden', !isAuthenticated);

        const chatEnabled = isAuthenticated && !isExpired;
        document.getElementById('embedderInput').disabled = !chatEnabled;
        document.getElementById('sendEmbedderMessage').disabled = !chatEnabled;
        document.getElementById('sendCodeToEmbedder').disabled = !chatEnabled;
        document.getElementById('clearEmbedderChat').disabled = !chatEnabled;

        document.querySelectorAll('.embedder-quick-btn').forEach(btn => {
            btn.disabled = !chatEnabled;
        });

        const statusDot = document.getElementById('embedderStatusIndicator');
        const statusText = document.getElementById('embedderStatusText');

        if (isAuthenticated) {
            const userInfo = {
                email: credentials.user?.email || 'N/A',
                uid: credentials.user?.uid ? credentials.user.uid.substring(0, 8) + '...' : 'N/A'
            };
            document.getElementById('userInfo').textContent = JSON.stringify(userInfo, null, 2);

            if (!isExpired) {
                await this.loadEmbedderModels();
            }

            if (isExpired) {
                statusDot.className = 'status-dot disconnected';
                statusText.textContent = 'Token expired';
                this.updateEmbedderStatus('Token expired. Please refresh or login again.', 'error');
            } else {
                statusDot.className = 'status-dot connected';
                statusText.textContent = 'Connected';
                const currentStatus = document.getElementById('authStatus');
                if (!currentStatus || currentStatus.textContent.includes('Not authenticated')) {
                    this.updateEmbedderStatus('Authenticated', 'success');
                }
            }
        } else {
            statusDot.className = 'status-dot disconnected';
            statusText.textContent = 'Not authenticated';
            const currentStatus = document.getElementById('authStatus');
            if (!currentStatus || !currentStatus.textContent.includes('Processing')) {
                this.updateEmbedderStatus('Not authenticated', 'info');
            }
        }
    }

    formatTimeRemaining(expiresAt) {
        const now = Date.now();
        const remaining = expiresAt - now;

        if (remaining < 0) {
            return 'Expired';
        }

        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);

        if (minutes > 60) {
            const hours = Math.floor(minutes / 60);
            const mins = minutes % 60;
            return `${hours}h ${mins}m`;
        }

        return `${minutes}m ${seconds}s`;
    }

    updateEmbedderStatus(message, type = 'info') {
        const statusEl = document.getElementById('authStatus');
        if (statusEl) {
            statusEl.textContent = message;
            statusEl.className = `status-${type}`;
            statusEl.style.display = 'block';

            console.log('[Embedder] Status update:', type, message);

            // Auto-hide success/info messages after 5 seconds (not errors)
            if (type === 'success' || (type === 'info' && !message.includes('Redirecting'))) {
                setTimeout(() => {
                    statusEl.style.display = 'none';
                }, 5000);
            }
        }
    }

    // Embedder Chat Methods
    async sendEmbedderMessage() {
        const input = document.getElementById('embedderInput');
        const message = input.value.trim();

        if (!message) return;

        // Check cached credentials
        if (!this.credentials || !this.credentials.accessToken) {
            alert('Please login with Embedder first');
            this.updateEmbedderStatus('Not authenticated. Please login first.', 'error');
            return;
        }

        // Check if token is expired
        if (Date.now() > this.credentials.expiresAt) {
            alert('Token expired. Please refresh or login again.');
            this.updateEmbedderStatus('Token expired', 'error');
            return;
        }

        // Add user message to conversation
        this.embedderConversation.push({
            role: 'user',
            content: message
        });

        this.renderEmbedderConversation();
        input.value = '';

        // Show typing indicator
        this.showEmbedderTyping();

        try {
            const response = await this.callEmbedderAPI(this.embedderConversation, this.credentials.accessToken);

            // Remove typing indicator
            this.hideEmbedderTyping();

            if (response && response.message) {
                // Add assistant response to conversation
                this.embedderConversation.push({
                    role: 'assistant',
                    content: response.message
                });

                this.renderEmbedderConversation();
            }
        } catch (error) {
            this.hideEmbedderTyping();
            console.error('Embedder API error:', error);

            // Add error message to conversation
            this.embedderConversation.push({
                role: 'assistant',
                content: `Error: ${error.message}`
            });
            this.renderEmbedderConversation();
        }
    }

    async callEmbedderAPI(messages, token) {
        const model = this.embedderSettings.model;

        console.log('[Embedder] API Request via PHP proxy:', { model, messageCount: messages.length });

        // Call PHP proxy instead of Embedder API directly (bypasses CORS)
        const response = await fetch(`${this.embedderConfig.phpAuthUrl}?action=proxy_api`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                temperature: this.embedderSettings.temperature,
                max_tokens: 4096
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Embedder] Proxy Error Response:', errorText);
            throw new Error(`Proxy request failed: ${response.status} - ${errorText}`);
        }

        const result = await response.json();

        if (!result.success) {
            console.error('[Embedder] API Error:', result.error);
            throw new Error(result.error || 'API request failed');
        }

        const data = result.data;
        console.log('[Embedder] API Response received');

        // Parse response based on API type
        const isAnthropic = model.startsWith('claude-');

        if (isAnthropic) {
            // Anthropic response format: { content: [{ type: "text", text: "..." }] }
            return {
                message: data.content?.[0]?.text || 'No response'
            };
        } else {
            // OpenAI response format: { choices: [{ message: { content: "..." } }] }
            return {
                message: data.choices?.[0]?.message?.content || 'No response'
            };
        }
    }

    async loadEmbedderModels() {
        try {
            console.log('[Embedder] Loading available models...');

            const response = await fetch(`${this.embedderConfig.phpAuthUrl}?action=get_models`);

            if (!response.ok) {
                throw new Error(`Failed to load models: ${response.status}`);
            }

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Failed to load models');
            }

            const models = result.models;
            console.log('[Embedder] Loaded models:', models);

            // Populate model dropdown
            const modelSelect = document.getElementById('embedderModel');
            modelSelect.innerHTML = '';  // Clear existing options

            // Group models by provider
            const anthropicModels = models.filter(m => m.provider === 'anthropic' && m.status === 'enabled');
            const openaiModels = models.filter(m => m.provider === 'openai' && m.status === 'enabled');

            // Helper function to create readable model names
            const formatModelName = (modelName) => {
                // claude-sonnet-4-20250514 -> Claude Sonnet 4 (2025-05-14)
                // claude-sonnet-4-5-20250929 -> Claude Sonnet 4.5 (2025-09-29)
                // gpt-5-2025-08-07 -> GPT-5 (2025-08-07)

                if (modelName.startsWith('claude-')) {
                    const parts = modelName.replace('claude-', '').split('-');
                    const variant = parts[0]; // sonnet, haiku, opus
                    const version = parts.slice(1, -1).join('.'); // 4, 4.5, etc
                    const date = parts[parts.length - 1]; // 20250514
                    const formattedDate = `${date.substring(0,4)}-${date.substring(4,6)}-${date.substring(6,8)}`;
                    return `Claude ${variant.charAt(0).toUpperCase() + variant.slice(1)} ${version} (${formattedDate})`;
                } else if (modelName.startsWith('gpt-')) {
                    const parts = modelName.split('-');
                    const version = parts[1]; // 4o, 5, etc
                    const date = parts[2]; // 20250807
                    if (date) {
                        const formattedDate = `${date.substring(0,4)}-${date.substring(4,6)}-${date.substring(6,8)}`;
                        return `GPT-${version} (${formattedDate})`;
                    }
                    return `GPT-${version}`;
                }
                return modelName;
            };

            // Add Anthropic models
            if (anthropicModels.length > 0) {
                const optgroup = document.createElement('optgroup');
                optgroup.label = 'Anthropic';
                anthropicModels.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.name;
                    option.textContent = formatModelName(model.name);
                    optgroup.appendChild(option);
                });
                modelSelect.appendChild(optgroup);
            }

            // Add OpenAI models
            if (openaiModels.length > 0) {
                const optgroup = document.createElement('optgroup');
                optgroup.label = 'OpenAI';
                openaiModels.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.name;
                    option.textContent = formatModelName(model.name);
                    optgroup.appendChild(option);
                });
                modelSelect.appendChild(optgroup);
            }

            // Set default to first model if current selection is invalid
            if (models.length > 0) {
                const currentModel = this.embedderSettings.model;
                const modelExists = models.some(m => m.name === currentModel);
                if (!modelExists) {
                    this.embedderSettings.model = models[0].name;
                    modelSelect.value = models[0].name;
                    console.log('[Embedder] Default model set to:', models[0].name);
                } else {
                    modelSelect.value = currentModel;
                }
            }

            console.log('[Embedder] Models loaded and dropdown populated');

        } catch (error) {
            console.error('[Embedder] Error loading models:', error);
            // Keep hardcoded defaults if API fails
            this.updateEmbedderStatus('Could not load models. Using defaults.', 'warning');
        }
    }

    renderEmbedderConversation() {
        const conversationEl = document.getElementById('embedderConversation');

        // Clear welcome message if there are messages
        if (this.embedderConversation.length > 0) {
            conversationEl.innerHTML = '';
        }

        // Render all messages
        this.embedderConversation.forEach((msg, index) => {
            const messageEl = document.createElement('div');
            messageEl.className = `embedder-message ${msg.role}`;

            const headerEl = document.createElement('div');
            headerEl.className = 'embedder-message-header';
            headerEl.textContent = msg.role === 'user' ? 'You' : 'Embedder';

            const contentEl = document.createElement('div');
            contentEl.className = 'embedder-message-content';

            // Format content (handle code blocks)
            contentEl.innerHTML = this.formatEmbedderMessage(msg.content);

            messageEl.appendChild(headerEl);
            messageEl.appendChild(contentEl);

            // Add action buttons for assistant messages with code
            if (msg.role === 'assistant' && msg.content.includes('```')) {
                const actionsEl = document.createElement('div');
                actionsEl.className = 'embedder-message-actions';

                const copyBtn = document.createElement('button');
                copyBtn.className = 'btn btn-sm';
                copyBtn.textContent = 'Copy Code';
                copyBtn.onclick = () => this.copyEmbedderCode(msg.content);

                const insertBtn = document.createElement('button');
                insertBtn.className = 'btn btn-sm btn-primary';
                insertBtn.textContent = 'Insert to Editor';
                insertBtn.onclick = () => this.insertEmbedderCodeToEditor(msg.content);

                actionsEl.appendChild(copyBtn);
                actionsEl.appendChild(insertBtn);
                messageEl.appendChild(actionsEl);
            }

            conversationEl.appendChild(messageEl);
        });

        // Auto-scroll to bottom
        conversationEl.scrollTop = conversationEl.scrollHeight;
    }

    formatEmbedderMessage(content) {
        // Simple markdown-like formatting for code blocks
        return content
            .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
    }

    copyEmbedderCode(content) {
        // Extract code from markdown code blocks
        const codeMatch = content.match(/```[\w+]?\n([\s\S]*?)```/);
        if (codeMatch) {
            navigator.clipboard.writeText(codeMatch[1].trim());
            this.appendToTerminal('Code copied to clipboard', 'log-success');
        }
    }

    insertEmbedderCodeToEditor(content) {
        // Extract code from markdown code blocks
        const codeMatch = content.match(/```[\w+]?\n([\s\S]*?)```/);
        if (codeMatch) {
            this.codeEditor.setValue(codeMatch[1].trim());
            this.switchTab('editor');
            this.appendToTerminal('Code inserted into editor', 'log-success');
        }
    }

    includeCodeInEmbedder() {
        const code = this.codeEditor.getValue();
        const input = document.getElementById('embedderInput');

        if (code.trim()) {
            input.value = `Here's my code:\n\`\`\`javascript\n${code}\n\`\`\`\n\n${input.value}`;
            input.focus();
        }
    }

    embedderQuickAction(prompt) {
        if (!this.credentials || !this.credentials.accessToken) {
            alert('Please login with Embedder first');
            this.updateEmbedderStatus('Not authenticated. Please login first.', 'error');
            return;
        }

        const code = this.codeEditor.getValue();
        const input = document.getElementById('embedderInput');

        if (code.trim()) {
            input.value = `${prompt}:\n\`\`\`javascript\n${code}\n\`\`\``;
        } else {
            input.value = prompt;
        }

        // Auto-send the message
        this.sendEmbedderMessage();
    }

    clearEmbedderConversation() {
        if (confirm('Are you sure you want to clear the conversation?')) {
            this.embedderConversation = [];
            const conversationEl = document.getElementById('embedderConversation');
            conversationEl.innerHTML = `
                <div class="embedder-welcome">
                    <h4>Welcome to Embedder</h4>
                    <p>Conversation cleared. Start a new chat!</p>
                </div>
            `;
        }
    }

    showEmbedderTyping() {
        const conversationEl = document.getElementById('embedderConversation');
        const typingEl = document.createElement('div');
        typingEl.id = 'embedder-typing';
        typingEl.className = 'embedder-message assistant';
        typingEl.innerHTML = `
            <div class="embedder-message-header">Embedder</div>
            <div class="embedder-typing-indicator">
                <div class="embedder-typing-dot"></div>
                <div class="embedder-typing-dot"></div>
                <div class="embedder-typing-dot"></div>
            </div>
        `;
        conversationEl.appendChild(typingEl);
        conversationEl.scrollTop = conversationEl.scrollHeight;
    }

    hideEmbedderTyping() {
        const typingEl = document.getElementById('embedder-typing');
        if (typingEl) {
            typingEl.remove();
        }
    }
}

// Initialize the IDE when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.webScreenIDE = new WebScreenIDE();
});