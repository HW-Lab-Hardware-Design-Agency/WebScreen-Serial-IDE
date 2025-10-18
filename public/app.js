class WebScreenIDE {
    constructor() {
        this.serialManager = new SerialManager();
        this.codeEditor = null;
        this.currentFile = '';
        this.fileList = [];
        this.isMonitoring = false;
        this.currentTheme = 'retro';

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
            // Actual backend endpoints from CLI package
            backendUrl: 'https://backend-service-prod.embedder.dev',
            proxyAnthropicUrl: 'https://backend-service-prod.embedder.dev/api/v1/proxy/anthropic/',
            proxyOpenAIUrl: 'https://backend-service-prod.embedder.dev/api/v1/proxy/openai/',
            proxyGoogleUrl: 'https://backend-service-prod.embedder.dev/api/v1/proxy/google/'
        };

        this.embedderConversation = [];
        this.embedderSettings = {
            model: 'claude-4-5-sonnet',
            temperature: 0.7
        };

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

        // Embedder buttons
        document.getElementById('loginBtn').addEventListener('click', () => {
            this.startEmbedderAuth();
        });

        document.getElementById('logoutBtn').addEventListener('click', () => {
            this.embedderLogout();
        });

        document.getElementById('refreshTokenBtn').addEventListener('click', () => {
            this.embedderRefreshToken();
        });

        // Embedder chat
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

        // Embedder settings
        document.getElementById('embedderModel').addEventListener('change', (e) => {
            this.embedderSettings.model = e.target.value;
        });

        document.getElementById('embedderTemp').addEventListener('input', (e) => {
            this.embedderSettings.temperature = parseFloat(e.target.value);
            document.getElementById('embedderTempValue').textContent = e.target.value;
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
    initEmbedder() {
        console.log('[Embedder] Initializing...');

        // Display callback URL for debugging
        const baseUrl = window.location.origin + window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);
        const callbackUrl = baseUrl + 'callback.html';
        const callbackDisplay = document.getElementById('callbackUrlDisplay');
        if (callbackDisplay) {
            callbackDisplay.textContent = callbackUrl;
        }

        // Set up postMessage listener for popup authentication
        window.addEventListener('message', (event) => {
            // Security: verify the message is from our own origin
            if (event.origin !== window.location.origin) {
                console.warn('[Embedder] Received message from different origin:', event.origin);
                return;
            }

            console.log('[Embedder] Received postMessage:', event.data);

            if (event.data.type === 'embedder-auth-success' && event.data.token) {
                console.log('[Embedder] Authentication successful via popup');
                this.handleEmbedderAuthSuccess(event.data.token);
            } else if (event.data.type === 'embedder-auth-error') {
                console.error('[Embedder] Authentication error via popup:', event.data.error);
                this.updateEmbedderStatus(`Authentication failed: ${event.data.error}`, 'error');
            }
        });

        // Load saved credentials
        this.loadEmbedderCredentials();

        // Update UI
        this.updateEmbedderUI();

        // Auto-refresh embedder UI every second
        setInterval(() => {
            const credentials = this.loadEmbedderCredentials();
            if (credentials && credentials.accessToken) {
                this.updateEmbedderUI();
            }
        }, 1000);
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

            // Calculate expiration time
            const expiresIn = parseInt(data.expiresIn, 10);
            const expiresAt = Date.now() + (expiresIn * 1000);

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
            this.updateEmbedderUI();
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

    startEmbedderAuth() {
        // Build callback URL pointing to callback.html
        const baseUrl = window.location.origin + window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);
        const callbackUrl = baseUrl + 'callback.html';

        // Build Embedder auth URL
        const authUrl = new URL(this.embedderConfig.authUrl);
        authUrl.searchParams.set('callback', callbackUrl);
        authUrl.searchParams.set('source', 'webscreen-ide');

        console.log('[Embedder] Starting popup authentication...');
        console.log('[Embedder] Callback URL:', callbackUrl);
        console.log('[Embedder] Auth URL:', authUrl.toString());

        this.updateEmbedderStatus('Opening authentication popup...', 'info');

        // Open popup window
        const width = 500;
        const height = 700;
        const left = window.screen.width / 2 - width / 2;
        const top = window.screen.height / 2 - height / 2;

        const popup = window.open(
            authUrl.toString(),
            'embedder-auth',
            `width=${width},height=${height},left=${left},top=${top},toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes`
        );

        if (popup) {
            console.log('[Embedder] Popup opened successfully');
            this.updateEmbedderStatus('Please complete authentication in the popup window...', 'info');

            // Monitor popup to detect if user closes it
            const popupMonitor = setInterval(() => {
                if (popup.closed) {
                    clearInterval(popupMonitor);
                    console.log('[Embedder] Popup was closed');

                    // Check if we got credentials (authentication might have succeeded)
                    const credentials = this.loadEmbedderCredentials();
                    if (!credentials || !credentials.accessToken) {
                        this.updateEmbedderStatus('Authentication cancelled', 'info');
                    }
                }
            }, 500);
        } else {
            console.error('[Embedder] Failed to open popup - might be blocked');
            this.updateEmbedderStatus('Failed to open popup. Please allow popups for this site.', 'error');
        }
    }

    async embedderRefreshToken() {
        const credentials = this.loadEmbedderCredentials();

        if (!credentials || !credentials.refreshToken) {
            this.updateEmbedderStatus('No refresh token available. Please login again.', 'error');
            return;
        }

        this.updateEmbedderStatus('Refreshing token...', 'info');

        try {
            const url = `${this.embedderConfig.tokenApiUrl}?key=${this.embedderConfig.apiKey}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: credentials.refreshToken
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error?.message || `HTTP ${response.status}`);
            }

            const data = await response.json();

            const expiresIn = typeof data.expires_in === 'string'
                ? parseInt(data.expires_in, 10)
                : data.expires_in || 3600;

            credentials.accessToken = data.id_token;
            credentials.idToken = data.id_token;
            credentials.refreshToken = data.refresh_token || credentials.refreshToken;
            credentials.expiresAt = Date.now() + (expiresIn * 1000);
            credentials.timestamp = Date.now();

            this.saveEmbedderCredentials(credentials);
            this.updateEmbedderStatus('Token refreshed successfully!', 'success');
            this.updateEmbedderUI();

        } catch (error) {
            this.updateEmbedderStatus(`Token refresh failed: ${error.message}`, 'error');
            console.error('Token refresh error:', error);
        }
    }

    embedderLogout() {
        localStorage.removeItem('embedder_credentials');
        this.updateEmbedderStatus('Logged out successfully', 'info');
        this.updateEmbedderUI();
    }

    saveEmbedderCredentials(credentials) {
        localStorage.setItem('embedder_credentials', JSON.stringify(credentials));
    }

    loadEmbedderCredentials() {
        const stored = localStorage.getItem('embedder_credentials');
        return stored ? JSON.parse(stored) : null;
    }

    updateEmbedderUI() {
        const credentials = this.loadEmbedderCredentials();
        const isAuthenticated = credentials && credentials.accessToken;
        const isExpired = credentials && Date.now() > credentials.expiresAt;

        // Toggle buttons
        document.getElementById('loginBtn').classList.toggle('hidden', isAuthenticated);
        document.getElementById('logoutBtn').classList.toggle('hidden', !isAuthenticated);
        document.getElementById('refreshTokenBtn').classList.toggle('hidden', !isAuthenticated);

        // Toggle sections
        document.getElementById('userSection').classList.toggle('hidden', !isAuthenticated);

        // Enable/disable chat controls
        const chatEnabled = isAuthenticated && !isExpired;
        document.getElementById('embedderInput').disabled = !chatEnabled;
        document.getElementById('sendEmbedderMessage').disabled = !chatEnabled;
        document.getElementById('sendCodeToEmbedder').disabled = !chatEnabled;
        document.getElementById('clearEmbedderChat').disabled = !chatEnabled;

        // Enable/disable quick action buttons
        document.querySelectorAll('.embedder-quick-btn').forEach(btn => {
            btn.disabled = !chatEnabled;
        });

        // Update status indicator
        const statusDot = document.getElementById('embedderStatusIndicator');
        const statusText = document.getElementById('embedderStatusText');

        if (isAuthenticated) {
            // Display user info
            const userInfo = {
                email: credentials.user?.email,
                uid: credentials.user?.uid?.substring(0, 8) + '...'
            };
            document.getElementById('userInfo').textContent = JSON.stringify(userInfo, null, 2);

            // Update status
            if (isExpired) {
                statusDot.className = 'status-dot disconnected';
                statusText.textContent = 'Token expired';
                this.updateEmbedderStatus('Token expired. Please refresh or login again.', 'error');
            } else {
                statusDot.className = 'status-dot connected';
                statusText.textContent = 'Connected';
                this.updateEmbedderStatus('Authenticated', 'success');
            }
        } else {
            statusDot.className = 'status-dot disconnected';
            statusText.textContent = 'Not authenticated';
            this.updateEmbedderStatus('Not authenticated', 'info');
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

        const credentials = this.loadEmbedderCredentials();
        if (!credentials || !credentials.accessToken) {
            alert('Please login with Embedder first');
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
            const response = await this.callEmbedderAPI(this.embedderConversation, credentials.accessToken);

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

        // Determine which proxy to use based on model
        let proxyUrl, endpoint, requestBody, isAnthropic;

        if (model.startsWith('claude-')) {
            // Anthropic models
            proxyUrl = this.embedderConfig.proxyAnthropicUrl;
            endpoint = 'v1/messages';
            isAnthropic = true;
            requestBody = {
                model: model,
                messages: messages,
                max_tokens: 4096,
                temperature: this.embedderSettings.temperature
            };
        } else if (model.startsWith('gpt-')) {
            // OpenAI models
            proxyUrl = this.embedderConfig.proxyOpenAIUrl;
            endpoint = 'v1/chat/completions';
            isAnthropic = false;
            requestBody = {
                model: model,
                messages: messages,
                temperature: this.embedderSettings.temperature
            };
        } else {
            throw new Error(`Unsupported model: ${model}`);
        }

        console.log('[Embedder] API Request:', { proxyUrl, endpoint, model });

        const response = await fetch(proxyUrl + endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Embedder] API Error Response:', errorText);
            throw new Error(`API request failed: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log('[Embedder] API Response:', data);

        // Parse response based on API type
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
        const credentials = this.loadEmbedderCredentials();
        if (!credentials || !credentials.accessToken) {
            alert('Please login with Embedder first');
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