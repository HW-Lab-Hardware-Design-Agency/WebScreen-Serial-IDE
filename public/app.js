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
            model: 'claude-4-5-sonnet',
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

        // Embedder authentication buttons
        document.getElementById('loginBrowserBtn').addEventListener('click', () => {
            this.startBrowserAuth();
        });

        document.getElementById('loginDeviceCodeBtn').addEventListener('click', () => {
            this.startDeviceCodeAuth();
        });

        document.getElementById('cancelDeviceCode').addEventListener('click', () => {
            this.cancelDeviceCodeAuth();
        });

        document.getElementById('logoutBtn').addEventListener('click', () => {
            this.embedderLogout();
        });

        document.getElementById('refreshTokenBtn').addEventListener('click', () => {
            this.embedderRefreshToken();
        });

        document.getElementById('submitManualToken').addEventListener('click', () => {
            this.submitManualToken();
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

    startBrowserAuth() {
        // Browser-based OAuth callback flow via PHP backend
        // PHP handles token exchange and session management

        const baseUrl = window.location.origin + window.location.pathname.replace('index.html', '');
        const callbackUrl = baseUrl + this.embedderConfig.phpAuthUrl + '?action=callback';

        // Build Embedder auth URL
        const authUrl = new URL(this.embedderConfig.authUrl);
        authUrl.searchParams.set('callback', callbackUrl);
        authUrl.searchParams.set('source', 'webscreen-ide');

        console.log('[Embedder] Starting browser OAuth flow...');
        console.log('[Embedder] Callback URL:', callbackUrl);
        console.log('[Embedder] Auth URL:', authUrl.toString());

        this.updateEmbedderStatus('Redirecting to Embedder...', 'info');

        // Redirect to Embedder auth page
        // Embedder will redirect to PHP callback which handles token exchange
        window.location.href = authUrl.toString();
    }

    async startDeviceCodeAuth() {
        // Device code flow via PHP backend (no CORS issues!)
        console.log('[Embedder] Starting device code flow...');
        this.updateEmbedderStatus('Starting device code authentication...', 'info');

        try {
            // Step 1: Request device code from PHP backend
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

            // Show device code UI
            this.showDeviceCodeUI(userCode, verificationUri);

            // Step 2: Start polling for authorization
            const expiresAt = Date.now() + (expiresIn * 1000);
            this.startDeviceCodePolling(userCode, expiresAt);

        } catch (error) {
            console.error('[Embedder] Device code auth error:', error);
            this.updateEmbedderStatus(`Device code auth failed: ${error.message}`, 'error');
        }
    }

    showDeviceCodeUI(userCode, verificationUri) {
        // Hide auth method selection
        document.getElementById('authMethodSelection').classList.add('hidden');

        // Show device code display
        const deviceCodeDisplay = document.getElementById('deviceCodeDisplay');
        deviceCodeDisplay.classList.remove('hidden');

        // Set the code and URL
        document.getElementById('deviceCodeValue').textContent = userCode;
        document.getElementById('verificationUrl').textContent = verificationUri;
        document.getElementById('verificationUrl').href = verificationUri;

        // Open verification URL in new tab
        window.open(verificationUri, '_blank');

        this.updateEmbedderStatus('Enter the code shown above at the verification URL', 'info');
    }

    startDeviceCodePolling(userCode, expiresAt) {
        const POLL_INTERVAL = 3000; // 3 seconds, same as CLI

        const poll = async () => {
            try {
                // Check if expired
                if (Date.now() > expiresAt) {
                    console.log('[Embedder] Device code expired, restarting...');
                    this.cancelDeviceCodeAuth();
                    this.updateEmbedderStatus('Device code expired. Please try again.', 'error');
                    return;
                }

                // Update status
                document.getElementById('deviceCodeStatus').textContent = 'Waiting for activation...';

                // Poll for token via PHP backend
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
                    // Success! PHP backend has exchanged the token
                    console.log('[Embedder] Device authorized! Token exchanged by PHP backend.');
                    this.cancelDeviceCodeAuth(); // Stop polling

                    this.updateEmbedderStatus('Device authorized! Loading credentials...', 'success');

                    // Wait a moment for session to be written
                    await new Promise(resolve => setTimeout(resolve, 500));

                    // Load credentials from PHP session
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
                    // Keep polling
                    console.log('[Embedder] Still waiting for user to authorize...');
                    this.deviceCodePolling = setTimeout(poll, POLL_INTERVAL);

                } else if (data.status === 'code_not_found') {
                    // Code not found, restart flow
                    console.log('[Embedder] Code not found, restarting...');
                    this.cancelDeviceCodeAuth();
                    this.startDeviceCodeAuth();

                } else {
                    // Unknown status
                    console.error('[Embedder] Unknown poll status:', data);
                    throw new Error(data.status || 'Unknown error occurred');
                }

            } catch (error) {
                console.error('[Embedder] Polling error:', error);
                this.cancelDeviceCodeAuth();
                this.updateEmbedderStatus(`Polling failed: ${error.message}`, 'error');
            }
        };

        // Start polling
        poll();
    }

    cancelDeviceCodeAuth() {
        // Stop polling
        if (this.deviceCodePolling) {
            clearTimeout(this.deviceCodePolling);
            this.deviceCodePolling = null;
        }

        // Clear device code data
        this.deviceCodeData = null;

        // Hide device code display
        document.getElementById('deviceCodeDisplay').classList.add('hidden');

        // Show auth method selection again
        document.getElementById('authMethodSelection').classList.remove('hidden');

        console.log('[Embedder] Device code authentication cancelled');
    }

    async submitManualToken() {
        const input = document.getElementById('manualTokenInput');
        const token = input.value.trim();

        if (!token) {
            this.updateEmbedderStatus('Please enter a token', 'error');
            return;
        }

        console.log('[Embedder] Manual token submitted');
        this.updateEmbedderStatus('Processing token...', 'info');

        try {
            // Exchange token via PHP backend
            const response = await fetch(`${this.embedderConfig.phpAuthUrl}?action=exchange_token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ token })
            });

            if (!response.ok) {
                throw new Error(`Token exchange failed: ${response.status}`);
            }

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Token exchange failed');
            }

            input.value = '';  // Clear input after successful submission
            this.updateEmbedderStatus('Authentication successful!', 'success');

            // Load credentials from PHP session
            await this.loadEmbedderCredentials();
            await this.updateEmbedderUI();

        } catch (error) {
            console.error('[Embedder] Manual token error:', error);
            this.updateEmbedderStatus(`Token exchange failed: ${error.message}`, 'error');
        }
    }

    async embedderRefreshToken() {
        this.updateEmbedderStatus('Refreshing token...', 'info');

        try {
            const response = await fetch(`${this.embedderConfig.phpAuthUrl}?action=refresh_token`);

            if (!response.ok) {
                throw new Error(`Token refresh failed: ${response.status}`);
            }

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Token refresh failed');
            }

            this.updateEmbedderStatus('Token refreshed successfully!', 'success');

            // Load updated credentials from PHP session
            await this.loadEmbedderCredentials();
            await this.updateEmbedderUI();

        } catch (error) {
            this.updateEmbedderStatus(`Token refresh failed: ${error.message}`, 'error');
            console.error('[Embedder] Token refresh error:', error);
        }
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

            // Clear local credential cache
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
        // Always load fresh credentials from PHP session
        await this.loadEmbedderCredentials();

        const credentials = this.credentials;  // Use cached credentials
        const isAuthenticated = credentials && credentials.accessToken;
        const isExpired = credentials && Date.now() > credentials.expiresAt;

        console.log('[Embedder] UI Update - Authenticated:', isAuthenticated, 'Expired:', isExpired);

        // Toggle auth method selection vs authenticated actions
        document.getElementById('authMethodSelection').classList.toggle('hidden', isAuthenticated);
        document.getElementById('authenticatedActions').classList.toggle('hidden', !isAuthenticated);

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
                email: credentials.user?.email || 'N/A',
                uid: credentials.user?.uid ? credentials.user.uid.substring(0, 8) + '...' : 'N/A'
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
                // Don't overwrite more specific status messages
                const currentStatus = document.getElementById('authStatus');
                if (!currentStatus || currentStatus.textContent.includes('Not authenticated')) {
                    this.updateEmbedderStatus('Authenticated', 'success');
                }
            }
        } else {
            statusDot.className = 'status-dot disconnected';
            statusText.textContent = 'Not authenticated';
            // Don't overwrite more specific status messages during auth flow
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