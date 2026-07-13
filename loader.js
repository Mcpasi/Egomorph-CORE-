

(function() {
    // 1. Konfiguration
    const CONFIG = {
        title: "EGOMORPH",
        version: "2026-07-13 Beta",
        description: "Initialisiere Systemkerne...",
        duration: 1600,
        failsafe: 9000
    };


    const splashHTML = `
        <div class="ego-morph-container">
            <div class="ego-shape"></div>
        </div>
        <h1 class="ego-title">${CONFIG.title}</h1>
        <div class="ego-version">${CONFIG.version}</div>
        <p class="ego-desc">${CONFIG.description}</p>
        <div class="ego-loader">
            <div class="ego-progress"></div>
        </div>
    `;

    // 3. Das Container-Element erzeugen
    if (document.getElementById('egomorph-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'egomorph-overlay';
    overlay.innerHTML = splashHTML;


    document.body.prepend(overlay);
    
    // Damit man während des Ladens nicht scrollen kann
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';


    const startedAt = Date.now();
    let dismissScheduled = false;
    function dismissOverlay() {
        if (dismissScheduled) return;
        dismissScheduled = true;
        const remaining = Math.max(0, CONFIG.duration - (Date.now() - startedAt));
        setTimeout(() => {
            overlay.classList.add('ego-hidden');
            document.body.style.overflow = originalOverflow;
            setTimeout(() => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }, 800);
        }, remaining);
    }

    if (document.readyState === 'complete') {
        dismissOverlay();
    } else {
        window.addEventListener('load', dismissOverlay, { once: true });
    }
    // A hanging third-party resource must not trap the user behind the splash.
    setTimeout(dismissOverlay, CONFIG.failsafe);

})();
