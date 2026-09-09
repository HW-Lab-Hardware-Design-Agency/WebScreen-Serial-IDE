const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const baseURL = process.env.IDE_URL || 'http://127.0.0.1:8770';
const fixture = fs.readFileSync(path.join(__dirname, 'mock-device.cjs'), 'utf8');
(async () => {
    const browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_PATH});
    let checks = 0;
    const errors = [];
    try {
        const context = await browser.newContext({viewport:{width:1440,height:1000}});
        await context.addInitScript(fixture);
        await context.addInitScript(() => {
            window.mockDevice = new MockDevice();
            Object.defineProperty(navigator, 'serial', {value:{requestPort:async () => mockDevice}, configurable:true});
        });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(baseURL);
        await page.waitForFunction(() => window.webScreenIDE?.codeEditor);
        assert.ok(await page.evaluate(() => Boolean(window.CodeMirror)), 'Full editor CDN dependencies must load in the primary browser test');
        await page.locator('#connectBtn').click();
        await page.waitForFunction(() => webScreenIDE.serialManager.isConnected && !webScreenIDE.fileOperation);
        assert.equal(await page.locator('#connectBtn').textContent(),'Disconnect');
        checks++;
        await page.locator('[data-tab="files"]').click();
        await page.getByRole('button',{name:'File: empty.js. Enter to open.',exact:true}).dblclick();
        await page.waitForFunction(() => webScreenIDE.currentFile === '/empty.js' && !webScreenIDE.fileOperation);
        assert.equal(await page.evaluate(() => webScreenIDE.codeEditor.getValue()),'');
        checks++;
        await page.locator('[data-tab="files"]').click();
        await page.getByRole('button',{name:'Folder: apps. Enter to open.',exact:true}).focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => webScreenIDE.currentPath === '/apps/' && !webScreenIDE.fileOperation);
        await page.getByRole('button',{name:'File: hello.js. Enter to open.',exact:true}).dblclick();
        await page.waitForFunction(() => webScreenIDE.currentFile === '/apps/hello.js' && !webScreenIDE.fileOperation);
        assert.equal(await page.locator('#filename').inputValue(),'/apps/hello.js');
        // CodeMirror normalizes CRLF internally; whitespace and blank lines remain intact.
        assert.equal(await page.evaluate(() => webScreenIDE.codeEditor.getValue()),'// test\n\nprint("世界");  \n');
        checks++;
        await page.evaluate(() => webScreenIDE.codeEditor.setValue('\nEND\nprint("é世界");  \n'));
        await page.locator('#runSaveBtn').click();
        await page.waitForFunction(() => !webScreenIDE.fileOperation);
        assert.ok(await page.evaluate(() => mockDevice.commands.includes('/load /apps/hello.js save')));
        assert.equal(await page.evaluate(() => new TextDecoder().decode(mockDevice.files.get('/apps/hello.js'))),'\nEND\nprint("é世界");  \n');
        assert.equal(await page.evaluate(() => webScreenIDE.dirty),false);
        checks++;
        await page.evaluate(() => { mockDevice.failSave = true; webScreenIDE.codeEditor.setValue('print("unsaved");'); });
        const loadCount = await page.evaluate(() => mockDevice.commands.filter(line => line.startsWith('/load ')).length);
        await page.locator('#runBtn').click();
        await page.waitForFunction(() => !webScreenIDE.fileOperation);
        assert.match(await page.locator('#fileStatus').innerText(),/failed/i);
        assert.equal(await page.evaluate(() => mockDevice.commands.filter(line => line.startsWith('/load ')).length),loadCount);
        assert.equal(await page.evaluate(() => webScreenIDE.dirty),true);
        checks++;
        await page.evaluate(() => { mockDevice.failSave = false; webScreenIDE.codeEditor.setValue('print("snapshot");'); });
        await page.locator('#saveBtn').click();
        await page.evaluate(() => webScreenIDE.codeEditor.setValue('print("newer edit");'));
        assert.equal(await page.locator('#runBtn').isDisabled(),true);
        await page.waitForFunction(() => !webScreenIDE.fileOperation);
        assert.equal(await page.evaluate(() => webScreenIDE.dirty),true);
        assert.equal(await page.evaluate(() => new TextDecoder().decode(mockDevice.files.get('/apps/hello.js'))),'print("snapshot");');
        checks++;
        await page.locator('[data-tab="files"]').click();
        page.once('dialog', dialog => dialog.dismiss());
        await page.getByRole('button',{name:'File: hello.js. Enter to open.',exact:true}).dblclick();
        assert.equal(await page.evaluate(() => webScreenIDE.codeEditor.getValue()),'print("newer edit");');
        await page.locator('#parentDirectory').click();
        await page.waitForFunction(() => webScreenIDE.currentPath === '/' && !webScreenIDE.fileOperation);
        assert.equal(await page.locator('#deleteFile').isDisabled(),true);
        checks++;
        await page.evaluate(() => mockDevice.files.set('/<img src=x onerror=alert(1)>.js',new Uint8Array()));
        await page.locator('#refreshFiles').click();
        await page.waitForFunction(() => !webScreenIDE.fileOperation);
        assert.equal(await page.locator('#fileList img').count(),0);
        assert.ok((await page.locator('#fileList').innerText()).includes('<img src=x onerror=alert(1)>.js'));
        checks++;
        await page.getByRole('button',{name:'File: picture.bin. Enter to open.',exact:true}).click();
        const downloadPromise = page.waitForEvent('download');
        await page.locator('#downloadFile').click();
        const download = await downloadPromise;
        assert.equal(download.suggestedFilename(),'picture.bin');
        assert.deepEqual(fs.readFileSync(await download.path()),Buffer.from([0,255,10,13,128]));
        checks++;
        await page.waitForFunction(() => !webScreenIDE.fileOperation);
        await page.locator('#fileInput').setInputFiles([
            {name:'batch.js',mimeType:'text/javascript',buffer:Buffer.from('print("batch");\r\n')},
            {name:'batch.bin',mimeType:'application/octet-stream',buffer:Buffer.from([0,255,128])}
        ]);
        await page.waitForFunction(() => !webScreenIDE.fileOperation);
        assert.equal(await page.evaluate(() => new TextDecoder().decode(mockDevice.files.get('/batch.js'))),'print("batch");\r\n');
        assert.deepEqual(await page.evaluate(() => Array.from(mockDevice.files.get('/batch.bin'))),[0,255,128]);
        assert.equal(await page.locator('#uploadProgressOverlay').isVisible(),false);
        checks++;
        await page.getByRole('button',{name:'File: batch.bin. Enter to open.',exact:true}).click();
        page.once('dialog', dialog => dialog.accept());
        await page.locator('#deleteFile').click();
        await page.waitForFunction(() => !webScreenIDE.fileOperation);
        assert.equal(await page.evaluate(() => mockDevice.files.has('/batch.bin')),false);
        assert.equal(await page.locator('#deleteFile').isDisabled(),true);
        checks++;
        await page.locator('#screenshotBtn').click();
        await page.waitForFunction(() => !webScreenIDE.isCapturingScreenshot);
        assert.equal(await page.locator('#screenshotOverlay').isVisible(),true);
        assert.deepEqual(await page.evaluate(() => Array.from(document.getElementById('screenshotCanvas').getContext('2d').getImageData(0,0,2,1).data)),[255,0,0,255,0,255,0,255]);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#screenshotOverlay').isVisible(),false);
        checks++;
        await page.evaluate(() => {
            webScreenIDE.clearTerminal();
            for (let i=0;i<1500;i++) webScreenIDE.appendToTerminal('Line '+i);
            webScreenIDE.flushTerminal();
        });
        assert.equal(await page.locator('#terminalOutput > div').count(),1000);
        await page.locator('[data-tab="console"]').click();
        await page.locator('#terminalOutput').evaluate(el => { el.scrollTop = 0; });
        await page.evaluate(() => { webScreenIDE.appendToTerminal('While reading history'); webScreenIDE.flushTerminal(); });
        assert.equal(await page.locator('#terminalOutput').evaluate(el => el.scrollTop),0);
        checks++;
        await page.locator('[data-tab="editor"]').click();
        await page.evaluate(() => webScreenIDE.persistDraft());
        // Simulate a fresh browser document without accepting loss of unsaved work.
        const restored = await context.newPage();
        restored.on('pageerror', error => errors.push(error.message));
        await restored.goto(baseURL);
        await restored.waitForFunction(() => window.webScreenIDE?.codeEditor);
        assert.equal(await restored.evaluate(() => webScreenIDE.codeEditor.getValue()),'print("newer edit");');
        assert.equal(await restored.locator('#filename').inputValue(),'/apps/hello.js');
        assert.match(await restored.locator('#fileStatus').innerText(),/Draft restored/i);
        checks++;
        for (const theme of ['retro','focus']) {
            await restored.evaluate(theme => webScreenIDE.setTheme(theme),theme);
            for (const width of [320,390,768,1440]) {
                await restored.setViewportSize({width,height:1000});
                await restored.waitForTimeout(100);
                const widthInfo = await restored.evaluate(() => ({scroll:document.documentElement.scrollWidth, viewport:innerWidth}));
                if (widthInfo.scroll > widthInfo.viewport + 1) {
                    console.log(await restored.evaluate(() => Array.from(document.querySelectorAll('body *')).filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0,25).map(el => ({tag:el.tagName, class:el.className, width:el.getBoundingClientRect().width, min:getComputedStyle(el).minWidth}))));
                    if (process.env.SCREENSHOT_DIR) await restored.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'overflow.png'),fullPage:true});
                }
                assert.ok(widthInfo.scroll <= widthInfo.viewport + 1, `${theme} overflows at ${width}: ${JSON.stringify(widthInfo)}`);
                const rect = await restored.locator('#codeEditor').boundingBox();
                assert.ok(rect.height >= 250,`${theme} editor too short at ${width}`);
                checks++;
            }
        }
        if (process.env.SCREENSHOT_DIR) {
            await restored.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'focus.png'),fullPage:true});
            await restored.evaluate(() => webScreenIDE.setTheme('retro'));
            await restored.waitForTimeout(500);
            await restored.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'retro.png'),fullPage:true});
        }
        await context.close();
        const offline = await browser.newContext();
        await offline.route('https://**/*', route => route.abort());
        await offline.addInitScript(() => {
            Object.defineProperty(window,'localStorage',{get:() => { throw new DOMException('Blocked','SecurityError'); }});
            Object.defineProperty(navigator,'serial',{value:undefined});
        });
        const fallback = await offline.newPage();
        fallback.on('pageerror', error => errors.push(error.message));
        await fallback.goto(baseURL);
        await fallback.waitForFunction(() => window.webScreenIDE?.codeEditor);
        await fallback.locator('.fallback-editor').fill('print("offline");');
        await fallback.locator('#themeToggle').click();
        assert.equal(await fallback.locator('.fallback-editor').inputValue(),'print("offline");');
        const localDownload = fallback.waitForEvent('download');
        await fallback.locator('#downloadEditor').click();
        assert.equal(fs.readFileSync(await (await localDownload).path(),'utf8'),'print("offline");');
        await fallback.locator('#connectBtn').click();
        await fallback.waitForTimeout(100);
        assert.match(await fallback.locator('#terminalOutput').innerText(),/Chrome or Edge/);
        checks++;
        await offline.close();
        assert.deepEqual(errors,[],'No uncaught browser errors');
        console.log(`Passed ${checks} browser checks, including both themes, draft recovery, failed saves, file paths, screenshots and offline fallback.`);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
