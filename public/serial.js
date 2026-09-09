class SerialManager {
    constructor() {
        this.port = this.reader = this.writer = this.readTask = null;
        this.isConnected = false;
        this.isReading = false;
        this.session = 0;
        this.operationQueue = Promise.resolve();
        this.pendingRequests = new Set();
        this._lineListeners = new Set();
        this.commandHistory = [];
        this.historyIndex = 0;
        this.onDataReceived = this.onConnectionChange = null;
        for (const name of ['uploadFile', 'readFile', 'listFiles', 'requestDownload', 'captureScreenshot', 'deleteFile', 'makeDirectory']) {
            const operation = this[name].bind(this);
            this[name] = (...args) => this.runOperation(() => operation(...args));
        }
    }

    static connectionErrorMessage(error) {
        if (error.name === 'NotFoundError') return 'No port selected. Choose your WebScreen to connect.';
        if (error.name === 'NetworkError' || /Failed to open serial port/i.test(error.message)) {
            return 'Could not open the serial port. Close Arduino Serial Monitor/Plotter and other Admin or IDE tabs using the device, then retry.';
        }
        return error.message || 'Could not connect to the device.';
    }

    _dispatchLine(line) {
        let consumed = false;
        for (const listener of Array.from(this._lineListeners)) {
            try { if (listener(line) === true) consumed = true; }
            catch (error) { console.error('Serial listener failed:', error.message); }
        }
        if (!consumed && this.onDataReceived) {
            try { this.onDataReceived(line); } catch (error) { console.error(error.message); }
        }
    }

    async connect() {
        if (this.disconnecting) await this.disconnecting;
        if (this.isConnected) return true;
        if (this.connecting) return this.connecting;
        if (!navigator.serial) throw new Error('USB connections need Chrome or Edge on desktop. The editor works without a device.');
        this.connecting = (async () => {
            try {
                const port = await navigator.serial.requestPort();
                this.port = port;
                await port.open({baudRate:115200, dataBits:8, stopBits:1, parity:'none', flowControl:'none', bufferSize:16384});
                this.writer = port.writable.getWriter();
                this.session++;
                this.isConnected = true;
                this.readTask = this.startReading(port, this.session);
                this.onConnectionChange?.(true);
                await this.sendCommand('');
                return true;
            } catch (error) {
                await this.disconnect();
                throw error;
            }
        })();
        try { return await this.connecting; }
        finally { this.connecting = null; }
    }

    async disconnect() {
        if (this.disconnecting) return this.disconnecting;
        this.disconnecting = (async () => {
            const connected = this.isConnected;
            this.isConnected = this.isReading = false;
            this.session++;
            for (const reject of this.pendingRequests) reject(new Error('Device disconnected.'));
            this.pendingRequests.clear();
            this._lineListeners.clear();
            try { await this.reader?.cancel(); } catch {}
            try { await this.readTask; } catch {}
            try { await this.writer?.abort(); } catch {}
            try { this.writer?.releaseLock(); } catch {}
            try { await this.port?.close(); } catch {}
            this.port = this.reader = this.writer = this.readTask = null;
            if (connected) this.onConnectionChange?.(false);
        })();
        try { await this.disconnecting; }
        finally { this.disconnecting = null; }
    }

    async startReading(port, session) {
        const reader = port.readable.getReader();
        this.reader = reader;
        this.isReading = true;
        const decoder = new TextDecoder();
        let buffer = '';
        try {
            while (this.isConnected && session === this.session) {
                const {value, done} = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, {stream:true});
                const lines = buffer.split('\n');
                buffer = lines.pop();
                if (buffer.length > 1024 * 1024 || lines.some(line => line.length > 1024 * 1024)) throw new Error('Serial line exceeds the receive limit.');
                for (const line of lines) this._dispatchLine(line.replace(/\r$/, ''));
            }
        } catch (error) {
            if (this.isConnected) this.onDataReceived?.(`Serial read failed: ${error.message}`);
        } finally {
            reader.releaseLock();
            if (this.reader === reader) this.reader = null;
            if (this.isConnected && session === this.session) queueMicrotask(() => this.disconnect());
        }
    }

    runOperation(operation) {
        const session = this.session;
        const run = async () => {
            if (!this.isConnected || session !== this.session) throw new Error('Device disconnected. Reconnect and retry.');
            this.operationSession = session;
            const result = await operation();
            if (session !== this.session) throw new Error('Device disconnected before the operation finished.');
            return result;
        };
        const result = this.operationQueue.then(run);
        this.operationQueue = result.catch(() => {});
        return result;
    }

    async _sendLine(command) {
        if (!this.isConnected || !this.writer || this.operationSession !== this.session) throw new Error('Device not connected');
        if (/[\r\n]/.test(command)) throw new Error('A serial command must fit on one line.');
        const bytes = new TextEncoder().encode(command + '\n');
        if (bytes.length > 1024) throw new Error('Command exceeds the firmware line limit (1023 UTF-8 bytes).');
        for (let offset = 0; offset < bytes.length; offset += 128) {
            if (!this.isConnected || this.operationSession !== this.session) throw new Error('Device disconnected during transfer.');
            try { await this.writer.write(bytes.subarray(offset, offset + 128)); }
            catch (error) {
                await this.disconnect();
                throw new Error(`Serial write failed: ${error.message}`);
            }
            if (offset + 128 < bytes.length) await new Promise(resolve => setTimeout(resolve, 10));
        }
    }

    sendCommand(command) {
        return this.runOperation(async () => {
            await this._sendLine(command);
            if (command.trim() && this.commandHistory[this.commandHistory.length - 1] !== command) {
                this.commandHistory.push(command);
                if (this.commandHistory.length > 50) this.commandHistory.shift();
            }
            this.historyIndex = this.commandHistory.length;
            return true;
        });
    }

    request(command, parse, timeoutMs = 5000, consume = false) {
        return new Promise((resolve, reject) => {
            let timer;
            let settled = false;
            const finish = (error, value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this._lineListeners.delete(listener);
                this.pendingRequests.delete(cancel);
                error ? reject(error) : resolve(value);
            };
            const cancel = error => finish(error);
            const listener = raw => {
                try {
                    const line = raw.split('\r').pop().trim().replace(/^(?:WebScreen>\s*)+/, '');
                    const result = parse(line, raw);
                    if (result?.done) finish(null, result.value);
                    else if (result?.progress) resetTimeout();
                } catch (error) { finish(error); }
                return consume;
            };
            this._lineListeners.add(listener);
            this.pendingRequests.add(cancel);
            const resetTimeout = () => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    finish(new Error('The device did not finish its response. Reconnect and retry.'));
                    // Do not send new commands into an unfinished firmware transfer.
                    this.disconnect();
                }, timeoutMs);
            };
            resetTimeout();
            this._sendLine(command).catch(error => finish(error));
        });
    }

    path(value, token = false) {
        if (typeof value !== 'string' || !value || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Enter a valid device path.');
        const path = value.startsWith('/') ? value : '/' + value;
        if (path.split('/').some(part => part === '.' || part === '..')) throw new Error('Use an absolute device path without . or .. segments.');
        if (token && /\s/.test(path)) throw new Error('This firmware command requires a filename without spaces.');
        return path;
    }

    sendFile(filename, content) { return this.uploadFile(filename, content); }

    async uploadFile(filename, content, onProgress = null) {
        const path = this.path(filename, true);
        const bytes = typeof content === 'string' ? new TextEncoder().encode(content) :
            ArrayBuffer.isView(content) ? new Uint8Array(content.buffer, content.byteOffset, content.byteLength) : new Uint8Array(content);
        let failure = null;
        let drainingAbort = false;
        const errors = raw => {
            const line = raw.split('\r').pop().trim().replace(/^(?:WebScreen>\s*)+/, '');
            if (line.startsWith('[ERROR]')) {
                failure = new Error(line.slice(7).trim());
                if (line.startsWith('[ERROR] Upload aborted:')) drainingAbort = true;
            }
            return false;
        };
        this._lineListeners.add(errors);
        try {
            await this.request(`/upload ${path} base64`, line => {
                if (line.includes('Unknown command')) throw new Error('File uploads require firmware with /upload support (2.0 or newer).');
                if (failure) throw failure;
                if (line === '---') return {done:true};
            });
            // The firmware prints its ready marker just before opening the SD file.
            await new Promise(resolve => setTimeout(resolve, 200));
            onProgress?.(0, bytes.length);
            for (let offset = 0; offset < bytes.length; offset += 144) {
                if (failure) break;
                const block = bytes.subarray(offset, offset + 144);
                await this._sendLine(btoa(String.fromCharCode(...block)));
                onProgress?.(Math.min(offset + block.length, bytes.length), bytes.length);
                await new Promise(resolve => setTimeout(resolve, 5));
            }
            if (failure && !drainingAbort) throw failure;
            // The firmware drains an aborted upload until END; finish that exchange too.
            // Install the response listener before END: USB replies can arrive immediately.
            await this.request('END', line => {
                if (line.startsWith('[ERROR] Upload failed:')) throw failure || new Error(line);
                if (line.startsWith(`[OK] File saved: ${path} (`)) {
                    if (failure) throw failure;
                    return {done:true};
                }
                if (failure && !drainingAbort) throw failure;
            }, 8000);
            return true;
        } finally { this._lineListeners.delete(errors); }
    }

    async readFile(filename) {
        const bytes = await this._downloadFile(filename, 2 * 1024 * 1024);
        try { return new TextDecoder('utf-8', {fatal:true}).decode(bytes); }
        catch { throw new Error('This file is not UTF-8 text. Use Download to keep its original bytes.'); }
    }

    async listFiles(path = '/') {
        path = this.path(path);
        const entries = await this.request(`/ls ${path} json`, line => {
            if (line.startsWith('{"path":')) {
                const data = JSON.parse(line);
                if (data.path !== path || !Array.isArray(data.entries)) throw new Error('Invalid directory response.');
                for (const entry of data.entries) {
                    if (typeof entry.name !== 'string' || !entry.name || /[\/\u0000-\u001f\u007f]/.test(entry.name) || ['.', '..'].includes(entry.name) ||
                        typeof entry.dir !== 'boolean' || !Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error('Invalid directory entry.');
                }
                return {done:true, value:data.entries.map(entry => ({name:entry.name, type:entry.dir ? 'dir' : 'file', size:entry.size}))};
            }
            if (line.startsWith('[ERROR]') || line.includes('Unknown command')) return {done:true, value:null};
        }, 10000, true);
        if (entries !== null) return entries;
        const lines = [];
        return this.request(`/ls ${path}`, line => {
            if (line.startsWith('[ERROR]')) throw new Error(line.slice(7).trim());
            if (/Total:.*files|^\d+ files?, \d+ director/i.test(line)) return {done:true, value:this.parseFileListing(lines)};
            lines.push(line);
        }, 5000, true);
    }

    async requestDownload(filename) {
        return this._downloadFile(filename, 32 * 1024 * 1024);
    }

    async _downloadFile(filename, limit) {
        const path = this.path(filename);
        let bytes = null;
        let received = 0;
        let header = false;
        let padded = false;
        let failure = null;
        return this.request(`/download ${path}`, line => {
            if (line.startsWith('[ERROR]')) throw new Error(line.slice(7).trim());
            if (line.includes('Unknown command')) throw new Error('Reading files requires firmware with /download support (2.2 or newer).');
            const match = line.match(/^=== DOWNLOAD (.+) SIZE (\d+) ===$/);
            if (match) {
                if (header || match[1] !== path) failure = new Error('Unexpected download header.');
                header = true;
                const size = Number(match[2]);
                if (!Number.isSafeInteger(size) || size > limit) failure = new Error(`File exceeds the ${limit / 1024 / 1024} MB limit for this operation.`);
                if (!failure) bytes = new Uint8Array(size);
                return {progress:true};
            }
            if (line === '=== DOWNLOAD END ===') {
                if (failure) throw failure;
                if (!bytes || received !== bytes.length) throw new Error('Download was incomplete.');
                return {done:true, value:bytes};
            }
            if (!header || !/^[A-Za-z0-9+/=]+$/.test(line)) return;
            // Even an invalid response must drain before the next command can run.
            if (!failure) {
                try {
                    if (padded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(line)) throw new Error('Invalid download base64 data.');
                    const chunk = atob(line);
                    if (received + chunk.length > bytes.length) throw new Error('Download size did not match the file.');
                    for (let i = 0; i < chunk.length; i++) bytes[received++] = chunk.charCodeAt(i);
                    padded = line.endsWith('=');
                } catch (error) { failure = error; }
            }
            return {progress:true};
        }, 30000, true);
    }

    async deleteFile(filename) {
        const path = this.path(filename);
        return this.request(`/rm ${path}`, line => {
            if (line.startsWith('[ERROR]')) throw new Error(line.slice(7).trim());
            if ([`[OK] File deleted: ${path}`, `[OK] Directory removed: ${path}`].includes(line)) return {done:true, value:true};
        });
    }

    async makeDirectory(path) {
        path = this.path(path);
        return this.request(`/mkdir ${path}`, line => {
            if (line.startsWith('[ERROR]')) throw new Error(line.slice(7).trim());
            if (line === `[OK] Directory created: ${path}`) return {done:true, value:true};
        });
    }

    async captureScreenshot(timeoutMs = 30000) {
        let header = null;
        let bytes = null;
        let received = 0;
        let streamError = null;
        let padded = false;
        return this.request('/screenshot', line => {
            // The capture runs asynchronously, after the console's non-newline prompt.
            const response = line.replace(/^(?:WebScreen>\s*)+/, '');
            if (response.includes('Unknown command')) throw new Error('Firmware does not support /screenshot — please update');
            if (response.startsWith('[ERROR]')) throw new Error(response.slice(7).trim());
            const match = response.match(/^=== SCREENSHOT (\d+)x(\d+) (\S+) ===$/);
            if (match) {
                if (header) { streamError = new Error('Duplicate screenshot header.'); return; }
                header = {width:Number(match[1]), height:Number(match[2]), format:match[3], swap:match[3] === 'RGB565_SWAP'};
                const size = header.width * header.height * 2;
                if (!header.width || !header.height) streamError = new Error('Invalid screenshot dimensions.');
                else if (!Number.isSafeInteger(size) || size > 16 * 1024 * 1024) streamError = new Error('Screenshot exceeds the 16 MB capture limit.');
                else if (!['RGB565', 'RGB565_SWAP'].includes(match[3])) streamError = new Error('Unsupported screenshot pixel format.');
                else bytes = new Uint8Array(size);
                return;
            }
            if (response === '=== SCREENSHOT END ===') {
                if (!header) throw new Error('Screenshot header was not received.');
                if (streamError) throw streamError;
                if (received !== bytes.length) throw new Error(`Screenshot incomplete: received ${received} of ${bytes.length} bytes.`);
                return {done:true, value:{...header, bytes}};
            }
            // Retain the serial operation until END, even if a payload chunk is invalid.
            if (!header || streamError || !/^[A-Za-z0-9+/=]+$/.test(response)) return;
            try {
                if (padded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(response)) {
                    throw new Error('Invalid screenshot base64 data.');
                }
                const chunk = atob(response);
                if (received + chunk.length > bytes.length) throw new Error('Screenshot data size exceeds its dimensions.');
                for (let i = 0; i < chunk.length; i++) bytes[received++] = chunk.charCodeAt(i);
                padded = response.endsWith('=');
            } catch (error) {
                streamError = error;
            }
            return {progress:true};
        }, timeoutMs, true);
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
        filename = this.path(filename, true);
        await this.sendCommand(setDefault ? `/load ${filename} save` : `/load ${filename}`);
    }

    async reboot() {
        await this.sendCommand('/reboot');
    }

    async getConfig(key) {
        await this.sendCommand(`/config get ${key}`);
    }

    async setConfig(key, value) {
        if (!/^[a-zA-Z0-9_.-]+$/.test(key)) throw new Error('Invalid configuration key.');
        await this.sendCommand(`/config set ${key} ${value}`);
    }

    async catFile(filename) {
        await this.sendCommand(`/cat ${filename}`);
    }
}

// Export for use in other modules
window.SerialManager = SerialManager;