/* ═══════════════════════════════════════════════════════
   PWA Install Banner
   ═══════════════════════════════════════════════════════ */
(function () {
    const DISMISS_KEY = 'pwa-install-dismissed';
    let deferredPrompt = null;

    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferredPrompt = e;

        if (localStorage.getItem(DISMISS_KEY) === '1') return;

        setTimeout(showBanner, 2500);
    });

    window.addEventListener('appinstalled', function () {
        deferredPrompt = null;
        localStorage.removeItem(DISMISS_KEY);
        var banner = document.getElementById('pwa-install-banner');
        if (banner) banner.remove();
    });

    function showBanner() {
        if (!deferredPrompt) return;
        if (document.getElementById('pwa-install-banner')) return;

        var banner = document.createElement('div');
        banner.id = 'pwa-install-banner';
        banner.className = 'pwa-install-banner';
        banner.innerHTML =
            '<div class="pwa-install-banner-left">' +
                '<div class="pwa-install-banner-icon"><i class="bx bx-download"></i></div>' +
                '<div class="pwa-install-banner-text">' +
                    '<span class="pwa-install-banner-title">Install Gradelytics</span>' +
                    '<span class="pwa-install-banner-sub">Add to your home screen for quick access</span>' +
                '</div>' +
            '</div>' +
            '<div class="pwa-install-banner-actions">' +
                '<button class="pwa-dismiss-btn" id="pwa-dismiss-btn" aria-label="Dismiss"><i class="bx bx-x"></i></button>' +
                '<button class="pwa-install-btn" id="pwa-accept-btn">Install</button>' +
            '</div>';

        document.body.appendChild(banner);
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                banner.classList.add('pwa-visible');
            });
        });

        document.getElementById('pwa-accept-btn').addEventListener('click', function () {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then(function (choice) {
                if (choice.outcome === 'accepted') {
                    banner.classList.remove('pwa-visible');
                    setTimeout(function () { banner.remove(); }, 400);
                }
                deferredPrompt = null;
            });
        });

        document.getElementById('pwa-dismiss-btn').addEventListener('click', function () {
            localStorage.setItem(DISMISS_KEY, '1');
            banner.classList.remove('pwa-visible');
            setTimeout(function () { banner.remove(); }, 400);
        });
    }
})();
