document.getElementById('startBtn').addEventListener('click', async () => {
    const speedMultiplier = parseInt(document.getElementById('speedInput').value) || 50;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    setStatus('Setting up...');

    // Step 1: Write speed to sessionStorage BEFORE reload
    await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: (speed) => {
            sessionStorage.setItem('__autoSolveSpeed', String(speed));
            console.log('%c[AutoSolver] Speed ' + speed + 'x saved. Reloading...', 'color:#ffd700;font-weight:bold');
        },
        args: [speedMultiplier]
    });

    setStatus('Reloading page...');

    // Step 2: Reload — interceptor.js (document_start) will:
    //   - wrap XHR before page JS runs
    //   - catch get-emp-skills-practice-test-by-id response
    //   - read __autoSolveSpeed from sessionStorage
    //   - call autoSolve() automatically
    await chrome.tabs.reload(tab.id);

    // Step 3: Poll to update popup status only
    let attempts = 0;
    const poll = setInterval(async () => {
        attempts++;
        if (attempts > 40) {
            clearInterval(poll);
            setStatus('⚠️ Timed out. Check console (F12).');
            return;
        }
        try {
            const r = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                world: "MAIN",
                func: () => ({
                    hasData: !!window.quizData,
                    count: window.quizData?.length || 0,
                    done: !sessionStorage.getItem('__autoSolveSpeed')
                })
            });
            const { hasData, count, done } = r[0].result;
            if (done && hasData) {
                clearInterval(poll);
                setStatus('✅ Done! Solved ' + count + ' questions.');
            } else if (hasData) {
                setStatus('🎯 Solving ' + count + ' questions...');
            } else {
                setStatus('Waiting for API data... (' + attempts + '/40)');
            }
        } catch (e) {
            setStatus('Page loading... (' + attempts + '/40)');
        }
    }, 500);
});

function setStatus(msg) {
    document.getElementById('status').textContent = 'Status: ' + msg;
}