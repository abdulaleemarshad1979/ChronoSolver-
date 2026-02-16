(function () {
    if (window.__quizInterceptorInstalled) return;
    window.__quizInterceptorInstalled = true;
    window.quizData = null;

    console.log('%c[AutoSolver] ✓ Ready', 'color:#4CAF50;font-weight:bold');

    // ── Save REAL setTimeout/setInterval before anything can override them ────
    const _realSetTimeout  = window.setTimeout.bind(window);
    const _realSetInterval = window.setInterval.bind(window);
    const _realClearInterval = window.clearInterval.bind(window);

    // wait() always uses REAL time — never affected by speed hacks
    const wait = (ms) => new Promise(r => _realSetTimeout(r, ms));

    // ── XHR interceptor ───────────────────────────────────────────────────────
    const OrigXHR = window.XMLHttpRequest;
    function PatchedXHR() {
        const xhr = new OrigXHR();
        let _url = '';
        xhr.open = function (method, url, ...rest) {
            _url = String(url || '');
            return OrigXHR.prototype.open.apply(xhr, [method, url, ...rest]);
        };
        xhr.send = function (...args) {
            xhr.addEventListener('load', function () {
                try {
                   if (!_url.includes('questions-by-id')) return;
                    const json = JSON.parse(xhr.responseText);
                    if (json?.questions && Array.isArray(json.questions)) {
                        window.quizData = json.questions;
                        console.log('%c✅ ' + json.questions.length + ' questions captured!', 'color:#4CAF50;font-weight:bold;font-size:14px');
                        json.questions.forEach((q, i) => console.log('  ' + (i+1) + '. ' + q.answer));
                        const speed = parseInt(sessionStorage.getItem('__autoSolveSpeed') || '0');
                        if (speed > 0) {
                            console.log('%c🎯 Starting in 1s...', 'color:#2196F3;font-weight:bold');
                            _realSetTimeout(() => autoSolve(speed), 1000);
                        }
                    }
                } catch (e) {}
            });
            return OrigXHR.prototype.send.apply(xhr, args);
        };
        return xhr;
    }
    Object.setPrototypeOf(PatchedXHR.prototype, OrigXHR.prototype);
    Object.defineProperty(window, 'XMLHttpRequest', { value: PatchedXHR, writable: true, configurable: true });

    // ── fetch backup ──────────────────────────────────────────────────────────
    const origFetch = window.fetch;
    window.fetch = async function (...args) {
        const response = await origFetch.apply(this, args);
        try {
            const url = String(typeof args[0] === 'string' ? args[0] : args[0]?.url || '');
            if (!url.includes('get-emp-skills-practice-test-by-id')) return response;
            const json = await response.clone().json();
            if (json?.questions && !window.quizData) {
                window.quizData = json.questions;
                const speed = parseInt(sessionStorage.getItem('__autoSolveSpeed') || '0');
                if (speed > 0) _realSetTimeout(() => autoSolve(speed), 1000);
            }
        } catch (e) {}
        return response;
    };

    // ── Normalize text ────────────────────────────────────────────────────────
    function normalize(t) {
        return String(t || '')
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ')
            .replace(/[–—−]/g, '-')
            .replace(/[''""]/g, '')
            .replace(/\.(?!\d)/g, '')
            .replace(/\brs\b\.?\s*/gi, 'rs ')
            .replace(/\byrs\b/gi, 'years')
            .replace(/\byr\b/gi, 'year')
            .trim();
    }

    function smartMatch(optionText, answer) {
        const a = normalize(answer);
        const o = normalize(optionText);
        if (o === a) return true;
        if (o.includes(a) && a.length > 2) return true;
        if (a.includes(o) && o.length > 2 && o.length >= a.length - 3) return true;
        const hasCommaNumbers = /\d+\s*,\s*\d+/.test(answer);
        if (!hasCommaNumbers) {
            const strip = s => s.replace(/[^a-z0-9]/g, '');
            const sa = strip(a), so = strip(o);
            if (sa === so && sa.length > 0) return true;
        }
        return false;
    }

    // Wait for question text to change — uses real time
    function waitForNewQuestion(prevText, timeout = 2500) {
        return new Promise((resolve) => {
            const start = Date.now();
            const check = () => {
                const qEl = document.querySelector('p, h2, h3, [class*="question"]');
                const cur = qEl ? qEl.textContent.trim().slice(0, 40) : '';
                if (cur && cur !== prevText) { resolve(); return; }
                if (Date.now() - start > timeout) { resolve(); return; }
                _realSetTimeout(check, 80);
            };
            _realSetTimeout(check, 100);
        });
    }

    // Wait for radio buttons to appear on screen — ensures page rendered
    function waitForOptions(timeout = 2000) {
        return new Promise((resolve) => {
            const start = Date.now();
            const check = () => {
                const radios = document.querySelectorAll('input[type="radio"]');
                if (radios.length > 0) { resolve(true); return; }
                if (Date.now() - start > timeout) { resolve(false); return; }
                _realSetTimeout(check, 50);
            };
            check();
        });
    }

    // Try all strategies to click correct answer
    function tryClick(answer) {
        // Strategy 1: radio + label
        for (let r of document.querySelectorAll('input[type="radio"]')) {
            const lbl = document.querySelector(`label[for="${r.id}"]`)
                      || r.closest('label')
                      || r.parentElement;
            if (lbl && smartMatch(lbl.textContent, answer)) {
                r.click();
                r.dispatchEvent(new Event('change', { bubbles: true }));
                console.log('%c✅ "' + lbl.textContent.trim().slice(0, 40) + '"', 'color:#4CAF50;font-weight:bold');
                return true;
            }
        }
        // Strategy 2: radio parent element
        for (let r of document.querySelectorAll('input[type="radio"]')) {
            const p = r.parentElement;
            if (p && smartMatch(p.textContent, answer)) {
                r.click();
                r.dispatchEvent(new Event('change', { bubbles: true }));
                console.log('%c✅ parent: "' + p.textContent.trim().slice(0, 40) + '"', 'color:#4CAF50;font-weight:bold');
                return true;
            }
        }
        // Strategy 3: option/choice class elements
        for (let sel of ['[class*="option"]', '[class*="Option"]', '[class*="choice"]', 'li']) {
            for (let el of document.querySelectorAll(sel)) {
                if (smartMatch(el.textContent, answer)) {
                    el.click();
                    console.log('%c✅ el["' + sel + '"]: "' + el.textContent.trim().slice(0, 40) + '"', 'color:#4CAF50;font-weight:bold');
                    return true;
                }
            }
        }
        // Strategy 4: leaf node text scan
        for (let el of document.querySelectorAll('span, div, p, td')) {
            if (el.children.length > 2) continue;
            if (smartMatch(el.textContent, answer)) {
                el.click();
                console.log('%c✅ scan: "' + el.textContent.trim().slice(0, 40) + '"', 'color:#4CAF50;font-weight:bold');
                return true;
            }
        }
        return false;
    }

    // ── Auto-solve ────────────────────────────────────────────────────────────
    async function autoSolve(speedMult) {
        if (!window.quizData) { console.error('❌ No quiz data!'); return; }

        console.log('%c🎯 AUTO-SOLVING STARTED at ' + speedMult + 'x', 'color:#2196F3;font-size:16px;font-weight:bold');

        for (let i = 0; i < Math.min(window.quizData.length, 20); i++) {
            const q = window.quizData[i];
            console.log('%c━━━ Q' + (i+1) + ' | "' + q.answer + '"', 'color:#2196F3;font-weight:bold');

            // Wait for radio options to actually appear on screen
            await waitForOptions();

            // Try clicking immediately
            let clicked = tryClick(q.answer);

            // Retry up to 3 times with short real-time waits if not found
            if (!clicked) {
                await wait(100);
                clicked = tryClick(q.answer);
            }
            if (!clicked) {
                await wait(200);
                clicked = tryClick(q.answer);
            }
            if (!clicked) {
                await wait(300);
                clicked = tryClick(q.answer);
            }

            if (!clicked) {
                console.log('%c❌ NOT FOUND: "' + q.answer + '"', 'color:#f44336;font-weight:bold');
                document.querySelectorAll('input[type="radio"]').forEach(r => {
                    const lbl = document.querySelector(`label[for="${r.id}"]`) || r.closest('label') || r.parentElement;
                    if (lbl) console.log('   saw: "' + lbl.textContent.trim() + '"');
                });
            }

            // Small pause after clicking before moving to next
            await wait(80);

            // Click Next button
            if (i < window.quizData.length - 1) {
                const qEl = document.querySelector('p, h2, h3, [class*="question"]');
                const prevText = qEl ? qEl.textContent.trim().slice(0, 40) : '';

                const nextBtn = [...document.querySelectorAll('button')].find(b => {
                    const t = b.textContent.toLowerCase().trim();
                    return t === 'next' || t.startsWith('next');
                });

                if (nextBtn) {
                    nextBtn.click();
                    console.log('➡️ Next');
                    // Wait for the page to actually show the new question
                    await waitForNewQuestion(prevText);
                } else {
                    console.log('%c⚠️ Next button not found!', 'color:#ff8c00');
                    await wait(600);
                }
            }
        }

        console.log('%c✅ ALL DONE! Activating timer boost...', 'color:#4CAF50;font-size:18px;font-weight:bold');
        sessionStorage.removeItem('__autoSolveSpeed');

        // ── Timer speed hack — runs AFTER solving is complete ─────────────────
        // Uses saved real functions so the solve loop above is never affected
        const _origDate = window.Date;

        if (speedMult >= 9999) {
            // Spoof Date.now() to race forward at 9999x
            const startReal = _origDate.now();
            window.Date = class extends _origDate {
                constructor(...args) {
                    if (args.length === 0) super(_origDate.now() + (_origDate.now() - startReal) * 9998);
                    else super(...args);
                }
                static now() { return _origDate.now() + (_origDate.now() - startReal) * 9998; }
            };
            console.log('%c🚀 MAX — Date spoofed at 9999x!', 'color:#ffd700;font-weight:bold;font-size:14px');
        }

        // Override setTimeout/setInterval for the PAGE (not our code — we saved real refs above)
        window.setInterval = (f, d, ...a) => _realSetInterval(f, Math.max(1, Math.floor(d / speedMult)), ...a);
        window.setTimeout  = (f, d, ...a) => _realSetTimeout(f,  Math.max(1, Math.floor(d / speedMult)), ...a);

        console.log('%c🚀 Timer x' + speedMult + ' active!', 'color:#ffd700;font-weight:bold;font-size:14px');
    }

    window.__autoSolve = autoSolve;
})();(function () {
    if (window.__quizInterceptorInstalled) return;
    window.__quizInterceptorInstalled = true;
    window.quizData = null;

    console.log('%c[AutoSolver] ✓ Ready', 'color:#4CAF50;font-weight:bold');

    // ── Save REAL setTimeout/setInterval before anything can override them ────
    const _realSetTimeout  = window.setTimeout.bind(window);
    const _realSetInterval = window.setInterval.bind(window);
    const _realClearInterval = window.clearInterval.bind(window);

    // wait() always uses REAL time — never affected by speed hacks
    const wait = (ms) => new Promise(r => _realSetTimeout(r, ms));

    // ── XHR interceptor ───────────────────────────────────────────────────────
    const OrigXHR = window.XMLHttpRequest;
    function PatchedXHR() {
        const xhr = new OrigXHR();
        let _url = '';
        xhr.open = function (method, url, ...rest) {
            _url = String(url || '');
            return OrigXHR.prototype.open.apply(xhr, [method, url, ...rest]);
        };
        xhr.send = function (...args) {
            xhr.addEventListener('load', function () {
                try {
                   if (!_url.includes('questions-by-id')) return;
                    const json = JSON.parse(xhr.responseText);
                    if (json?.questions && Array.isArray(json.questions)) {
                        window.quizData = json.questions;
                        console.log('%c✅ ' + json.questions.length + ' questions captured!', 'color:#4CAF50;font-weight:bold;font-size:14px');
                        json.questions.forEach((q, i) => console.log('  ' + (i+1) + '. ' + q.answer));
                        const speed = parseInt(sessionStorage.getItem('__autoSolveSpeed') || '0');
                        if (speed > 0) {
                            console.log('%c🎯 Starting in 1s...', 'color:#2196F3;font-weight:bold');
                            _realSetTimeout(() => autoSolve(speed), 1000);
                        }
                    }
                } catch (e) {}
            });
            return OrigXHR.prototype.send.apply(xhr, args);
        };
        return xhr;
    }
    Object.setPrototypeOf(PatchedXHR.prototype, OrigXHR.prototype);
    Object.defineProperty(window, 'XMLHttpRequest', { value: PatchedXHR, writable: true, configurable: true });

    // ── fetch backup ──────────────────────────────────────────────────────────
    const origFetch = window.fetch;
    window.fetch = async function (...args) {
        const response = await origFetch.apply(this, args);
        try {
            const url = String(typeof args[0] === 'string' ? args[0] : args[0]?.url || '');
            if (!url.includes('get-emp-skills-practice-test-by-id')) return response;
            const json = await response.clone().json();
            if (json?.questions && !window.quizData) {
                window.quizData = json.questions;
                const speed = parseInt(sessionStorage.getItem('__autoSolveSpeed') || '0');
                if (speed > 0) _realSetTimeout(() => autoSolve(speed), 1000);
            }
        } catch (e) {}
        return response;
    };

    // ── Normalize text ────────────────────────────────────────────────────────
    function normalize(t) {
        return String(t || '')
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ')
            .replace(/[–—−]/g, '-')
            .replace(/[''""]/g, '')
            .replace(/\.(?!\d)/g, '')
            .replace(/\brs\b\.?\s*/gi, 'rs ')
            .replace(/\byrs\b/gi, 'years')
            .replace(/\byr\b/gi, 'year')
            .trim();
    }

    function smartMatch(optionText, answer) {
        const a = normalize(answer);
        const o = normalize(optionText);
        if (o === a) return true;
        if (o.includes(a) && a.length > 2) return true;
        if (a.includes(o) && o.length > 2 && o.length >= a.length - 3) return true;
        const hasCommaNumbers = /\d+\s*,\s*\d+/.test(answer);
        if (!hasCommaNumbers) {
            const strip = s => s.replace(/[^a-z0-9]/g, '');
            const sa = strip(a), so = strip(o);
            if (sa === so && sa.length > 0) return true;
        }
        return false;
    }

    // Wait for question text to change — uses real time
    function waitForNewQuestion(prevText, timeout = 2500) {
        return new Promise((resolve) => {
            const start = Date.now();
            const check = () => {
                const qEl = document.querySelector('p, h2, h3, [class*="question"]');
                const cur = qEl ? qEl.textContent.trim().slice(0, 40) : '';
                if (cur && cur !== prevText) { resolve(); return; }
                if (Date.now() - start > timeout) { resolve(); return; }
                _realSetTimeout(check, 80);
            };
            _realSetTimeout(check, 100);
        });
    }

    // Wait for radio buttons to appear on screen — ensures page rendered
    function waitForOptions(timeout = 2000) {
        return new Promise((resolve) => {
            const start = Date.now();
            const check = () => {
                const radios = document.querySelectorAll('input[type="radio"]');
                if (radios.length > 0) { resolve(true); return; }
                if (Date.now() - start > timeout) { resolve(false); return; }
                _realSetTimeout(check, 50);
            };
            check();
        });
    }

    // Try all strategies to click correct answer
    function tryClick(answer) {
        // Strategy 1: radio + label
        for (let r of document.querySelectorAll('input[type="radio"]')) {
            const lbl = document.querySelector(`label[for="${r.id}"]`)
                      || r.closest('label')
                      || r.parentElement;
            if (lbl && smartMatch(lbl.textContent, answer)) {
                r.click();
                r.dispatchEvent(new Event('change', { bubbles: true }));
                console.log('%c✅ "' + lbl.textContent.trim().slice(0, 40) + '"', 'color:#4CAF50;font-weight:bold');
                return true;
            }
        }
        // Strategy 2: radio parent element
        for (let r of document.querySelectorAll('input[type="radio"]')) {
            const p = r.parentElement;
            if (p && smartMatch(p.textContent, answer)) {
                r.click();
                r.dispatchEvent(new Event('change', { bubbles: true }));
                console.log('%c✅ parent: "' + p.textContent.trim().slice(0, 40) + '"', 'color:#4CAF50;font-weight:bold');
                return true;
            }
        }
        // Strategy 3: option/choice class elements
        for (let sel of ['[class*="option"]', '[class*="Option"]', '[class*="choice"]', 'li']) {
            for (let el of document.querySelectorAll(sel)) {
                if (smartMatch(el.textContent, answer)) {
                    el.click();
                    console.log('%c✅ el["' + sel + '"]: "' + el.textContent.trim().slice(0, 40) + '"', 'color:#4CAF50;font-weight:bold');
                    return true;
                }
            }
        }
        // Strategy 4: leaf node text scan
        for (let el of document.querySelectorAll('span, div, p, td')) {
            if (el.children.length > 2) continue;
            if (smartMatch(el.textContent, answer)) {
                el.click();
                console.log('%c✅ scan: "' + el.textContent.trim().slice(0, 40) + '"', 'color:#4CAF50;font-weight:bold');
                return true;
            }
        }
        return false;
    }

    // ── Auto-solve ────────────────────────────────────────────────────────────
    async function autoSolve(speedMult) {
        if (!window.quizData) { console.error('❌ No quiz data!'); return; }

        console.log('%c🎯 AUTO-SOLVING STARTED at ' + speedMult + 'x', 'color:#2196F3;font-size:16px;font-weight:bold');

        for (let i = 0; i < Math.min(window.quizData.length, 20); i++) {
            const q = window.quizData[i];
            console.log('%c━━━ Q' + (i+1) + ' | "' + q.answer + '"', 'color:#2196F3;font-weight:bold');

            // Wait for radio options to actually appear on screen
            await waitForOptions();

            // Try clicking immediately
            let clicked = tryClick(q.answer);

            // Retry up to 3 times with short real-time waits if not found
            if (!clicked) {
                await wait(100);
                clicked = tryClick(q.answer);
            }
            if (!clicked) {
                await wait(200);
                clicked = tryClick(q.answer);
            }
            if (!clicked) {
                await wait(300);
                clicked = tryClick(q.answer);
            }

            if (!clicked) {
                console.log('%c❌ NOT FOUND: "' + q.answer + '"', 'color:#f44336;font-weight:bold');
                document.querySelectorAll('input[type="radio"]').forEach(r => {
                    const lbl = document.querySelector(`label[for="${r.id}"]`) || r.closest('label') || r.parentElement;
                    if (lbl) console.log('   saw: "' + lbl.textContent.trim() + '"');
                });
            }

            // Small pause after clicking before moving to next
            await wait(80);

            // Click Next button
            if (i < window.quizData.length - 1) {
                const qEl = document.querySelector('p, h2, h3, [class*="question"]');
                const prevText = qEl ? qEl.textContent.trim().slice(0, 40) : '';

                const nextBtn = [...document.querySelectorAll('button')].find(b => {
                    const t = b.textContent.toLowerCase().trim();
                    return t === 'next' || t.startsWith('next');
                });

                if (nextBtn) {
                    nextBtn.click();
                    console.log('➡️ Next');
                    // Wait for the page to actually show the new question
                    await waitForNewQuestion(prevText);
                } else {
                    console.log('%c⚠️ Next button not found!', 'color:#ff8c00');
                    await wait(600);
                }
            }
        }

        console.log('%c✅ ALL DONE! Activating timer boost...', 'color:#4CAF50;font-size:18px;font-weight:bold');
        sessionStorage.removeItem('__autoSolveSpeed');

        // ── Timer speed hack — runs AFTER solving is complete ─────────────────
        // Uses saved real functions so the solve loop above is never affected
        const _origDate = window.Date;

        if (speedMult >= 9999) {
            // Spoof Date.now() to race forward at 9999x
            const startReal = _origDate.now();
            window.Date = class extends _origDate {
                constructor(...args) {
                    if (args.length === 0) super(_origDate.now() + (_origDate.now() - startReal) * 9998);
                    else super(...args);
                }
                static now() { return _origDate.now() + (_origDate.now() - startReal) * 9998; }
            };
            console.log('%c🚀 MAX — Date spoofed at 9999x!', 'color:#ffd700;font-weight:bold;font-size:14px');
        }

        // Override setTimeout/setInterval for the PAGE (not our code — we saved real refs above)
        window.setInterval = (f, d, ...a) => _realSetInterval(f, Math.max(1, Math.floor(d / speedMult)), ...a);
        window.setTimeout  = (f, d, ...a) => _realSetTimeout(f,  Math.max(1, Math.floor(d / speedMult)), ...a);

        console.log('%c🚀 Timer x' + speedMult + ' active!', 'color:#ffd700;font-weight:bold;font-size:14px');
    }

    window.__autoSolve = autoSolve;
})();(function () {
    if (window.__quizInterceptorInstalled) return;
    window.__quizInterceptorInstalled = true;
    window.quizData = null;

    console.log('%c[AutoSolver] ✓ Ready', 'color:#4CAF50;font-weight:bold');

    // ── Save REAL setTimeout/setInterval before anything can override them ────
    const _realSetTimeout  = window.setTimeout.bind(window);
    const _realSetInterval = window.setInterval.bind(window);
    const _realClearInterval = window.clearInterval.bind(window);

    // wait() always uses REAL time — never affected by speed hacks
    const wait = (ms) => new Promise(r => _realSetTimeout(r, ms));

    // ── XHR interceptor ───────────────────────────────────────────────────────
    const OrigXHR = window.XMLHttpRequest;
    function PatchedXHR() {
        const xhr = new OrigXHR();
        let _url = '';
        xhr.open = function (method, url, ...rest) {
            _url = String(url || '');
            return OrigXHR.prototype.open.apply(xhr, [method, url, ...rest]);
        };
        xhr.send = function (...args) {
            xhr.addEventListener('load', function () {
                try {
                   if (!_url.includes('questions-by-id')) return;
                    const json = JSON.parse(xhr.responseText);
                    if (json?.questions && Array.isArray(json.questions)) {
                        window.quizData = json.questions;
                        console.log('%c✅ ' + json.questions.length + ' questions captured!', 'color:#4CAF50;font-weight:bold;font-size:14px');
                        json.questions.forEach((q, i) => console.log('  ' + (i+1) + '. ' + q.answer));
                        const speed = parseInt(sessionStorage.getItem('__autoSolveSpeed') || '0');
                        if (speed > 0) {
                            console.log('%c🎯 Starting in 1s...', 'color:#2196F3;font-weight:bold');
                            _realSetTimeout(() => autoSolve(speed), 1000);
                        }
                    }
                } catch (e) {}
            });
            return OrigXHR.prototype.send.apply(xhr, args);
        };
        return xhr;
    }
    Object.setPrototypeOf(PatchedXHR.prototype, OrigXHR.prototype);
    Object.defineProperty(window, 'XMLHttpRequest', { value: PatchedXHR, writable: true, configurable: true });

    // ── fetch backup ──────────────────────────────────────────────────────────
    const origFetch = window.fetch;
    window.fetch = async function (...args) {
        const response = await origFetch.apply(this, args);
        try {
            const url = String(typeof args[0] === 'string' ? args[0] : args[0]?.url || '');
            if (!url.includes('get-emp-skills-practice-test-by-id')) return response;
            const json = await response.clone().json();
            if (json?.questions && !window.quizData) {
                window.quizData = json.questions;
                const speed = parseInt(sessionStorage.getItem('__autoSolveSpeed') || '0');
                if (speed > 0) _realSetTimeout(() => autoSolve(speed), 1000);
            }
        } catch (e) {}
        return response;
    };

    // ── Normalize text ────────────────────────────────────────────────────────
    function normalize(t) {
        return String(t || '')
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ')
            .replace(/[–—−]/g, '-')
            .replace(/[''""]/g, '')
            .replace(/\.(?!\d)/g, '')
            .replace(/\brs\b\.?\s*/gi, 'rs ')
            .replace(/\byrs\b/gi, 'years')
            .replace(/\byr\b/gi, 'year')
            .trim();
    }

    function smartMatch(optionText, answer) {
        const a = normalize(answer);
        const o = normalize(optionText);
        if (o === a) return true;
        if (o.includes(a) && a.length > 2) return true;
        if (a.includes(o) && o.length > 2 && o.length >= a.length - 3) return true;
        const hasCommaNumbers = /\d+\s*,\s*\d+/.test(answer);
        if (!hasCommaNumbers) {
            const strip = s => s.replace(/[^a-z0-9]/g, '');
            const sa = strip(a), so = strip(o);
            if (sa === so && sa.length > 0) return true;
        }
        return false;
    }

    // Wait for question text to change — uses real time
    function waitForNewQuestion(prevText, timeout = 2500) {
        return new Promise((resolve) => {
            const start = Date.now();
            const check = () => {
                const qEl = document.querySelector('p, h2, h3, [class*="question"]');
                const cur = qEl ? qEl.textContent.trim().slice(0, 40) : '';
                if (cur && cur !== prevText) { resolve(); return; }
                if (Date.now() - start > timeout) { resolve(); return; }
                _realSetTimeout(check, 80);
            };
            _realSetTimeout(check, 100);
        });
    }

    // Wait for radio buttons to appear on screen — ensures page rendered
    function waitForOptions(timeout = 2000) {
        return new Promise((resolve) => {
            const start = Date.now();
            const check = () => {
                const radios = document.querySelectorAll('input[type="radio"]');
                if (radios.length > 0) { resolve(true); return; }
                if (Date.now() - start > timeout) { resolve(false); return; }
                _realSetTimeout(check, 50);
            };
            check();
        });
    }

    // Try all strategies to click correct answer
    function tryClick(answer) {
        // Strategy 1: radio + label
        for (let r of document.querySelectorAll('input[type="radio"]')) {
            const lbl = document.querySelector(`label[for="${r.id}"]`)
                      || r.closest('label')
                      || r.parentElement;
            if (lbl && smartMatch(lbl.textContent, answer)) {
                r.click();
                r.dispatchEvent(new Event('change', { bubbles: true }));
                console.log('%c✅ "' + lbl.textContent.trim().slice(0, 40) + '"', 'color:#4CAF50;font-weight:bold');
                return true;
            }
        }
        // Strategy 2: radio parent element
        for (let r of document.querySelectorAll('input[type="radio"]')) {
            const p = r.parentElement;
            if (p && smartMatch(p.textContent, answer)) {
                r.click();
                r.dispatchEvent(new Event('change', { bubbles: true }));
                console.log('%c✅ parent: "' + p.textContent.trim().slice(0, 40) + '"', 'color:#4CAF50;font-weight:bold');
                return true;
            }
        }
        // Strategy 3: option/choice class elements
        for (let sel of ['[class*="option"]', '[class*="Option"]', '[class*="choice"]', 'li']) {
            for (let el of document.querySelectorAll(sel)) {
                if (smartMatch(el.textContent, answer)) {
                    el.click();
                    console.log('%c✅ el["' + sel + '"]: "' + el.textContent.trim().slice(0, 40) + '"', 'color:#4CAF50;font-weight:bold');
                    return true;
                }
            }
        }
        // Strategy 4: leaf node text scan
        for (let el of document.querySelectorAll('span, div, p, td')) {
            if (el.children.length > 2) continue;
            if (smartMatch(el.textContent, answer)) {
                el.click();
                console.log('%c✅ scan: "' + el.textContent.trim().slice(0, 40) + '"', 'color:#4CAF50;font-weight:bold');
                return true;
            }
        }
        return false;
    }

    // ── Auto-solve ────────────────────────────────────────────────────────────
    async function autoSolve(speedMult) {
        if (!window.quizData) { console.error('❌ No quiz data!'); return; }

        console.log('%c🎯 AUTO-SOLVING STARTED at ' + speedMult + 'x', 'color:#2196F3;font-size:16px;font-weight:bold');

        for (let i = 0; i < Math.min(window.quizData.length, 20); i++) {
            const q = window.quizData[i];
            console.log('%c━━━ Q' + (i+1) + ' | "' + q.answer + '"', 'color:#2196F3;font-weight:bold');

            // Wait for radio options to actually appear on screen
            await waitForOptions();

            // Try clicking immediately
            let clicked = tryClick(q.answer);

            // Retry up to 3 times with short real-time waits if not found
            if (!clicked) {
                await wait(100);
                clicked = tryClick(q.answer);
            }
            if (!clicked) {
                await wait(200);
                clicked = tryClick(q.answer);
            }
            if (!clicked) {
                await wait(300);
                clicked = tryClick(q.answer);
            }

            if (!clicked) {
                console.log('%c❌ NOT FOUND: "' + q.answer + '"', 'color:#f44336;font-weight:bold');
                document.querySelectorAll('input[type="radio"]').forEach(r => {
                    const lbl = document.querySelector(`label[for="${r.id}"]`) || r.closest('label') || r.parentElement;
                    if (lbl) console.log('   saw: "' + lbl.textContent.trim() + '"');
                });
            }

            // Small pause after clicking before moving to next
            await wait(80);

            // Click Next button
            if (i < window.quizData.length - 1) {
                const qEl = document.querySelector('p, h2, h3, [class*="question"]');
                const prevText = qEl ? qEl.textContent.trim().slice(0, 40) : '';

                const nextBtn = [...document.querySelectorAll('button')].find(b => {
                    const t = b.textContent.toLowerCase().trim();
                    return t === 'next' || t.startsWith('next');
                });

                if (nextBtn) {
                    nextBtn.click();
                    console.log('➡️ Next');
                    // Wait for the page to actually show the new question
                    await waitForNewQuestion(prevText);
                } else {
                    console.log('%c⚠️ Next button not found!', 'color:#ff8c00');
                    await wait(600);
                }
            }
        }

        console.log('%c✅ ALL DONE! Activating timer boost...', 'color:#4CAF50;font-size:18px;font-weight:bold');
        sessionStorage.removeItem('__autoSolveSpeed');

        // ── Timer speed hack — runs AFTER solving is complete ─────────────────
        // Uses saved real functions so the solve loop above is never affected
        const _origDate = window.Date;

        if (speedMult >= 9999) {
            // Spoof Date.now() to race forward at 9999x
            const startReal = _origDate.now();
            window.Date = class extends _origDate {
                constructor(...args) {
                    if (args.length === 0) super(_origDate.now() + (_origDate.now() - startReal) * 9998);
                    else super(...args);
                }
                static now() { return _origDate.now() + (_origDate.now() - startReal) * 9998; }
            };
            console.log('%c🚀 MAX — Date spoofed at 9999x!', 'color:#ffd700;font-weight:bold;font-size:14px');
        }

        // Override setTimeout/setInterval for the PAGE (not our code — we saved real refs above)
        window.setInterval = (f, d, ...a) => _realSetInterval(f, Math.max(1, Math.floor(d / speedMult)), ...a);
        window.setTimeout  = (f, d, ...a) => _realSetTimeout(f,  Math.max(1, Math.floor(d / speedMult)), ...a);

        console.log('%c🚀 Timer x' + speedMult + ' active!', 'color:#ffd700;font-weight:bold;font-size:14px');
    }

    window.__autoSolve = autoSolve;
})();(function () {
    if (window.__quizInterceptorInstalled) return;
    window.__quizInterceptorInstalled = true;
    window.quizData = null;

    console.log('%c[AutoSolver] ✓ Ready', 'color:#4CAF50;font-weight:bold');

    // ── Save REAL setTimeout/setInterval before anything can override them ────
    const _realSetTimeout  = window.setTimeout.bind(window);
    const _realSetInterval = window.setInterval.bind(window);
    const _realClearInterval = window.clearInterval.bind(window);

    // wait() always uses REAL time — never affected by speed hacks
    const wait = (ms) => new Promise(r => _realSetTimeout(r, ms));

    // ── XHR interceptor ───────────────────────────────────────────────────────
    const OrigXHR = window.XMLHttpRequest;
    function PatchedXHR() {
        const xhr = new OrigXHR();
        let _url = '';
        xhr.open = function (method, url, ...rest) {
            _url = String(url || '');
            return OrigXHR.prototype.open.apply(xhr, [method, url, ...rest]);
        };
        xhr.send = function (...args) {
            xhr.addEventListener('load', function () {
                try {
                   if (!_url.includes('questions-by-id')) return;
                    const json = JSON.parse(xhr.responseText);
                    if (json?.questions && Array.isArray(json.questions)) {
                        window.quizData = json.questions;
                        console.log('%c✅ ' + json.questions.length + ' questions captured!', 'color:#4CAF50;font-weight:bold;font-size:14px');
                        json.questions.forEach((q, i) => console.log('  ' + (i+1) + '. ' + q.answer));
                        const speed = parseInt(sessionStorage.getItem('__autoSolveSpeed') || '0');
                        if (speed > 0) {
                            console.log('%c🎯 Starting in 1s...', 'color:#2196F3;font-weight:bold');
                            _realSetTimeout(() => autoSolve(speed), 1000);
                        }
                    }
                } catch (e) {}
            });
            return OrigXHR.prototype.send.apply(xhr, args);
        };
        return xhr;
    }
    Object.setPrototypeOf(PatchedXHR.prototype, OrigXHR.prototype);
    Object.defineProperty(window, 'XMLHttpRequest', { value: PatchedXHR, writable: true, configurable: true });

    // ── fetch backup ──────────────────────────────────────────────────────────
    const origFetch = window.fetch;
    window.fetch = async function (...args) {
        const response = await origFetch.apply(this, args);
        try {
            const url = String(typeof args[0] === 'string' ? args[0] : args[0]?.url || '');
            if (!url.includes('get-emp-skills-practice-test-by-id')) return response;
            const json = await response.clone().json();
            if (json?.questions && !window.quizData) {
                window.quizData = json.questions;
                const speed = parseInt(sessionStorage.getItem('__autoSolveSpeed') || '0');
                if (speed > 0) _realSetTimeout(() => autoSolve(speed), 1000);
            }
        } catch (e) {}
        return response;
    };

    // ── Normalize text ────────────────────────────────────────────────────────
    function normalize(t) {
        return String(t || '')
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ')
            .replace(/[–—−]/g, '-')
            .replace(/[''""]/g, '')
            .replace(/\.(?!\d)/g, '')
            .replace(/\brs\b\.?\s*/gi, 'rs ')
            .replace(/\byrs\b/gi, 'years')
            .replace(/\byr\b/gi, 'year')
            .trim();
    }

    function smartMatch(optionText, answer) {
        const a = normalize(answer);
        const o = normalize(optionText);
        if (o === a) return true;
        if (o.includes(a) && a.length > 2) return true;
        if (a.includes(o) && o.length > 2 && o.length >= a.length - 3) return true;
        const hasCommaNumbers = /\d+\s*,\s*\d+/.test(answer);
        if (!hasCommaNumbers) {
            const strip = s => s.replace(/[^a-z0-9]/g, '');
            const sa = strip(a), so = strip(o);
            if (sa === so && sa.length > 0) return true;
        }
        return false;
    }

    // Wait for question text to change — uses real time
    function waitForNewQuestion(prevText, timeout = 2500) {
        return new Promise((resolve) => {
            const start = Date.now();
            const check = () => {
                const qEl = document.querySelector('p, h2, h3, [class*="question"]');
                const cur = qEl ? qEl.textContent.trim().slice(0, 40) : '';
                if (cur && cur !== prevText) { resolve(); return; }
                if (Date.now() - start > timeout) { resolve(); return; }
                _realSetTimeout(check, 80);
            };
            _realSetTimeout(check, 100);
        });
    }

    // Wait for radio buttons to appear on screen — ensures page rendered
    function waitForOptions(timeout = 2000) {
        return new Promise((resolve) => {
            const start = Date.now();
            const check = () => {
                const radios = document.querySelectorAll('input[type="radio"]');
                if (radios.length > 0) { resolve(true); return; }
                if (Date.now() - start > timeout) { resolve(false); return; }
                _realSetTimeout(check, 50);
            };
            check();
        });
    }

    // Try all strategies to click correct answer
    function tryClick(answer) {
        // Strategy 1: radio + label
        for (let r of document.querySelectorAll('input[type="radio"]')) {
            const lbl = document.querySelector(`label[for="${r.id}"]`)
                      || r.closest('label')
                      || r.parentElement;
            if (lbl && smartMatch(lbl.textContent, answer)) {
                r.click();
                r.dispatchEvent(new Event('change', { bubbles: true }));
                console.log('%c✅ "' + lbl.textContent.trim().slice(0, 40) + '"', 'color:#4CAF50;font-weight:bold');
                return true;
            }
        }
        // Strategy 2: radio parent element
        for (let r of document.querySelectorAll('input[type="radio"]')) {
            const p = r.parentElement;
            if (p && smartMatch(p.textContent, answer)) {
                r.click();
                r.dispatchEvent(new Event('change', { bubbles: true }));
                console.log('%c✅ parent: "' + p.textContent.trim().slice(0, 40) + '"', 'color:#4CAF50;font-weight:bold');
                return true;
            }
        }
        // Strategy 3: option/choice class elements
        for (let sel of ['[class*="option"]', '[class*="Option"]', '[class*="choice"]', 'li']) {
            for (let el of document.querySelectorAll(sel)) {
                if (smartMatch(el.textContent, answer)) {
                    el.click();
                    console.log('%c✅ el["' + sel + '"]: "' + el.textContent.trim().slice(0, 40) + '"', 'color:#4CAF50;font-weight:bold');
                    return true;
                }
            }
        }
        // Strategy 4: leaf node text scan
        for (let el of document.querySelectorAll('span, div, p, td')) {
            if (el.children.length > 2) continue;
            if (smartMatch(el.textContent, answer)) {
                el.click();
                console.log('%c✅ scan: "' + el.textContent.trim().slice(0, 40) + '"', 'color:#4CAF50;font-weight:bold');
                return true;
            }
        }
        return false;
    }

    // ── Auto-solve ────────────────────────────────────────────────────────────
    async function autoSolve(speedMult) {
        if (!window.quizData) { console.error('❌ No quiz data!'); return; }

        console.log('%c🎯 AUTO-SOLVING STARTED at ' + speedMult + 'x', 'color:#2196F3;font-size:16px;font-weight:bold');

        for (let i = 0; i < Math.min(window.quizData.length, 20); i++) {
            const q = window.quizData[i];
            console.log('%c━━━ Q' + (i+1) + ' | "' + q.answer + '"', 'color:#2196F3;font-weight:bold');

            // Wait for radio options to actually appear on screen
            await waitForOptions();

            // Try clicking immediately
            let clicked = tryClick(q.answer);

            // Retry up to 3 times with short real-time waits if not found
            if (!clicked) {
                await wait(100);
                clicked = tryClick(q.answer);
            }
            if (!clicked) {
                await wait(200);
                clicked = tryClick(q.answer);
            }
            if (!clicked) {
                await wait(300);
                clicked = tryClick(q.answer);
            }

            if (!clicked) {
                console.log('%c❌ NOT FOUND: "' + q.answer + '"', 'color:#f44336;font-weight:bold');
                document.querySelectorAll('input[type="radio"]').forEach(r => {
                    const lbl = document.querySelector(`label[for="${r.id}"]`) || r.closest('label') || r.parentElement;
                    if (lbl) console.log('   saw: "' + lbl.textContent.trim() + '"');
                });
            }

            // Small pause after clicking before moving to next
            await wait(80);

            // Click Next button
            if (i < window.quizData.length - 1) {
                const qEl = document.querySelector('p, h2, h3, [class*="question"]');
                const prevText = qEl ? qEl.textContent.trim().slice(0, 40) : '';

                const nextBtn = [...document.querySelectorAll('button')].find(b => {
                    const t = b.textContent.toLowerCase().trim();
                    return t === 'next' || t.startsWith('next');
                });

                if (nextBtn) {
                    nextBtn.click();
                    console.log('➡️ Next');
                    // Wait for the page to actually show the new question
                    await waitForNewQuestion(prevText);
                } else {
                    console.log('%c⚠️ Next button not found!', 'color:#ff8c00');
                    await wait(600);
                }
            }
        }

        console.log('%c✅ ALL DONE! Activating timer boost...', 'color:#4CAF50;font-size:18px;font-weight:bold');
        sessionStorage.removeItem('__autoSolveSpeed');

        // ── Timer speed hack — runs AFTER solving is complete ─────────────────
        // Uses saved real functions so the solve loop above is never affected
        const _origDate = window.Date;

        if (speedMult >= 9999) {
            // Spoof Date.now() to race forward at 9999x
            const startReal = _origDate.now();
            window.Date = class extends _origDate {
                constructor(...args) {
                    if (args.length === 0) super(_origDate.now() + (_origDate.now() - startReal) * 9998);
                    else super(...args);
                }
                static now() { return _origDate.now() + (_origDate.now() - startReal) * 9998; }
            };
            console.log('%c🚀 MAX — Date spoofed at 9999x!', 'color:#ffd700;font-weight:bold;font-size:14px');
        }

        // Override setTimeout/setInterval for the PAGE (not our code — we saved real refs above)
        window.setInterval = (f, d, ...a) => _realSetInterval(f, Math.max(1, Math.floor(d / speedMult)), ...a);
        window.setTimeout  = (f, d, ...a) => _realSetTimeout(f,  Math.max(1, Math.floor(d / speedMult)), ...a);

        console.log('%c🚀 Timer x' + speedMult + ' active!', 'color:#ffd700;font-weight:bold;font-size:14px');
    }

    window.__autoSolve = autoSolve;
})();
