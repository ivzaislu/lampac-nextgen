(function () {
    'use strict';

    if (window.__TranslationSubNavigationStarted) return;
    window.__TranslationSubNavigationStarted = true;

    var observer = null;
    var applyTimer = null;

    function openNotice() {
        try {
            if (window.TranslationSubBadgeState && typeof window.TranslationSubBadgeState.open === 'function') {
                window.TranslationSubBadgeState.open();
                return;
            }
        } catch (e) {}
        openSubscriptions();
    }

    function openSubscriptions() {
        try {
            if (window.TranslationSub && typeof window.TranslationSub.openSubscriptions === 'function')
                window.TranslationSub.openSubscriptions();
        } catch (e) {}
    }

    function iconAnchor() {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"></svg>';
    }

    function ensureHeadButton() {
        if (typeof $ !== 'function') return;
        var row = $('.head__actions').first();
        if (!row.length) return;

        $('.translationsub-head').each(function () {
            if (!$.contains(row[0], this)) $(this).remove();
        });

        var button = row.find('.translationsub-head').first();
        if (!button.length) {
            button = $('<div class="head__action selector translationsub-head" title="Уведомления озвучек">' + iconAnchor() + '</div>');
            row.append(button);
        }

        button.attr('title', 'Уведомления озвучек');
        button.off('hover:enter.translationsubNavigation');
        button.on('hover:enter.translationsubNavigation', openNotice);
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
                '<div class="menu__ico">' + iconAnchor() + '</div>' +
                '<div class="menu__text">Озвучки</div>' +
            '</li>');

            var anchor = menu.find('[data-action="subscribes"]').last();
            if (!anchor.length) anchor = menu.find('[data-action="timetable"]').last();
            if (!anchor.length) anchor = menu.find('[data-action="history"]').last();
            if (anchor.length) anchor.after(item);
            else menu.append(item);
        }

        var text = item.find('.menu__text').first();
        if (text.text() !== 'Озвучки') text.text('Озвучки');
        item.off('hover:enter.translationsubNavigation');
        item.on('hover:enter.translationsubNavigation', openSubscriptions);
    }

    function apply() {
        ensureHeadButton();
        ensureMenuItem();

        try {
            if (window.TranslationSubBadgeState && typeof window.TranslationSubBadgeState.render === 'function')
                window.TranslationSubBadgeState.render();
        } catch (e) {}

        try {
            if (window.TranslationSubBellTheme && typeof window.TranslationSubBellTheme.refresh === 'function')
                window.TranslationSubBellTheme.refresh();
        } catch (e2) {}
    }

    function scheduleApply(delay) {
        clearTimeout(applyTimer);
        applyTimer = setTimeout(apply, typeof delay === 'number' ? delay : 35);
    }

    function relevantNode(node) {
        if (!node || node.nodeType !== 1 || typeof $ !== 'function') return false;
        var element = $(node);
        var selector = '.head,.head__actions,.menu,.menu__list,.translationsub-head,.translationsub-menu-item';
        return element.is(selector) || element.find(selector).length > 0;
    }

    function relevantMutations(mutations) {
        if (typeof $ !== 'function') return true;
        for (var i = 0; i < mutations.length; i++) {
            var mutation = mutations[i];
            if ($(mutation.target).closest('.head,.menu').length) return true;
            for (var j = 0; j < mutation.addedNodes.length; j++) {
                if (relevantNode(mutation.addedNodes[j])) return true;
            }
            for (var k = 0; k < mutation.removedNodes.length; k++) {
                if (relevantNode(mutation.removedNodes[k])) return true;
            }
        }
        return false;
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
            observer = new MutationObserver(function (mutations) {
                if (relevantMutations(mutations || [])) scheduleApply(35);
            });
            observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
        } catch (e2) {}
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
