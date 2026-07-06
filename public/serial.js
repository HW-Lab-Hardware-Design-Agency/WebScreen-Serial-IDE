class SerialManager {
    constructor() {
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.isConnected = false;
        this.isReading = false;
        this.decoder = new TextDecoder();
        this.encoder = new TextEncoder();
        this.commandHistory = [];
        this.historyIndex = -1;
        this.onDataReceived = null;
        this.onConnectionChange = null;
        // Internal per-line listeners (Set of callbacks). A listener that
        // returns true "consumes" the line so it is not forwarded to
        // onDataReceived (used e.g. to keep screenshot base64 out of the console).
        this._lineListeners = new Set();
    }

    _dispatchLine(line) {
        let consumed = false;
        for (const listener of Array.from(this._lineListeners)) {
            try {
                if (listener(line) === true) consumed = true;
            } catch (e) {
                console.error('Line listener error:', e);
            }
        }
        if (!consumed && this.onDataReceived) {
            this.onDataReceived(line);
        }
    }

    async connect() {
        if (!navigator.serial) {
            throw new Error('Web Serial API not supported. Please use Chrome, Edge, or Opera.');
        }

        try {
            // Request port selection
            this.port = await navigator.serial.requestPort();
            
            // Open port with WebScreen settings
            // bufferSize is critical for Mac - without it, data reception can stop after ~1KB
            await this.port.open({
                baudRate: 115200,
                dataBits: 8,
                stopBits: 1,
                parity: 'none',
                flowControl: 'none',
                bufferSize: 16384  // 16KB buffer to prevent truncation issues on Mac
            });

            this.isConnected = true;
            this.startReading();
            
            if (this.onConnectionChange) {
                this.onConnectionChange(true);
            }

            // Send initial newline to get prompt
            await this.sendCommand('');
            
            return true;
        } catch (error) {
            console.error('Connection failed:', error);
            throw error;
        }
    }

    async disconnect() {
        try {
            this.isReading = false;
            
            if (this.reader) {
                await this.reader.cancel();
                await this.reader.releaseLock();
                this.reader = null;
            }

            if (this.writer) {
                await this.writer.releaseLock();
                this.writer = null;
            }

            if (this.port) {
                await this.port.close();
                this.port = null;
            }

            this.isConnected = false;
            
            if (this.onConnectionChange) {
                this.onConnectionChange(false);
            }
        } catch (error) {
            console.error('Disconnect failed:', error);
        }
    }

    async startReading() {
        if (!this.port || !this.isConnected) return;

        this.isReading = true;
        this.reader = this.port.readable.getReader();
        let buffer = '';

        try {
            while (this.isReading && this.isConnected) {
                const { value, done } = await this.reader.read();
                
                if (done) break;

                // Decode and add to buffer
                const text = this.decoder.decode(value, { stream: true });
                buffer += text;

                // Process complete lines
                let newlineIndex;
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.slice(0, newlineIndex).replace('\r', '');
                    buffer = buffer.slice(newlineIndex + 1);
                    
                    if (line.length > 0) {
                        this._dispatchLine(line);
                    }
                }

                // Process remaining buffer if it doesn't end with newline
                if (buffer.length > 0 && !buffer.includes('\n')) {
                    // Check if it looks like a partial line that should be displayed
                    if (buffer.trim()) {
                        this._dispatchLine(buffer);
                        buffer = '';
                    }
                }
            }
        } catch (error) {
            if (error.name !== 'NetworkError') {
                console.error('Reading failed:', error);
            }
        } finally {
            if (this.reader) {
                this.reader.releaseLock();
                this.reader = null;
            }
        }
    }

    async sendCommand(command) {
        if (!this.port || !this.isConnected) {
            throw new Error('Device not connected');
        }

        try {
            if (!this.writer) {
                this.writer = this.port.writable.getWriter();
            }

            const data = this.encoder.encode(command + '\n');
            await this.writer.write(data);
            
            // Add to history if it's not empty and not a duplicate
            if (command.trim() && (this.commandHistory.length === 0 || 
                this.commandHistory[this.commandHistory.length - 1] !== command)) {
                this.commandHistory.push(command);
                // Keep history limited to 50 commands
                if (this.commandHistory.length > 50) {
                    this.commandHistory.shift();
                }
            }
            
            this.historyIndex = this.commandHistory.length;
            return true;
        } catch (error) {
            console.error('Send failed:', error);
            throw error;
        }
    }

    async sendFile(filename, content) {
        if (!this.isConnected) {
            throw new Error('Device not connected');
        }

        try {
            // Send write command (for .js files, strips extension as device adds it)
            const filenameWithoutExt = filename.replace(/\.js$/, '');
            await this.sendCommand(`/write ${filenameWithoutExt}`);

            // Wait a bit for the device to be ready
            await new Promise(resolve => setTimeout(resolve, 500));

            // Send content line by line
            const lines = content.split('\n');
            for (const line of lines) {
                await this.sendCommand(line);
                // Small delay between lines
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            // Send END to finish, then wait for the firmware acknowledgement
            await this.sendCommand('END');

            const ack = await this.waitForUploadAck();
            if (!ack.ok) {
                throw new Error(ack.message || 'Upload failed');
            }

            return true;
        } catch (error) {
            console.error('File send failed:', error);
            throw error;
        }
    }

    // Waits for the firmware upload result line after END has been sent:
    //   success: "[OK] File saved: <name> (<size>)" or "Script saved: ..."
    //   failure: "[ERROR] Upload failed: <reason>" or "Upload aborted"
    // Old firmware prints nothing, so the timeout resolves as success.
    waitForUploadAck(timeoutMs = 8000) {
        return new Promise((resolve) => {
            const cleanup = () => {
                clearTimeout(timer);
                this._lineListeners.delete(listener);
            };
            const listener = (line) => {
                if (line.includes('File saved:') || line.includes('Script saved:')) {
                    cleanup();
                    resolve({ ok: true, message: line });
                } else if (line.includes('Upload failed') || line.includes('Upload aborted')) {
                    cleanup();
                    resolve({ ok: false, message: line.replace(/^\[ERROR\]\s*/, '').trim() });
                }
                return false; // never consume: keep the result visible in the console
            };
            const timer = setTimeout(() => {
                cleanup();
                // No ack within the timeout: assume old firmware without upload ACK
                resolve({ ok: true, message: '' });
            }, timeoutMs);
            this._lineListeners.add(listener);
        });
    }

    async uploadFile(filename, content, onProgress = null) {
        if (!this.isConnected) {
            throw new Error('Device not connected');
        }

        // Determine if this is a text file or binary file
        const textExtensions = ['.js', '.json', '.txt', '.html', '.css', '.xml', '.csv', '.md'];
        const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
        const isTextFile = textExtensions.includes(ext);

        let totalSize = 0;
        let sentSize = 0;

        try {
            if (isTextFile) {
                // Text mode
                totalSize = content.length;
                await this.sendCommand(`/upload ${filename}`);
                await new Promise(resolve => setTimeout(resolve, 200));

                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    await this.sendCommand(lines[i]);
                    sentSize += lines[i].length + 1;
                    if (onProgress) onProgress(sentSize, totalSize);
                    await new Promise(resolve => setTimeout(resolve, 30));
                }
            } else {
                // Binary mode - base64
                totalSize = typeof content === 'string' ? content.length : content.byteLength;
                await this.sendCommand(`/upload ${filename} base64`);
                await new Promise(resolve => setTimeout(resolve, 200));

                let base64Content;
                if (typeof content === 'string') {
                    base64Content = btoa(unescape(encodeURIComponent(content)));
                } else {
                    base64Content = this.arrayBufferToBase64(content);
                }

                const chunkSize = 76;
                for (let i = 0; i < base64Content.length; i += chunkSize) {
                    const chunk = base64Content.substring(i, i + chunkSize);
                    await this.sendCommand(chunk);
                    sentSize = Math.min(Math.floor((i + chunkSize) * 3 / 4), totalSize);
                    if (onProgress) onProgress(sentSize, totalSize);
                    await new Promise(resolve => setTimeout(resolve, 20));
                }
            }

            await this.sendCommand('END');
            if (onProgress) onProgress(totalSize, totalSize);

            // Wait for the firmware upload acknowledgement instead of a fixed delay
            const ack = await this.waitForUploadAck();
            if (!ack.ok) {
                throw new Error(ack.message || 'Upload failed');
            }
            return true;
        } catch (error) {
            console.error('Upload failed:', error);
            throw error;
        }
    }

    // Captures a screenshot via /screenshot. The firmware replies with:
    //   === SCREENSHOT <w>x<h> RGB565[_SWAP] ===
    //   <base64 lines, 76 chars each>
    //   === SCREENSHOT END ===
    // Resolves { width, height, format, swap, bytes } (bytes = raw RGB565 data).
    // Base64 payload lines are consumed so they don't flood the console.
    captureScreenshot(timeoutMs = 30000) {
        if (!this.isConnected) {
            return Promise.reject(new Error('Device not connected'));
        }

        return new Promise((resolve, reject) => {
            let header = null;
            const b64Lines = [];
            const headerRe = /^===\s*SCREENSHOT\s+(\d+)x(\d+)\s+(\S+)\s*===$/;

            const cleanup = () => {
                clearTimeout(timer);
                this._lineListeners.delete(listener);
            };

            const listener = (line) => {
                const trimmed = line.trim();

                if (!header) {
                    const m = trimmed.match(headerRe);
                    if (m) {
                        header = {
                            width: parseInt(m[1], 10),
                            height: parseInt(m[2], 10),
                            format: m[3],
                            swap: m[3].endsWith('_SWAP')
                        };
                        return true; // consume header line
                    }
                    if (trimmed.startsWith('[ERROR]')) {
                        cleanup();
                        reject(new Error(trimmed.replace(/^\[ERROR\]\s*/, '')));
                        return false;
                    }
                    if (/^Unknown command:?\s*\/?(screenshot|ss)\b/i.test(trimmed)) {
                        cleanup();
                        reject(new Error('This firmware does not support /screenshot'));
                        return false;
                    }
                    return false; // let "Queued. Data follows..." etc. through
                }

                // Inside the data block
                if (trimmed.startsWith('===')) {
                    // === SCREENSHOT END === (tolerate partial-line splits)
                    cleanup();
                    try {
                        const bytes = this.base64ToUint8Array(b64Lines.join(''));
                        resolve({ ...header, bytes });
                    } catch (e) {
                        reject(new Error('Failed to decode screenshot data'));
                    }
                    return true;
                }
                if (trimmed.startsWith('[ERROR]')) {
                    cleanup();
                    reject(new Error(trimmed.replace(/^\[ERROR\]\s*/, '')));
                    return true;
                }
                if (/^[A-Za-z0-9+/=]+$/.test(trimmed)) {
                    b64Lines.push(trimmed);
                    return true; // consume base64 payload (keep console clean)
                }
                return false; // unrelated output (e.g. app prints) passes through
            };

            const timer = setTimeout(() => {
                cleanup();
                reject(new Error('Screenshot timed out'));
            }, timeoutMs);

            this._lineListeners.add(listener);

            this.sendCommand('/screenshot').catch((error) => {
                cleanup();
                reject(error);
            });
        });
    }

    base64ToUint8Array(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    // Parse file listing from device output
    parseFileListing(lines) {
        const files = [];
        for (const line of lines) {
            // Pattern: DIR                dirname or FILE    size     filename
            let match = line.match(/^(DIR|FILE)\s+(?:(\d+(?:\.\d+)?)\s*([BKBMBGB]+)\s+)?(.+)$/i);
            if (match) {
                const type = match[1].toLowerCase() === 'dir' ? 'dir' : 'file';
                const sizeNum = match[2] ? parseFloat(match[2]) : 0;
                const sizeUnit = match[3] ? match[3].toUpperCase() : 'B';
                const name = match[4].trim();

                let sizeBytes = sizeNum;
                if (sizeUnit === 'KB' || sizeUnit === 'K') sizeBytes = sizeNum * 1024;
                else if (sizeUnit === 'MB' || sizeUnit === 'M') sizeBytes = sizeNum * 1024 * 1024;
                else if (sizeUnit === 'GB' || sizeUnit === 'G') sizeBytes = sizeNum * 1024 * 1024 * 1024;

                if (name && name.length > 0) {
                    files.push({ type, name, size: Math.round(sizeBytes) });
                }
                continue;
            }

            // Pattern: [FILE] filename (size bytes) or [DIR] dirname
            match = line.match(/\[(FILE|DIR)\]\s+(.+?)(?:\s+\((\d+)\s*bytes?\))?$/i);
            if (match) {
                const name = match[2].trim();
                if (name && !name.includes('listing') && !name.includes('===')) {
                    files.push({
                        type: match[1].toLowerCase(),
                        name: name,
                        size: match[3] ? parseInt(match[3]) : 0
                    });
                }
            }
        }
        return files;
    }

    getPreviousCommand() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            return this.commandHistory[this.historyIndex] || '';
        }
        return '';
    }

    getNextCommand() {
        if (this.historyIndex < this.commandHistory.length - 1) {
            this.historyIndex++;
            return this.commandHistory[this.historyIndex] || '';
        } else if (this.historyIndex < this.commandHistory.length) {
            this.historyIndex = this.commandHistory.length;
            return '';
        }
        return '';
    }

    getDeviceInfo() {
        if (!this.port) return null;
        
        const portInfo = this.port.getInfo();
        return {
            vendorId: portInfo.usbVendorId,
            productId: portInfo.usbProductId,
            connected: this.isConnected,
            baudRate: 115200
        };
    }

    // WebScreen specific commands
    async getStats() {
        await this.sendCommand('/stats');
    }

    async getInfo() {
        await this.sendCommand('/info');
    }

    async listFiles(path = '/') {
        await this.sendCommand(`/ls ${path}`);
    }

    async deleteFile(filename) {
        await this.sendCommand(`/rm ${filename}`);
    }

    async makeDirectory(path) {
        await this.sendCommand(`/mkdir ${path}`);
    }

    // Binary-safe device-to-host file download (/download <file>);
    // the reply is a base64 block framed by === DOWNLOAD ... === / === DOWNLOAD END ===
    async requestDownload(filename) {
        await this.sendCommand(`/download ${filename}`);
    }

    async factoryReset() {
        await this.sendCommand('/factory_reset confirm');
    }

    async downloadFile(url, filename) {
        if (filename) {
            await this.sendCommand(`/wget ${url} ${filename}`);
        } else {
            await this.sendCommand(`/wget ${url}`);
        }
    }

    async pingHost(host) {
        await this.sendCommand(`/ping ${host}`);
    }

    async backup(action, name = '') {
        if (name) {
            await this.sendCommand(`/backup ${action} ${name}`);
        } else {
            await this.sendCommand(`/backup ${action}`);
        }
    }

    async monitor(type = 'mem') {
        await this.sendCommand(`/monitor ${type}`);
    }

    async loadScript(filename, setDefault = false) {
        // "save" persists the choice to webscreen.json so it runs on boot
        await this.sendCommand(setDefault ? `/load ${filename} save` : `/load ${filename}`);
    }

    async reboot() {
        await this.sendCommand('/reboot');
    }

    async getConfig(key) {
        await this.sendCommand(`/config get ${key}`);
    }

    async setConfig(key, value) {
        // Wrap value in quotes to handle special characters like #$%&
        // Escape any existing quotes in the value
        const escapedValue = String(value).replace(/"/g, '\\"');
        await this.sendCommand(`/config set ${key} "${escapedValue}"`);
    }

    async catFile(filename) {
        await this.sendCommand(`/cat ${filename}`);
    }
}

// Export for use in other modules
window.SerialManager = SerialManager;