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
    }

    async connect() {
        if (!navigator.serial) {
            throw new Error('Web Serial API not supported. Please use Chrome, Edge, or Opera.');
        }

        try {
            // Request port selection
            this.port = await navigator.serial.requestPort();
            
            // Open port with WebScreen settings
            await this.port.open({ 
                baudRate: 115200,
                dataBits: 8,
                stopBits: 1,
                parity: 'none',
                flowControl: 'none'
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
                    
                    if (line.length > 0 && this.onDataReceived) {
                        this.onDataReceived(line);
                    }
                }

                // Process remaining buffer if it doesn't end with newline
                if (buffer.length > 0 && !buffer.includes('\n')) {
                    // Check if it looks like a partial line that should be displayed
                    if (buffer.trim() && this.onDataReceived) {
                        this.onDataReceived(buffer);
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
            // Send write command
            await this.sendCommand(`/write ${filename}`);
            
            // Wait a bit for the device to be ready
            await new Promise(resolve => setTimeout(resolve, 500));

            // Send content line by line
            const lines = content.split('\n');
            for (const line of lines) {
                await this.sendCommand(line);
                // Small delay between lines
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            // Send END to finish
            await this.sendCommand('END');
            
            return true;
        } catch (error) {
            console.error('File send failed:', error);
            throw error;
        }
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

    async loadScript(filename) {
        await this.sendCommand(`/load ${filename}`);
    }

    async reboot() {
        await this.sendCommand('/reboot');
    }

    async getConfig(key) {
        await this.sendCommand(`/config get ${key}`);
    }

    async setConfig(key, value) {
        await this.sendCommand(`/config set ${key} ${value}`);
    }

    async catFile(filename) {
        await this.sendCommand(`/cat ${filename}`);
    }
}

// Export for use in other modules
window.SerialManager = SerialManager;