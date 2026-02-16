(function () {
    if (window.__quizInterceptorInstalled) return;
    window.__quizInterceptorInstalled = true;
    window.quizData = null;

    console.log('%c[AutoSolver] ✓ Ready', 'color:#4CAF50;font-weight:bold');

    const _realSetTimeout  = window.setTimeout.bind(window);
    const _realSetInterval = window.setInterval.bind(window);
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
                // Use a Case-Insensitive regex to catch the URL reliably
                const isQuizApi = /questions-by-id|get-emp-skills|practice-test/i.test(_url);
                if (!isQuizApi) return;

                try {
                    const json = JSON.parse(xhr.responseText);
                    
                    // Look for questions in multiple possible JSON locations
                    const questions = json?.questions || json?.data?.questions || json?.payload?.questions;

                    if (Array.isArray(questions) && !window.quizData) {
                        window.quizData = questions;
                        console.log('%c✅ Captured ' + questions.length + ' questions!', 'color:#4CAF50;font-weight:bold;font-size:14px');

                        const speed = parseInt(sessionStorage.getItem('__autoSolveSpeed') || '0');
                        if (speed > 0) {
                            console.log('%c🎯 Starting Auto-Solve...', 'color:#2196F3;font-weight:bold');
                            _realSetTimeout(() => window.__autoSolve(speed), 1000);
                        }
                    }
                } catch (e) { /* Not a JSON response, ignore safely */ }
            });
            return OrigXHR.prototype.send.apply(xhr, args);
        };
        return xhr;
    }
    Object.setPrototypeOf(PatchedXHR.prototype, OrigXHR.prototype);
    Object.defineProperty(window, 'XMLHttpRequest', { value: PatchedXHR, writable: true, configurable: true });

    // ── Text Normalization & Matching ──────────────────────────────────────────
    function normalize(t) {
        return String(t || '').toLowerCase().trim()
            .replace(/\s+/g, ' ')
            .replace(/[–—−]/g, '-')
            .replace(/[''""]/g, '')
            .replace(/\.(?!\d)/g, '')
            .trim();
    }

    function smartMatch(optionText, answer) {
        const a = normalize(answer);
        const o = normalize(optionText);
        if (o === a || (o.includes(a) && a.length > 2)) return true;
        const sa = a.replace(/[^a-z0-9]/g, ''), so = o.replace(/[^a-z0-9]/g, '');
        return sa === so && sa.length > 0;
    }

    // ── Helper functions for DOM ──────────────────────────────────────────────
    function waitForNewQuestion(prevText) {
        return new Promise((resolve) => {
            const start = Date.now();
            const check = () => {
                const qEl = document.querySelector('p, h2, h3, [class*="question"]');
                const cur = qEl ? qEl.textContent.trim().slice(0, 40) : '';
                if ((cur && cur !== prevText) || Date.now() - start > 2500) resolve();
                else _realSetTimeout(check, 100);
            };
            check();
        });
    }

    function waitForOptions() {
        return new Promise((resolve) => {
            const start = Date.now();
            const check = () => {
                const found = document.querySelectorAll('input[type="radio"]').length > 0;
                if (found || Date.now() - start > 2000) resolve(found);
                else _realSetTimeout(check, 100);
            };
            check();
        });
    }

    function tryClick(answer) {
        // Strategy 1: Radios
        for (let r of document.querySelectorAll('input[type="radio"]')) {
            const lbl = document.querySelector(`label[for="${r.id}"]`) || r.closest('label') || r.parentElement;
            if (lbl && smartMatch(lbl.textContent, answer)) {
                r.click();
                r.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
        }
        // Strategy 2: Clickable Divs/Spans
        for (let el of document.querySelectorAll('[class*="option"], [class*="choice"], li, span, p')) {
            if (el.children.length <= 2 && smartMatch(el.textContent, answer)) {
                el.click();
                return true;
            }
        }
        return false;
    }

    // ── The Solver ────────────────────────────────────────────────────────────
    window.__autoSolve = async function (speedMult) {
        if (!window.quizData) return;
        
        for (let i = 0; i < window.quizData.length; i++) {
            const q = window.quizData[i];
            await waitForOptions();
            
            let clicked = false;
            for (let attempt = 0; attempt < 3; attempt++) {
                clicked = tryClick(q.answer);
                if (clicked) break;
                await wait(200);
            }

            await wait(100);
            if (i < window.quizData.length - 1) {
                const qEl = document.querySelector('p, h2, h3, [class*="question"]');
                const prevText = qEl ? qEl.textContent.trim().slice(0, 40) : '';
                const nextBtn = [...document.querySelectorAll('button')].find(b => /next/i.test(b.textContent));
                if (nextBtn) {
                    nextBtn.click();
                    await waitForNewQuestion(prevText);
                }
            }
        }

        // Timer boost at the very end
        sessionStorage.removeItem('__autoSolveSpeed');
        window.setInterval = (f, d, ...a) => _realSetInterval(f, Math.max(1, Math.floor(d / speedMult)), ...a);
        window.setTimeout  = (f, d, ...a) => _realSetTimeout(f,  Math.max(1, Math.floor(d / speedMult)), ...a);
        console.log('%c🚀 All questions solved. Timer accelerated!', 'color:#ffd700;font-weight:bold');
    };
})();
