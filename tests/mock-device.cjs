/* Firmware protocol fixture shared by Node and browser regression tests. */
class MockDevice {
    constructor() {
        this.files = new Map([
            ['/apps/hello.js', new TextEncoder().encode('// test\r\n\nprint("世界");  \r\n')],
            ['/empty.js', new Uint8Array()],
            ['/picture.bin', new Uint8Array([0, 255, 10, 13, 128])]
        ]);
        this.commands = [];
        this.upload = null;
        this.fragmentSize = 7;
        this.failSave = false;
        this.omitAck = false;
    }
    async open() {
        this.readable = new ReadableStream({start: controller => { this.input = controller; }});
        this.lineBuffer = '';
        const decoder = new TextDecoder();
        this.writable = new WritableStream({write: async chunk => {
            this.lineBuffer += decoder.decode(chunk, {stream:true});
            while (this.lineBuffer.includes('\n')) {
                const end = this.lineBuffer.indexOf('\n');
                const line = this.lineBuffer.slice(0, end);
                this.lineBuffer = this.lineBuffer.slice(end + 1);
                await this.command(line);
            }
        }});
    }
    async close() { this.closed = true; }
    getInfo() { return {usbVendorId:1234, usbProductId:5678}; }
    emit(text) {
        const bytes = new TextEncoder().encode(text);
        for (let i = 0; i < bytes.length; i += this.fragmentSize) this.input.enqueue(bytes.slice(i, i + this.fragmentSize));
    }
    async command(line) {
        this.commands.push(line);
        if (this.upload) {
            if (line === 'END') {
                const {path, chunks} = this.upload;
                this.upload = null;
                if (this.omitAck) return;
                if (this.failSave) return this.emit('[ERROR] Upload failed: SD write failed\nWebScreen> ');
                const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
                let offset = 0;
                for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
                this.files.set(path, bytes);
                this.emit(`[OK] File saved: ${path} (${bytes.length} B)\nWebScreen> `);
            } else {
                this.upload.chunks.push(Uint8Array.from(atob(line), c => c.charCodeAt(0)));
            }
            return;
        }
        if (line.startsWith('/upload ')) {
            this.upload = {path:line.split(' ')[1], chunks:[]};
            return this.emit('Upload mode: base64\n---\n');
        }
        if (line.startsWith('/download ')) {
            const path = line.slice(10);
            const bytes = this.files.get(path);
            if (!bytes) return this.emit('[ERROR] Cannot open file\nWebScreen> ');
            this.emit(`=== DOWNLOAD ${path} SIZE ${bytes.length} ===\n`);
            for (let i = 0; i < bytes.length; i += 57) this.emit(btoa(String.fromCharCode(...bytes.slice(i, i + 57))) + '\n');
            return this.emit('=== DOWNLOAD END ===\nWebScreen> ');
        }
        if (line.startsWith('/ls ')) {
            const path = line.slice(4, -5);
            const entries = path === '/' ? [{name:'apps', dir:true, size:0}, ...Array.from(this.files, ([name, bytes]) => ({name:name.slice(1), dir:false, size:bytes.length})).filter(entry => !entry.name.includes('/'))] :
                Array.from(this.files, ([name, bytes]) => ({name:name.slice(path.length), dir:false, size:bytes.length})).filter(entry => entry.name && !entry.name.includes('/'));
            return this.emit(JSON.stringify({path, entries}) + '\nWebScreen> ');
        }
        if (line.startsWith('/rm ')) {
            const path = line.slice(4);
            if (!this.files.delete(path)) return this.emit('[ERROR] Delete failed\nWebScreen> ');
            return this.emit(`[OK] File deleted: ${path}\nWebScreen> `);
        }
        if (line === '/screenshot') return this.emit('=== SCREENSHOT 2x1 RGB565_SWAP ===\n+AAH4A==\n=== SCREENSHOT END ===\nWebScreen> ');
        this.emit(line ? '[OK] Command accepted\nWebScreen> ' : '\nWebScreen> ');
    }
}
if (typeof module !== 'undefined') module.exports = MockDevice;
else globalThis.MockDevice = MockDevice;
