const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const MockDevice = require('./mock-device.cjs');
const source = fs.readFileSync(path.join(__dirname, '../public/serial.js'), 'utf8');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function setup(t, device = new MockDevice()) {
    const context = vm.createContext({window:{}, navigator:{serial:{requestPort:async () => device}},
        TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, atob, btoa, console, queueMicrotask,
        setTimeout:(callback, ms) => setTimeout(callback, [5,10,200].includes(ms) ? 0 : ms), clearTimeout});
    vm.runInContext(source, context);
    const manager = new context.window.SerialManager();
    t.after(() => manager.disconnect());
    await manager.connect();
    return {manager, device};
}
test('fragmented UTF-8, blank lines and prompts survive USB packet boundaries', async t => {
    const {manager, device} = await setup(t);
    const lines = [];
    manager.onDataReceived = line => lines.push(line);
    device.fragmentSize = 1;
    device.emit('partial');
    await pause(10);
    assert.equal(lines.length, 0);
    device.emit(' 世界\r\n\n  indentation  \n');
    await pause(10);
    assert.deepEqual(lines, ['WebScreen> partial 世界', '', '  indentation  ']);
});
test('base64 uploads preserve UTF-8, long lines, blank lines and literal END; ACK can arrive immediately', async t => {
    const {manager, device} = await setup(t);
    const text = '\nEND\n' + '世界'.repeat(400) + '\r\n  tail  \n';
    const progress = [];
    await manager.uploadFile('/apps/test.js', text, (sent, total) => progress.push([sent,total]));
    assert.equal(new TextDecoder().decode(device.files.get('/apps/test.js')), text);
    assert.deepEqual(progress.at(-1), [new TextEncoder().encode(text).length, new TextEncoder().encode(text).length]);
    assert.equal(manager.commandHistory.length, 0);
});
test('empty files and typed-array slices upload without losing byte boundaries', async t => {
    const {manager, device} = await setup(t);
    await manager.uploadFile('/zero.js', '');
    assert.equal(device.files.get('/zero.js').length, 0);
    const bytes = new Uint8Array([9,0,128,255,9]);
    await manager.uploadFile('/slice.bin', bytes.subarray(1,4));
    assert.deepEqual(device.files.get('/slice.bin'), new Uint8Array([0,128,255]));
});
test('an SD write failure rejects save instead of reporting success', async t => {
    const {manager, device} = await setup(t);
    device.failSave = true;
    await assert.rejects(manager.uploadFile('/failed.js','test'), /SD write failed/);
    assert.ok(!device.commands.some(line => line.startsWith('/load ')));
    assert.equal(manager.pendingRequests.size, 0);
});
test('missing ACK disconnects and rejects queued operations', async t => {
    const {manager, device} = await setup(t);
    device.omitAck = true;
    const request = manager.request.bind(manager);
    manager.request = (command, parse, timeout, consume) => request(command, parse, command === 'END' ? 20 : timeout, consume);
    const upload = manager.uploadFile('/lost.js','text');
    const next = manager.sendCommand('/info');
    const results = await Promise.allSettled([upload, next]);
    assert.equal(results[0].status, 'rejected');
    assert.match(results[0].reason.message, /did not finish/);
    assert.equal(results[1].status, 'rejected');
    assert.equal(manager.isConnected, false);
    assert.ok(!device.commands.includes('/info'));
});
test('commands wait until the upload is acknowledged', async t => {
    const {manager, device} = await setup(t);
    await Promise.all([manager.uploadFile('/queue.js','let a = 1;'), manager.sendCommand('/info')]);
    assert.ok(device.commands.indexOf('/info') > device.commands.indexOf('END'));
});
test('editor reads preserve exact text, empty files and protocol-looking contents', async t => {
    const {manager, device} = await setup(t);
    const text = 'WebScreen> literal\r\n--- End of file ---\n\n  世界  \n';
    device.files.set('/text.js', new TextEncoder().encode(text));
    assert.equal(await manager.readFile('/text.js'), text);
    assert.equal(await manager.readFile('/empty.js'), '');
    await assert.rejects(manager.readFile('/picture.bin'), /not UTF-8/);
});
test('binary download preserves all bytes and JSON listing returns subfolder entries', async t => {
    const {manager, device} = await setup(t);
    assert.deepEqual(await manager.requestDownload('/picture.bin'), device.files.get('/picture.bin'));
    const files = await manager.listFiles('/apps/');
    assert.equal(files[0].name, 'hello.js');
    assert.equal(files[0].type, 'file');
});
test('older firmware directory listings fall back after an explicit JSON error', async t => {
    const device = new MockDevice();
    const command = device.command.bind(device);
    device.command = line => line === '/ls / json' ? device.emit('[ERROR] Cannot open directory: / json\n') :
        line === '/ls /' ? device.emit('Directory listing for: /\nType    Size        Name\nFILE    1.5 KB     test.js\nDIR                apps\nTotal: 1 files, 1 directories\n') : command(line);
    const {manager} = await setup(t, device);
    const files = await manager.listFiles('/');
    assert.equal(files[0].size,1536);
    assert.equal(files[1].name,'apps');
});
test('paths reject command injection and directory traversal', async t => {
    const {manager, device} = await setup(t);
    const before = device.commands.length;
    for (const name of ['/test\n/reboot', '../secret', '/a/../b', '/bad name.js']) await assert.rejects(manager.uploadFile(name,'x'));
    assert.equal(device.commands.length, before);
});
test('disconnect rejects active requests, unlocks streams and allows reconnect', async t => {
    const device = new MockDevice();
    const command = device.command.bind(device);
    device.command = line => line === '/download /wait.js' ? undefined : command(line);
    const {manager} = await setup(t,device);
    const pending = manager.readFile('/wait.js');
    const rejected = assert.rejects(pending,/disconnected/);
    await pause(5);
    await manager.disconnect();
    await rejected;
    assert.equal(device.readable.locked,false);
    assert.equal(device.writable.locked,false);
    assert.equal(manager._lineListeners.size,0);
    await manager.connect();
    assert.equal(await manager.readFile('/empty.js'),'');
});
test('unexpected USB EOF updates connection state', async t => {
    const {manager, device} = await setup(t);
    const changes = [];
    manager.onConnectionChange = state => changes.push(state);
    device.input.close();
    await pause(20);
    assert.equal(manager.isConnected,false);
    assert.deepEqual(changes,[false]);
});
test('screenshot parses prompt-prefixed headers and RGB565 byte order', async t => {
    const {manager} = await setup(t);
    const shot = await manager.captureScreenshot();
    assert.equal(shot.width,2);
    assert.equal(shot.height,1);
    assert.equal(shot.swap,true);
    assert.deepEqual(shot.bytes,new Uint8Array([248,0,7,224]));
});
test('full-size screenshot handles many fragmented base64 lines', async t => {
    const device = new MockDevice();
    device.fragmentSize = 128;
    const command = device.command.bind(device);
    const bytes = new Uint8Array(536*240*2).fill(127);
    device.command = line => {
        if (line !== '/screenshot') return command(line);
        device.emit('=== SCREENSHOT 536x240 RGB565 ===\n');
        for (let i=0;i<bytes.length;i+=57) device.emit(btoa(String.fromCharCode(...bytes.slice(i,i+57)))+'\n');
        device.emit('=== SCREENSHOT END ===\n');
    };
    const {manager} = await setup(t,device);
    assert.deepEqual((await manager.captureScreenshot()).bytes,bytes);
});
test('malformed screenshot drains to END before releasing the operation', async t => {
    const device = new MockDevice();
    const command = device.command.bind(device);
    device.command = line => {
        if (line !== '/screenshot') return command(line);
        device.commands.push(line);
        device.emit('=== SCREENSHOT 1x1 RGB565 ===\nAAAA\n');
        setTimeout(() => device.emit('=== SCREENSHOT END ===\n'),30);
    };
    const {manager} = await setup(t,device);
    const capture = assert.rejects(manager.captureScreenshot(),/exceeds/);
    const next = manager.sendCommand('/info');
    await pause(10);
    assert.ok(!device.commands.includes('/info'));
    await Promise.all([capture,next]);
});
test('truncated download fails and does not return partial contents', async t => {
    const device = new MockDevice();
    const command = device.command.bind(device);
    device.command = line => line.startsWith('/download ') ? device.emit('=== DOWNLOAD /bad.js SIZE 5 ===\nYQ==\n=== DOWNLOAD END ===\n') : command(line);
    const {manager} = await setup(t,device);
    await assert.rejects(manager.readFile('/bad.js'),/incomplete/);
});
test('firmware upload abort is drained with END before the next command', async t => {
    const device = new MockDevice();
    const command = device.command.bind(device);
    device.command = line => {
        if (device.upload && line !== 'END') {
            device.commands.push(line);
            device.failSave = true;
            return device.emit('+ 144 B received\r[ERROR] Upload aborted: SD problem\n');
        }
        return command(line);
    };
    const {manager} = await setup(t,device);
    const upload = assert.rejects(manager.uploadFile('/aborted.js','x'.repeat(1000)),/Upload failed|SD problem/);
    const next = manager.sendCommand('/info');
    await Promise.all([upload,next]);
    assert.equal(device.upload,null);
    assert.ok(device.commands.indexOf('END') < device.commands.indexOf('/info'));
});
test('write failure disconnects instead of leaving a stale connected state', async t => {
    const {manager,device} = await setup(t);
    const command = device.command.bind(device);
    device.command = line => { if (line === '/info') throw new Error('USB write lost'); return command(line); };
    await assert.rejects(manager.sendCommand('/info'),/Serial write failed/);
    assert.equal(manager.isConnected,false);
    assert.equal(device.writable.locked,false);
});
test('declared file size above the editor limit fails after draining the stream', async t => {
    const device = new MockDevice();
    const command = device.command.bind(device);
    device.command = line => line === '/download /large.js' ? device.emit('=== DOWNLOAD /large.js SIZE 2097153 ===\nYQ==\n=== DOWNLOAD END ===\n') : command(line);
    const {manager} = await setup(t,device);
    await assert.rejects(manager.readFile('/large.js'),/2 MB/);
    await manager.sendCommand('/info');
    assert.equal(manager.isConnected,true);
});
