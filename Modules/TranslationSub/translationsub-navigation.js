(function () {
    'use strict';

    if (window.__TranslationSubNavigationStarted) return;
    window.__TranslationSubNavigationStarted = true;

    var selectPatched = false;
    var suppressVoicesUntil = 0;
    var translationSelectOpen = false;
    var observer = null;
    var applyTimer = null;
    var repairTimer = null;

    function now() {
        return Date.now ? Date.now() : new Date().getTime();
    }

    function injectStyles() {
        if (document.getElementById('translationsub-navigation-style')) return;
        var style = document.createElement('style');
        style.id = 'translationsub-navigation-style';
        style.textContent =
            '.translationsub-menu-item .menu__ico svg{' +
                'width:100%!important;height:100%!important;fill:none!important;stroke:currentColor!important;' +
            '}' +
            '.translationsub-menu-item .menu__ico svg path{' +
                'fill:none!important;stroke:currentColor!important;' +
            '}';
        (document.head || document.documentElement).appendChild(style);
    }

    function isTranslationSelectTitle(title) {
        title = String(title || '').trim();
        return title === 'Выберите сезон' || title === 'Озвучки' || title.indexOf('Озвучки ·') === 0;
    }

    function isVoicesTitle(title) {
        title = String(title || '').trim();
        return title === 'Озвучки' || title.indexOf('Озвучки ·') === 0;
    }

    function activeComponent() {
        try {
            if (!window.Lampa || !Lampa.Activity || typeof Lampa.Activity.active !== 'function') return '';
            var active = Lampa.Activity.active() || {};
            return String(
                active.component ||
                (active.object && active.object.component) ||
                (active.activity && active.activity.component) ||
                ''
            ).toLowerCase();
        } catch (e) {
            return '';
        }
    }

    function isFullActive() {
        var component = activeComponent();
        if (component) return component === 'full';
        try { return $('.full-start:visible,.full-start-new:visible').length > 0; } catch (e) { return false; }
    }

    function closeSelect() {
        translationSelectOpen = false;
        try {
            if (window.Lampa && Lampa.Select && typeof Lampa.Select.close === 'function') Lampa.Select.close();
        } catch (e) {}
    }

    function restoreContentController() {
        try {
            if (window.Lampa && Lampa.Controller && typeof Lampa.Controller.toggle === 'function')
                Lampa.Controller.toggle('content');
        } catch (e) {}
    }

    function patchSelect() {
        if (selectPatched || !window.Lampa || !Lampa.Select || typeof Lampa.Select.show !== 'function') return;

        var originalShow = Lampa.Select.show;
        if (originalShow.__translationsubNavigationPatched) {
            selectPatched = true;
            return;
        }

        function patchedShow(options) {
            options = options || {};
            var title = String(options.title || '').trim();
            if (!isTranslationSelectTitle(title)) return originalShow.apply(Lampa.Select, arguments);

            if (!isFullActive()) return;
            if (isVoicesTitle(title) && now() < suppressVoicesUntil) return;

            var wrapped = {};
            Object.keys(options).forEach(function (key) { wrapped[key] = options[key]; });
            var originalSelect = options.onSelect;
            translationSelectOpen = true;

            wrapped.onSelect = function (item) {
                if (isVoicesTitle(title)) suppressVoicesUntil = now() + 5000;
                closeSelect();
                if (typeof originalSelect === 'function') return originalSelect(item);
            };

            wrapped.onBack = function () {
                if (isVoicesTitle(title)) suppressVoicesUntil = now() + 800;
                closeSelect();
                restoreContentController();
            };

            return originalShow.call(Lampa.Select, wrapped);
        }

        patchedShow.__translationsubNavigationPatched = true;
        patchedShow.__translationsubOriginalShow = originalShow;
        Lampa.Select.show = patchedShow;
        selectPatched = true;
    }

    function openNotice() {
        try {
            if (window.TranslationSubBadgeState && typeof window.TranslationSubBadgeState.open === 'function') {
                window.TranslationSubBadgeState.open();
                return;
            }
        } catch (e) {}

        try {
            if (window.TranslationSubNotice && typeof window.TranslationSubNotice.open === 'function') {
                window.TranslationSubNotice.open();
                return;
            }
        } catch (e2) {}
    }

    function openSubscriptions() {
        try {
            if (window.TranslationSubNotice && typeof window.TranslationSubNotice.openPage === 'function') {
                window.TranslationSubNotice.openPage();
                return;
            }
        } catch (e) {}

        try {
            if (window.TranslationSub && typeof window.TranslationSub.openSubscriptions === 'function')
                window.TranslationSub.openSubscriptions();
        } catch (e2) {}
    }

    function bindHead() {
        if (typeof $ !== 'function') return;
        $('.translationsub-head').each(function () {
            var button = $(this);
            button.off('hover:enter');
            button.on('hover:enter.translationsubNavigation', openNotice);
            button.attr('title', 'Уведомления озвучек');
        });
    }

    function menuIcon() {
        return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path>' +
            '<path d="M10 21h4"></path>' +
        '</svg>';
    }

    function mainMenuList() {
        if (typeof $ !== 'function') return $();
        var lists = $('.menu .menu__list');
        if (!lists.length) return $();

        var best = $();
        var bestScore = -1;
        lists.each(function () {
            var list = $(this);
            var score = list.find('.menu__item').length;
            if (list.find('[data-action="history"],[data-action="timetable"],[data-action="subscribes"],[data-action="settings"]').length)
                score += 100;
            if (list.is(':visible')) score += 20;
            if (score > bestScore) {
                bestScore = score;
                best = list;
            }
        });
        return best;
    }

    function ensureMenuItem() {
        if (typeof $ !== 'function') return;
        var menu = mainMenuList();
        if (!menu.length) return;

        $('.translationsub-menu-item').each(function () {
            if (!$.contains(menu[0], this)) $(this).remove();
        });

        var item = menu.find('.translationsub-menu-item').first();
        if (!item.length) {
            item = $('<li class="menu__item selector translationsub-menu-item" data-action="translationsub">' +
                '<div class="menu__ico">' + menuIcon() + '</div>' +
                '<div class="menu__text">Озвучки</div>' +
            '</li>');

            var anchor = menu.find('[data-action="subscribes"]').last();
            if (!anchor.length) anchor = menu.find('[data-action="timetable"]').last();
            if (!anchor.length) anchor = menu.find('[data-action="history"]').last();
            if (anchor.length) anchor.after(item);
            else menu.append(item);
        }

        item.find('.menu__text').first().text('Озвучки');
        item.off('hover:enter');
        item.on('hover:enter.translationsubNavigation', openSubscriptions);
    }

    function apply() {
        injectStyles();
        patchSelect();

        if (translationSelectOpen && !isFullActive()) {
            suppressVoicesUntil = now() + 800;
            closeSelect();
        }

        bindHead();
        ensureMenuItem();

        try {
            if (window.TranslationSubBadgeState && typeof window.TranslationSubBadgeState.render === 'function')
                window.TranslationSubBadgeState.render();
        } catch (e) {}
    }

    function scheduleApply(delay) {
        clearTimeout(applyTimer);
        applyTimer = setTimeout(apply, typeof delay === 'number' ? delay : 35);
    }

    function start() {
        if (!window.Lampa) return;
        apply();

        try {
            if (Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
                Lampa.Listener.follow('app', function (event) {
                    if (event && event.type === 'ready') scheduleApply(0);
                });
            }
        } catch (e) {}

        try {
            observer = new MutationObserver(function () { scheduleApply(35); });
            observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
        } catch (e2) {}

        if (repairTimer) clearInterval(repairTimer);
        repairTimer = setInterval(function () { scheduleApply(0); }, 10000);

        window.TranslationSubNavigation = {
            refresh: function () { scheduleApply(0); },
            openNotice: openNotice,
            openSubscriptions: openSubscriptions,
            closeSelect: closeSelect
        };
    }

    if (window.Lampa) start();
    else {
        var attempts = 0;
        var wait = setInterval(function () {
            attempts++;
            if (window.Lampa) {
                clearInterval(wait);
                start();
            } else if (attempts > 80) {
                clearInterval(wait);
            }
        }, 250);
    }
})();
