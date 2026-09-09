class WebScreenIDE {
    constructor() {
        this.serialManager = new SerialManager();
        this.codeEditor = null;
        this.currentFile = '';
        this.fileList = [];
        this.isMonitoring = false;
        this.currentTheme = 'retro';
        this.isCapturingScreenshot = false;
        this.fileOperation = false;
        this.revision = 0;
        this.dirty = false;
        this.terminalQueue = [];

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
        this.restoreDraft();
        this.updateUI();
    }

    initEditor() {
        // Initialize CodeMirror
        const createEditor = window.CodeMirror || this.createFallbackEditor;
        this.codeEditor = createEditor(document.getElementById('codeEditor'), {
            mode: 'javascript',
            theme: this.currentTheme === 'focus' ? 'default' : 'dracula',
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
                'Cmd-S': () => this.saveFile(),
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
        this.codeEditor.on('change', () => this.editorChanged());
        if (!window.CodeMirror) this.appendToTerminal('Syntax editor unavailable. Plain text editing and device tools are still available.', 'log-warning');
    }

    setupEventListeners() {
        document.getElementById('downloadEditor').addEventListener('click', () => this.downloadEditor());
        document.getElementById('parentDirectory').addEventListener('click', () => {
            const parts = this.currentPath.split('/').filter(Boolean);
            parts.pop();
            this.refreshFileList('/' + (parts.length ? parts.join('/') + '/' : ''));
        });
        document.getElementById('downloadFile').addEventListener('click', () => this.downloadSelectedFile());
        window.addEventListener('pagehide', () => this.persistDraft());
        window.addEventListener('beforeunload', event => {
            this.persistDraft();
            if (this.dirty || this.fileOperation) { event.preventDefault(); event.returnValue = ''; }
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') this.hideScreenshotOverlay();
            if (event.key === 'Tab' && document.getElementById('screenshotOverlay').style.display === 'flex') {
                const first = document.getElementById('screenshotClose');
                const last = document.getElementById('screenshotDownload');
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
        });
        const tabs = Array.from(document.querySelectorAll('.tab'));
        tabs.forEach((tab, index) => tab.addEventListener('keydown', event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length :
                event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length :
                event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
            if (next < 0) return;
            event.preventDefault();
            this.switchTab(tabs[next].dataset.tab);
            tabs[next].focus();
        }));
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
                    this.uploadFiles(Array.from(e.target.files));
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
            this.editorChanged();
        });
    }

    createFallbackEditor(container, options) {
        const textarea = document.createElement('textarea');
        textarea.className = 'fallback-editor';
        textarea.setAttribute('aria-label', 'Source code');
        textarea.spellcheck = false;
        textarea.value = options.value;
        container.appendChild(textarea);
        const listeners = {};
        const emit = event => listeners[event]?.(editor);
        const editor = {
            getValue: () => textarea.value,
            setValue: value => { textarea.value = value; emit('change'); },
            getSelection: () => textarea.value.slice(textarea.selectionStart, textarea.selectionEnd),
            getCursor: () => {
                const lines = textarea.value.slice(0, textarea.selectionStart).split('\n');
                return {line:lines.length - 1, ch:lines[lines.length - 1].length};
            },
            getLine: index => textarea.value.split('\n')[index],
            on: (event, callback) => { listeners[event] = callback; },
            setOption: () => {}, refresh: () => {}, focus: () => textarea.focus()
        };
        textarea.addEventListener('input', () => emit('change'));
        for (const event of ['keyup', 'click', 'select']) textarea.addEventListener(event, () => emit('cursorActivity'));
        textarea.addEventListener('keydown', event => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault(); options.extraKeys['Ctrl-S']();
            } else if (event.key === 'F5') {
                event.preventDefault(); options.extraKeys.F5();
            } else if (event.key === 'Tab') {
                event.preventDefault();
                textarea.setRangeText('  ', textarea.selectionStart, textarea.selectionEnd, 'end');
                emit('change');
            }
        });
        return editor;
    }

    editorChanged() {
        this.revision++;
        this.dirty = true;
        this.updateFileStatus('Modified');
        clearTimeout(this.draftTimer);
        this.draftTimer = setTimeout(() => this.persistDraft(), 400);
    }

    persistDraft() {
        clearTimeout(this.draftTimer);
        try {
            localStorage.setItem('webscreen-ide-draft', JSON.stringify({
                version:1, filename:document.getElementById('filename').value,
                content:this.codeEditor.getValue(), dirty:this.dirty
            }));
        } catch {
            if (!this.storageWarning) {
                this.storageWarning = true;
                this.appendToTerminal('Draft recovery is unavailable in this browser. Use Download to keep a local copy.', 'log-warning');
            }
        }
    }

    restoreDraft() {
        try {
            const draft = JSON.parse(localStorage.getItem('webscreen-ide-draft'));
            if (draft?.version !== 1 || typeof draft.content !== 'string' || typeof draft.filename !== 'string') return;
            this.codeEditor.setValue(draft.content);
            this.currentFile = document.getElementById('filename').value = draft.filename;
            this.updateEditorMode(draft.filename);
            this.dirty = true; // The connected device may differ from the last session.
            this.updateFileStatus('Draft restored — verify before saving');
        } catch { /* Private browsing or corrupt storage must not prevent startup. */ }
    }

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename.split('/').pop() || 'script.js';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    downloadEditor() {
        this.downloadBlob(new Blob([this.codeEditor.getValue()], {type:'text/plain;charset=utf-8'}),
            document.getElementById('filename').value || 'script.js');
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
        if (connectBtn.disabled) return;
        try {
            connectBtn.textContent = 'Connecting...';
            connectBtn.disabled = true;
            await this.serialManager.connect();
            this.appendToTerminal('Connected to WebScreen!', 'log-success');
            await this.refreshFileList('/');
        } catch (error) {
            this.appendToTerminal(`Connection failed: ${SerialManager.connectionErrorMessage(error)}`, 'log-error');
        } finally {
            connectBtn.disabled = false;
            this.updateConnectionStatus(this.serialManager.isConnected);
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
            this.selectedFile = null;
            this.fileListData = [];
            this.renderFileList();
        }

        this.updateUI();
    }

    updateUI() {
        const connected = this.serialManager.isConnected;
        const busy = this.fileOperation || this.isCapturingScreenshot;
        for (const id of ['saveBtn', 'runBtn', 'runSaveBtn', 'evalBtn', 'screenshotBtn', 'refreshFiles', 'uploadBtn', 'sendBtn']) {
            document.getElementById(id).disabled = !connected || busy;
        }
        document.getElementById('parentDirectory').disabled = !connected || busy || this.currentPath === '/';
        document.getElementById('deleteFile').disabled = !connected || busy || !this.selectedFile;
        document.getElementById('downloadFile').disabled = !connected || busy || this.selectedFile?.type !== 'file';
        const terminalInput = document.getElementById('terminalInput');
        terminalInput.disabled = !connected || busy;
        terminalInput.placeholder = !connected ? 'Connect device to use terminal' : busy ? 'Device operation in progress…' : 'Type command or / for help';
        document.querySelectorAll('.cmd-btn').forEach(btn => { btn.disabled = !connected || busy; });
        document.getElementById('fileList').setAttribute('aria-busy', String(Boolean(this.fileOperation)));
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
        this.terminalQueue.push({text:String(text), className});
        if (this.terminalQueue.length > 1000) this.terminalQueue.splice(0, this.terminalQueue.length - 1000);
        if (!this.terminalTimer) this.terminalTimer = setTimeout(() => this.flushTerminal(), 32);
    }

    flushTerminal() {
        clearTimeout(this.terminalTimer);
        this.terminalTimer = null;
        const output = document.getElementById('terminalOutput');
        const follow = output.scrollHeight - output.scrollTop - output.clientHeight < 40;
        const fragment = document.createDocumentFragment();
        for (const {text, className} of this.terminalQueue.splice(0)) {
            const line = document.createElement('div');
            line.className = className;
            if (text.includes('\x1b')) this.renderAnsiInto(line, text);
            else line.textContent = text || '\u00a0';
            fragment.appendChild(line);
        }
        output.appendChild(fragment);
        while (output.children.length > 1000) output.firstChild.remove();
        if (follow) output.scrollTop = output.scrollHeight;
    }

    // ANSI sequences are rendered through text nodes, never HTML.

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
        if (!this.serialManager.isConnected || this.isCapturingScreenshot || this.fileOperation) return;

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
        this.screenshotFocus = document.activeElement;
        document.getElementById('screenshotOverlay').style.display = 'flex';
        document.getElementById('screenshotClose').focus();
    }

    hideScreenshotOverlay() {
        document.getElementById('screenshotOverlay').style.display = 'none';
        this.screenshotFocus?.focus();
        this.screenshotFocus = null;
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
        this.terminalQueue.length = 0;
        document.getElementById('terminalOutput').replaceChildren();
        this.appendToTerminal('Terminal cleared', 'log-info');
    }

    downloadLog() {
        this.flushTerminal();
        const logs = Array.from(document.getElementById('terminalOutput').children).map(line => line.textContent).join('\n');
        this.downloadBlob(new Blob([logs], {type:'text/plain'}), `webscreen-log-${Date.now()}.txt`);
    }

    async withDeviceOperation(label, operation) {
        if (!this.serialManager.isConnected || this.fileOperation || this.isCapturingScreenshot) return false;
        this.fileOperation = true;
        this.updateUI();
        this.updateFileStatus(`${label}…`);
        try { await operation(); return true; }
        catch (error) {
            this.updateFileStatus(`${label} failed — ${error.message}`);
            this.appendToTerminal(`${label} failed: ${error.message}`, 'log-error');
            return false;
        } finally {
            this.fileOperation = false;
            this.hideUploadProgress();
            this.updateUI();
        }
    }

    async saveFile(setDefault = null) {
        return this.withDeviceOperation(setDefault === null ? 'Save' : 'Run', async () => {
            const filename = document.getElementById('filename').value || 'script.js';
            const path = this.serialManager.path(filename, true);
            if (setDefault !== null && !/\.js$/i.test(path)) throw new Error('Only JavaScript (.js) files can run.');
            const content = this.codeEditor.getValue();
            const revision = this.revision;
            // Failed or interrupted uploads leave the local draft unsaved.
            this.dirty = true;
            await this.serialManager.uploadFile(path, content, (sent, total) => {
                this.updateFileStatus(`Saving… ${total ? Math.round(sent / total * 100) : 100}%`);
            });
            if (revision === this.revision) {
                this.currentFile = document.getElementById('filename').value = path;
                this.dirty = false;
            }
            this.persistDraft();
            this.updateFileStatus(this.dirty ? 'Saved earlier revision — current edits unsaved' : 'Saved to device');
            this.appendToTerminal(`File saved: ${path}`, 'log-success');
            if (setDefault !== null) {
                await this.serialManager.loadScript(path, setDefault);
                this.appendToTerminal(`Run requested: ${path}${setDefault ? ' (set as default)' : ''}`, 'log-success');
            }
            await this.readDirectory(this.currentPath);
        });
    }

    async runScript(setDefault = false) {
        return this.saveFile(setDefault);
    }

    async evalSelection() {
        if (!this.serialManager.isConnected) {
            this.appendToTerminal('Device not connected', 'log-error');
            return;
        }

        let code = this.codeEditor.getSelection();
        if (!code || !code.trim()) {
            code = this.codeEditor.getLine(this.codeEditor.getCursor().line) || '';
        }

        if (/[\r\n]/.test(code)) {
            this.appendToTerminal('Eval accepts one line. Use Run for multiline scripts; joining lines can change JavaScript behavior.', 'log-warning');
            return;
        }
        code = code.trim();

        if (!code) {
            this.appendToTerminal('Nothing to eval: selection and current line are empty', 'log-warning');
            return;
        }

        const bytes = new TextEncoder().encode(code).length;
        if (bytes > 255) {
            this.appendToTerminal(`Eval aborted: snippet is ${bytes} UTF-8 bytes (/eval max is 255)`, 'log-warning');
            return;
        }

        await this.executeCommand(`/eval ${code}`);
    }

    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.tab').forEach(tab => {
            const active = tab.dataset.tab === tabName;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
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

    async refreshFileList(path = this.currentPath) {
        return this.withDeviceOperation('List files', async () => {
            await this.readDirectory(path);
            this.updateFileStatus(this.dirty ? 'Modified' : 'Ready');
        });
    }

    async readDirectory(path) {
        const entries = await this.serialManager.listFiles(path);
        this.currentPath = path;
        this.fileListData = entries;
        this.selectedFile = null;
        this.renderFileList();
        this.updateUI();
    }

    renderFileList() {
        const list = document.getElementById('fileList');
        document.getElementById('currentPath').textContent = this.currentPath;
        list.replaceChildren();
        if (!this.fileListData.length) {
            const placeholder = document.createElement('p');
            placeholder.className = 'placeholder';
            placeholder.textContent = this.serialManager.isConnected ? 'This folder is empty' : 'Connect device to view files';
            list.appendChild(placeholder);
            return;
        }
        const sorted = [...this.fileListData].sort((a, b) =>
            (b.type === 'dir') - (a.type === 'dir') || a.name.localeCompare(b.name));
        const fragment = document.createDocumentFragment();
        for (const file of sorted) {
            const item = document.createElement('div');
            item.className = 'file-item';
            item.tabIndex = 0;
            item.setAttribute('role', 'button');
            item.setAttribute('aria-label', `${file.type === 'dir' ? 'Folder' : 'File'}: ${file.name}. Enter to open.`);
            const icon = document.createElement('i');
            icon.className = `fas ${file.type === 'dir' ? 'fa-folder folder' : this.getFileIcon(file.name)} file-icon`;
            icon.setAttribute('aria-hidden', 'true');
            const name = document.createElement('span');
            name.className = 'file-name';
            name.textContent = file.name;
            const size = document.createElement('span');
            size.className = 'file-size';
            size.textContent = file.type === 'file' ? this.formatBytes(file.size) : '';
            item.append(icon, name, size);
            const select = () => {
                if (this.fileOperation) return;
                list.querySelectorAll('.file-item').forEach(row => row.classList.remove('selected'));
                item.classList.add('selected');
                this.selectedFile = file;
                this.updateUI();
            };
            const open = () => {
                if (file.type === 'dir') this.refreshFileList(this.currentPath + file.name + '/');
                else this.loadFileIntoEditor(file.name);
            };
            item.addEventListener('click', select);
            item.addEventListener('dblclick', open);
            item.addEventListener('keydown', event => {
                if (event.key === 'Enter') { event.preventDefault(); select(); open(); }
                if (event.key === ' ') { event.preventDefault(); select(); }
            });
            fragment.appendChild(item);
        }
        list.appendChild(fragment);
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
        if (!/\.(js|json|txt|html?|css|xml|csv|md|svg|yaml|yml)$/i.test(filename)) {
            this.appendToTerminal('Select Download for binary files. The editor opens text files.', 'log-warning');
            return;
        }
        if (this.fileOperation || !this.serialManager.isConnected) return;
        if (this.dirty && !confirm('Replace the current unsaved draft? Use Download first to keep a copy.')) return;
        return this.withDeviceOperation('Open file', async () => {
            const path = this.currentPath + filename;
            const revision = this.revision;
            const content = await this.serialManager.readFile(path);
            if (revision !== this.revision) throw new Error('Editor changed while loading. Your edits were kept; open the file again when ready.');
            this.codeEditor.setValue(content);
            this.currentFile = document.getElementById('filename').value = path;
            this.updateEditorMode(path);
            this.dirty = false;
            this.persistDraft();
            this.updateFileStatus('Loaded from device');
            this.switchTab('editor');
            this.codeEditor.focus();
        });
    }

    async deleteSelectedFile() {
        if (this.fileOperation || !this.selectedFile || !this.serialManager.isConnected) return;
        const path = this.currentPath + this.selectedFile.name;
        if (!confirm(`Delete ${path} from the device?`)) return;
        return this.withDeviceOperation('Delete', async () => {
            await this.serialManager.deleteFile(path);
            this.appendToTerminal(`Deleted ${path}`, 'log-success');
            await this.readDirectory(this.currentPath);
        });
    }

    async downloadSelectedFile() {
        if (this.selectedFile?.type !== 'file') return;
        const path = this.currentPath + this.selectedFile.name;
        return this.withDeviceOperation('Download', async () => {
            const bytes = await this.serialManager.requestDownload(path);
            this.downloadBlob(new Blob([bytes], {type:'application/octet-stream'}), path);
            this.updateFileStatus('Downloaded');
        });
    }

    async uploadFiles(files) {
        const selected = Array.from(files);
        const folder = this.currentPath;
        return this.withDeviceOperation('Upload', async () => {
            for (const file of selected) {
                const path = this.serialManager.path(folder + file.name, true);
                this.showUploadProgress(file.name, 0, file.size);
                const content = await file.arrayBuffer();
                await this.serialManager.uploadFile(path, content, (sent, total) => this.updateUploadProgress(file.name, sent, total));
                this.appendToTerminal(`Uploaded ${path}`, 'log-success');
            }
            await this.readDirectory(folder);
            this.updateFileStatus('Upload complete');
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
        const urlTheme = new URLSearchParams(window.location.search).get('mode');
        let saved;
        try { saved = localStorage.getItem('webscreen-ide-theme'); } catch {}
        this.setTheme(urlTheme || saved || 'retro');
    }

    setTheme(theme) {
        theme = theme === 'focus' ? 'focus' : 'retro';
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
        try { localStorage.setItem('webscreen-ide-theme', theme); } catch {}
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