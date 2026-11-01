/* Quality Buttons: independent full-card button layout, no Controller overrides. */
(function (root) {
    'use strict';
    if (root.__qualityButtonsLoaded || !root.Lampa || !root.Lampa.Listener
        || !root.Lampa.Storage) return;
    var L = root.Lampa;
    // Keep the old layout as a migration fallback; new movie/TV edits are
    // isolated so editing a series can never overwrite a movie layout.
    var legacyStorageKey = 'quality_module_buttons_v1';
    var storageKeyPrefix = 'quality_module_buttons_v2_';
    var profile = 'movie';
    var owner = null, ownerComponent = null, ownerStart = null, catalog = [], pencil = null, folderNodes = [];
    var initialFocusNode = null, initialFocusSettled = false;
    var observer = null, scheduled = false;
    var nativeSources = null, nativeSourceHome = null, nativeSourceHidden = true;
    var originalSelectors = typeof WeakMap === 'function' ? new WeakMap() : null;
    var knownNodes = typeof WeakMap === 'function' ? new WeakMap() : null;
    var $ = root.jQuery || root.$;
    function getOption(name, fallback) {
        try {
            var value = L.Storage.get(name, fallback);
            return value === undefined || value === null ? fallback : value;
        } catch (e) { return fallback; }
    }
    function pencilEnabled() {
        var value = getOption('quality_buttons_pencil', false);
        return value === true || String(value) === 'true';
    }
    function profileFromFull(event) {
        var movie = event && event.data && event.data.movie;
        if (!movie && event && event.props && typeof event.props.get === 'function')
            movie = event.props.get('movie');
        // Lampa Full receives a TMDB TV entry with first_air_date/name.
        // Film entries use title/release_date instead.
        return movie && (movie.first_air_date || (movie.name && !movie.title))
            ? 'tv' : 'movie';
    }
    function model() {
        var value = getOption(storageKeyPrefix + profile, null);
        if (value === null) value = getOption(legacyStorageKey, {});
        if (typeof value === 'string') {
            try { value = JSON.parse(value); } catch (e) { value = {}; }
        }
        if (!value || typeof value !== 'object') value = {};
        return {
            order: Array.isArray(value.order) ? value.order.slice(0, 150) : [],
            hidden: value.hidden && typeof value.hidden === 'object' ? value.hidden : {},
            modes: value.modes && typeof value.modes === 'object' ? value.modes : {},
            folders: Array.isArray(value.folders) ? value.folders.slice(0, 20) : []
        };
    }
    function save(value) { L.Storage.set(storageKeyPrefix + profile, value); }
    function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
    function currentFull() {
        if (!L.Activity || typeof L.Activity.active !== 'function') return null;
        try {
            var active = L.Activity.active();
            return active && active.component === 'full' ? active : null;
        } catch (e) { return null; }
    }
    function isCurrent(node) {
        var active = currentFull();
        if (!node || !node.length || !active || !active.activity) return false;
        // A full:complite event's body is the Full component's HTML.
        // ActivitySlide.render() instead returns an OUTER activity slide.
        // Comparing those DOM roots rejected every delayed plugin update.
        // Compare the component identity first: it cannot match a later
        // film or a different Activity (protecting remote/controller focus).
        if (ownerComponent && active.activity.component)
            return active.activity.component === ownerComponent;
        // Older Lampa forks may not expose ActivitySlide.component.
        try {
            if (typeof active.activity.render !== 'function') return false;
            var rendered = active.activity.render();
            var element = rendered && (rendered[0] || rendered);
            return !!(element && (element === node[0]
                || (typeof element.contains === 'function' && element.contains(node[0]))));
        } catch (e) { return false; }
    }
    function buttonId(button, used) {
        var previous = button.attr('data-quality-buttons-id');
        if (previous) return previous;
        var classes = clean(button.attr('class')).split(' ');
        var names = [];
        for (var i = 0; i < classes.length; i++)
            if (/^(?:view--|button--|lampac--|modss--|showy--|shots-)/.test(classes[i]))
                names.push(classes[i]);
        var key = names.join('.') || clean(button.find('span').first().text()).slice(0, 50);
        if (!key) key = 'custom-button';
        var id = 'b:' + key;
        var count = used[id] || 0;
        used[id] = count + 1;
        if (count) id += ':' + count;
        button.attr('data-quality-buttons-id', id);
        return id;
    }
    // Controller.collectionSet() scans .selector, and collectionFocus()
    // may choose the FIRST .selector even if another plugin hid it via CSS.
    // Temporarily remove navigation eligibility from hidden actions, and
    // grant it to exposed native actions that lack it (e.g. torrents).
    function navigable(node, allowed) {
        if (!node || !node.length) return;
        var raw = node[0];
        if (originalSelectors && raw && !originalSelectors.has(raw))
            originalSelectors.set(raw, node.hasClass('selector'));
        node.toggleClass('selector', !!allowed);
    }
    function restoreSelector(node) {
        if (!node || !node.length || !originalSelectors) return;
        var raw = node[0];
        if (raw && originalSelectors.has(raw))
            node.toggleClass('selector', originalSelectors.get(raw));
    }
    function focusCandidate() {
        if (!owner || !owner.length) return null;
        // The native DOM order differs from the visible CSS "order". Using
        // .find(...).first() always selected Bookmarks before an earlier
        // user-positioned Online button. Rank actual visible actions instead.
        var items = [], position = 0, layout = model();
        function candidate(node) {
            if (!node || !node.length || !node.hasClass('selector')
                || node.hasClass('hide') || node.hasClass('quality-buttons-hidden')
                || node.hasClass('quality-buttons-in-folder')
                || node.hasClass('quality-buttons-play-hidden')) return;
            var raw = node[0];
            if (!raw || !owner[0] || !owner[0].contains
                || !owner[0].contains(raw)) return;
            var id = node.attr('data-quality-buttons-id');
            var index = layout.order.indexOf(id);
            var value = layout.order.length
                ? (index >= 0 ? index : 1000 + position)
                : Number(node.css('order')) || 0;
            items.push({node:raw, order:value, position:position++});
        }
        catalog.forEach(function (entry) { candidate(entry.node); });
        folderNodes.forEach(candidate);
        candidate(pencil);
        items.sort(function (a,b) { return a.order-b.order || a.position-b.position; });
        return items.length ? items[0].node : null;
    }
    function ensureFocusCandidate() {
        if (!ownerStart) return;
        var previous = ownerStart.last;
        if (previous) {
            var button = $(previous);
            if (button.hasClass('selector') && !button.hasClass('hide')
                && !button.hasClass('quality-buttons-hidden')
                && !button.hasClass('quality-buttons-in-folder')
                && !button.hasClass('quality-buttons-play-hidden')
                && owner && owner[0] && owner[0].contains
                && owner[0].contains(previous)) return;
        }
        ownerStart.last = focusCandidate();
    }
    function refreshNativeNavigation() {
        if (!owner || !isCurrent(owner) || !L.Controller
            || typeof L.Controller.enabled !== 'function'
            || typeof L.Controller.toggle !== 'function') return;
        var active = L.Controller.enabled();
        // Only the actual Full controller may rebuild its selector collection.
        // Never touch a Select, Settings, Player, or another plugin's controller.
        if (active && active.name === 'full_start'
            && active.controller && active.controller.link === ownerStart) {
            ensureFocusCandidate();
            L.Controller.toggle('full_start');
        }
    }
    // Lampa puts native torrent/online/trailer buttons in the hidden
    // .buttons--container. The visible Play button merely opens a "Source"
    // Select built from those originals. Move THE CONTAINER, not cloned
    // buttons, into the toolbar: native handlers and onWatch() queries remain.
    function restoreNativeSources(view) {
        // Lampa remembers the last focused element on full-start. If that
        // element is about to become hidden again, restore a visible target.
        if (ownerStart && nativeSources && nativeSources.length && ownerStart.last) {
            var wasSource = false;
            nativeSources.children('.full-start__button').each(function () {
                if (this === ownerStart.last) wasSource = true;
            });
            if (wasSource) {
                var play = view && view.length ? view.find('.button--play').first() : null;
                ownerStart.last = play && play.length && !play.hasClass('hide')
                    ? play[0] : null;
            }
        }
        if (view && view.length) {
            view.find('.full-start-new__buttons').first().removeClass('quality-buttons-ungrouped');
            var play = view.find('.button--play').first();
            play.removeClass('quality-buttons-play-hidden');
            restoreSelector(play);
        }
        if (nativeSources && nativeSources.length) {
            nativeSources.children('.full-start__button').off('.qualityButtonsFocus')
                .each(function () { restoreSelector($(this)); });
            nativeSources.removeClass('quality-buttons-native-sources');
            if (nativeSourceHidden) nativeSources.addClass('hide');
            else nativeSources.removeClass('hide');
            if (nativeSourceHome && nativeSourceHome.length)
                nativeSourceHome.append(nativeSources);
        }
        nativeSources = null;
        nativeSourceHome = null;
    }
    function revealNativeSources(view) {
        var line = view.find('.full-start-new__buttons').first();
        var holder = view.find('.buttons--container').first();
        if (!line.length || !holder.length) return;
        // The holder can be empty during full:complite. Keep it ungrouped
        // anyway: async Online plugins populate it later. Otherwise the
        // native "Source" picker reappears randomly between cards.
        if (!nativeSources || nativeSources[0] !== holder[0]) {
            if (nativeSources) restoreNativeSources(owner);
            nativeSources = holder;
            nativeSourceHome = holder.parent();
            nativeSourceHidden = holder.hasClass('hide');
        }
        // Reparent only once; repeated refreshes must not disrupt focus.
        if (holder.parent()[0] !== line[0]) line.append(holder);
        holder.removeClass('hide').addClass('quality-buttons-native-sources');
        line.addClass('quality-buttons-ungrouped');
        holder.children('.full-start__button').each(function () {
            if (!$(this).hasClass('hide')) navigable($(this), true);
        });
        var play = view.find('.button--play').first();
        play.addClass('quality-buttons-play-hidden');
        navigable(play, false);
    }
    function rememberNativeSourceFocus() {
        if (!nativeSources || !nativeSources.length || !ownerStart) return;
        // Start.create() wired focus tracking before the hidden source buttons
        // were exposed. Listen only to these existing buttons, namespaced to
        // remove our handlers on disable without affecting other plugins.
        nativeSources.children('.full-start__button').each(function () {
            $(this).off('.qualityButtonsFocus').on(
                'hover:focus.qualityButtonsFocus hover:enter.qualityButtonsFocus '
                + 'hover:hover.qualityButtonsFocus hover:touch.qualityButtonsFocus',
                function () {
                    if (ownerStart && isCurrent(owner))
                        ownerStart.last = this;
                }
            );
        });
    }
    function readButtons(view) {
        if (!$ || !view || !view.length) return [];
        var line = view.find('.full-start-new__buttons').first();
        if (!line.length) return [];
        var used = {}, items = [];
        var excluded = '.quality-buttons-pencil,.quality-buttons-folder,.button--play,'
            + '.button--edit-order,.button--folder,.hide';
        function addButtons(buttons) {
            buttons.not(excluded).each(function () {
                var btn = $(this);
                var id = buttonId(btn, used);
                var title = clean(btn.find('span').first().text())
                    || clean(btn.find('.full-start__text').first().text())
                    || clean(btn.attr('data-title')) || clean(btn.attr('aria-label'))
                    || clean(btn.attr('title')) || clean(btn.attr('data-subtitle'))
                    || id.replace(/^b:/, '').replace(/[._-]/g,' ');
                items.push({id:id, title:title, node:btn});
            });
        }
        // Third-party plugins frequently use .selector without the native
        // .full-start__button class (or append AFTER full:complite).
        // Keep the scan scoped to the button row and the native source holder.
        addButtons(line.children('.full-start__button, .selector'));
        addButtons(line.children('.buttons--container')
            .children('.full-start__button, .selector'));
        return items;
    }
    function findCatalog(id) {
        for (var i = 0; i < catalog.length; i++)
            if (catalog[i].id === id) return catalog[i];
        return null;
    }
    function orderedCatalog(layout) {
        // The editor must display the SAME order as the visible toolbar,
        // rather than reintroducing native DOM order on each new card.
        return catalog.map(function (entry, index) {
            var saved = layout.order.indexOf(entry.id);
            var nativeOrder = Number(entry.node.css('order'));
            return {entry:entry, position:index,
                order:layout.order.length
                    ? (saved >= 0 ? saved : 1000 + index)
                    : (isFinite(nativeOrder) ? nativeOrder : 0)};
        }).sort(function (a,b) {
            return a.order - b.order || a.position - b.position;
        }).map(function (item) { return item.entry; });
    }
    function groupFor(layout, id) {
        for (var i = 0; i < layout.folders.length; i++)
            if (Array.isArray(layout.folders[i].members)
                && layout.folders[i].members.indexOf(id) >= 0) return layout.folders[i];
        return null;
    }
    function makeFolder(line, folder, layout, order, previousNodes) {
        if (!$ || !folder || !Array.isArray(folder.members)) return;
        var members = folder.members.filter(function (id) { return !!findCatalog(id); });
        if (!members.length) return;
        // Reuse existing folder buttons. Recreating a focused .selector during
        // a layout update makes Lampa.Start.last refer to a detached element.
        var node = null;
        (previousNodes || []).forEach(function (previous) {
            if (previous.attr('data-quality-folder-id') === folder.id) node = previous;
        });
        if (!node) {
            node = $('<div class="full-start__button selector quality-buttons-folder">'
                + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">'
                + '<path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>'
                + '<span></span></div>');
            node.attr('data-quality-folder-id', folder.id);
            line.append(node);
        }
        node.find('span').text(folder.title);
        node.css('order', order);
        node.off('.qualityButtonsFolder');
        node.on('hover:focus.qualityButtonsFolder hover:hover.qualityButtonsFolder '
            + 'hover:touch.qualityButtonsFolder', function () {
            if (ownerStart && isCurrent(owner)) ownerStart.last = node[0];
        });
        node.on('hover:enter.qualityButtonsFolder', function () {
            var captured = owner;
            var options = members.map(function (id) {
                return {title: (findCatalog(id) || {}).title || id, id: id};
            });
            select(folder.title, options, function (item) {
                if (!isCurrent(captured)) return;
                var selected = findCatalog(item && item.id);
                if (!selected || !selected.node || !selected.node.length) return;
                setTimeout(function () {
                    var current = L.Controller && L.Controller.enabled
                        ? L.Controller.enabled() : null;
                    if (isCurrent(captured) && current && current.name === 'full_start')
                        selected.node.trigger('hover:enter');
                }, 0);
            });
        });
        folderNodes.push(node);
    }
    function clearGenerated() {
        if (pencil) { pencil.remove(); pencil = null; }
        folderNodes.forEach(function (node) { node.remove(); });
        folderNodes = [];
    }
    function restore(view) {
        if (!view || !view.length) return;
        clearGenerated();
        // Source actions can be nested inside the native holder.
        catalog.forEach(function (entry) {
            var raw = entry.node && entry.node[0];
            entry.node.removeClass('quality-buttons-hidden quality-buttons-in-folder quality-buttons-mode-minimal quality-buttons-mode-full');
            restoreSelector(entry.node);
            if (raw && knownNodes && knownNodes.has(raw) && raw.style)
                raw.style.order = knownNodes.get(raw);
        });
        restoreNativeSources(view);
    }
    function apply(view) {
        if (!$ || !view || !view.length) return;
        var line = view.find('.full-start-new__buttons').first();
        if (!line.length) return;
        // Keep the pencil DOM node stable across layout refreshes so
        // Lampa.Start.last never points at a deleted navigation target.
        var previousFolders = folderNodes;
        folderNodes = [];
        if (!pencilEnabled() && pencil) {
            if (ownerStart && ownerStart.last === pencil[0]) ownerStart.last = null;
            pencil.remove();
            pencil = null;
        }
        revealNativeSources(view);
        catalog = readButtons(view);
        var layout = model();
        var order = layout.order, maxOrder = 1000;
        catalog.forEach(function (entry, index) {
            var node = entry.node, raw = node[0];
            if (knownNodes && raw && !knownNodes.has(raw))
                knownNodes.set(raw, raw.style ? raw.style.order : '');
            var pos = order.indexOf(entry.id);
            // Until a user customizes ordering, preserve native / plugin CSS.
            if (order.length) node.css('order', pos >= 0 ? pos : maxOrder + index);
            else if (knownNodes && raw) node.css('order', knownNodes.get(raw));
            var visible = !layout.hidden[entry.id] && !groupFor(layout, entry.id)
                && !node.hasClass('hide');
            node.toggleClass('quality-buttons-hidden', !!layout.hidden[entry.id]);
            node.toggleClass('quality-buttons-in-folder', !!groupFor(layout, entry.id));
            navigable(node, visible);
            node.toggleClass('quality-buttons-mode-minimal', layout.modes[entry.id] === 2);
            node.toggleClass('quality-buttons-mode-full', layout.modes[entry.id] === 3);
        });
        layout.folders.forEach(function (folder, idx) {
            makeFolder(line, folder, layout, maxOrder + catalog.length + idx, previousFolders);
        });
        previousFolders.forEach(function (node) {
            var present = folderNodes.some(function (current) { return current[0] === node[0]; });
            if (!present) {
                if (ownerStart && ownerStart.last === node[0]) ownerStart.last = null;
                node.remove();
            }
        });
        if (pencilEnabled()) {
            if (!pencil) {
                pencil = $('<div class="full-start__button selector quality-buttons-pencil" title="Настройка кнопок">'
                    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
                    + '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>'
                    + '<span>Кнопки</span></div>');
                pencil.on('hover:enter', openEditor);
                pencil.on('hover:focus hover:hover hover:touch', function () {
                    if (ownerStart && isCurrent(owner)) ownerStart.last = pencil[0];
                });
                line.append(pencil);
            }
            pencil.css('order', maxOrder + catalog.length + layout.folders.length + 1);
        }
        ensureFocusCandidate();
    }
    function safeApply() {
        if (!owner || !isCurrent(owner)) return;
        // Our own pencil/folder edits change childList. Suspend observation
        // during layout updates to prevent a perpetual refresh loop.
        var previouslyFocused = ownerStart && ownerStart.last;
        if (observer) observer.disconnect();
        try {
            apply(owner);
            rememberNativeSourceFocus();
            // A preferred source may arrive AFTER Full toggles and initially
            // focuses the fallback button. Correct it exactly while the user
            // has not moved away from that first focus; never steal focus
            // during normal remote navigation or from other controllers.
            if (!initialFocusSettled && ownerStart) {
                if (previouslyFocused !== initialFocusNode) initialFocusSettled = true;
                else {
                    var first = focusCandidate();
                    if (first && first !== previouslyFocused) {
                        ownerStart.last = first;
                        initialFocusNode = first;
                    }
                }
            }
        } catch (e) { /* other plugins may destroy the view */ }
        observeButtons();
        refreshNativeNavigation();
    }
    function rerender() {
        if (owner && isCurrent(owner)) safeApply();
    }
    function change(fn) {
        var value = model();
        fn(value);
        save(value);
        rerender();
    }
    // Lampa.Select.bind() calls hide() BEFORE onSelect, leaving Controller
    // active as "select". Reopening a menu immediately would make the new
    // Select window's "below" controller point to that now-hidden select,
    // trapping Back in Settings. Restore the genuine native controller first,
    // as Lampa.Settings.Params does for its own select fields.
    var editorReturnController = '';
    function restoreEditorController(name) {
        if (!name || name === 'select' || !L.Controller
            || typeof L.Controller.enabled !== 'function'
            || typeof L.Controller.toggle !== 'function') return;
        var active = L.Controller.enabled();
        if (active && active.name === 'select') L.Controller.toggle(name);
    }
    function select(title, items, onSelect, onBack) {
        if (!L.Select || typeof L.Select.show !== 'function') return;
        var current = L.Controller && typeof L.Controller.enabled === 'function'
            ? L.Controller.enabled() : null;
        var origin = current && current.name;
        if (origin && origin !== 'select') editorReturnController = origin;
        else {
            // Never replace an actual open Select owned by another plugin.
            // The fallback is only for a controller orphaned after hide().
            if (L.Select.opened && L.Select.opened()) return;
            origin = editorReturnController;
            if (!origin) return;
            restoreEditorController(origin);
        }
        L.Select.show({
            title: title, items: items,
            onSelect: function (item) {
                restoreEditorController(origin);
                if (onSelect) onSelect(item);
            },
            onBack: function () {
                restoreEditorController(origin);
                if (onBack) onBack();
            }
        });
    }
    function editButton(id) {
        var entry = findCatalog(id), layout = model();
        if (!entry) return;
        var folder = groupFor(layout, id);
        select(entry.title, [
            {title:'Переместить выше', action:'up'},
            {title:'Переместить ниже', action:'down'},
            {title:layout.hidden[id] ? 'Показать кнопку' : 'Скрыть кнопку', action:'visibility'},
            {title:'Текст: стандартный / иконка / всегда', subtitle:'Режим ' + (layout.modes[id] || 1), action:'mode'},
            {title:folder ? 'Убрать из папки' : 'Поместить в папку', action:'folder'}
        ], function (chosen) {
            if (!chosen) return;
            if (chosen.action === 'folder') {
                var value = model();
                var entries = [{title:'Без папки', id:''}].concat(value.folders.map(function (f) {
                    return {title:f.title, id:f.id};
                }));
                select('Папка для «' + entry.title + '»', entries, function (pick) {
                    change(function (v) {
                        v.folders.forEach(function (f) {
                            f.members = (f.members || []).filter(function (x) { return x !== id; });
                            if (pick && pick.id === f.id) f.members.push(id);
                        });
                    });
                    openEditor();
                });
                return;
            }
            change(function (v) {
                if (chosen.action === 'visibility') v.hidden[id] = !v.hidden[id];
                if (chosen.action === 'mode') v.modes[id] = (v.modes[id] || 1) % 3 + 1;
                if (chosen.action === 'up' || chosen.action === 'down') {
                    var present = orderedCatalog(v).map(function (b) { return b.id; });
                    if (!v.order.length) v.order = present.slice();
                    // Preserve IDs of buttons absent from THIS movie/series.
                    // Otherwise editing a sparse card loses their positions.
                    present.forEach(function (key) {
                        if (v.order.indexOf(key) < 0) v.order.push(key);
                    });
                    var index = present.indexOf(id);
                    var neighbor = present[index + (chosen.action === 'up' ? -1 : 1)];
                    if (neighbor) {
                        var here = v.order.indexOf(id), there = v.order.indexOf(neighbor);
                        v.order[here] = neighbor;
                        v.order[there] = id;
                    }
                }
            });
            openEditor();
        });
    }
    function createFolder() {
        if (!L.Input || typeof L.Input.edit !== 'function') return;
        var origin = editorReturnController;
        L.Input.edit({title:'Название папки',value:'',free:true,nosave:true,nomic:true},
            function (text) {
                // Native Settings.Input.back() returns to settings_component.
                // The editor's pencil can originate from Full instead.
                if (origin === 'full_start' && isCurrent(owner) && L.Controller
                    && typeof L.Controller.enabled === 'function'
                    && typeof L.Controller.toggle === 'function') {
                    var current = L.Controller.enabled();
                    if (current && current.name === 'settings_component')
                        L.Controller.toggle('full_start');
                }
                var title = clean(text).slice(0, 50);
                if (!title) return;
                change(function (value) {
                    value.folders.push({id:'f:' + Date.now().toString(36),title:title,members:[]});
                });
                openEditor();
            });
    }
    function openEditor() {
        if (!catalog.length) {
            if (L.Noty && L.Noty.show) L.Noty.show('Сначала откройте полную карточку фильма');
            return;
        }
        var layout = model(), options = orderedCatalog(layout).map(function (b) {
            return {title:b.title, id:b.id, subtitle:
                (layout.hidden[b.id] ? 'Скрыта • ' : '') + 'Режим ' + (layout.modes[b.id] || 1)
                + (groupFor(layout, b.id) ? ' • В папке' : '')};
        });
        layout.folders.forEach(function (f) {
            options.push({title:'Папка: ' + f.title, action:'deleteFolder',id:f.id,
                subtitle:'Удалить папку (кнопки сохранятся)'});
        });
        options.push({title:'Создать папку',action:'newFolder'});
        options.push({title:'Сбросить расположение',action:'reset'});
        select('Настройка кнопок', options, function (item) {
            if (!item) return;
            if (item.action === 'newFolder') return createFolder();
            if (item.action === 'reset') {
                save({order:[],hidden:{},modes:{},folders:[]});
                rerender();
                return openEditor();
            }
            if (item.action === 'deleteFolder') {
                change(function (v) { v.folders = v.folders.filter(function (f) {
                    return f.id !== item.id;
                }); });
                return openEditor();
            }
            editButton(item.id);
        });
    }
    function observeButtons() {
        if (!observer || !owner || !owner.length) return;
        var area = owner.find('.full-start-new__buttons')[0];
        if (area) observer.observe(area, {childList:true,subtree:false});
        // Other plugins can add native Online sources after full:complite.
        // Observe only the holder's direct children; our refresh disconnects
        // before DOM changes to prevent observer feedback loops.
        var holder = owner.find('.buttons--container')[0];
        if (holder) observer.observe(holder, {
            childList:true, subtree:true, attributes:true,
            attributeFilter:['class']
        });
    }
    function bindFull(event) {
        if (!event || event.type !== 'complite' || !event.body) return;
        var node = $(event.body[0] || event.body);
        if (!node.length || !node.find('.full-start-new__buttons').length) return;
        if (observer) { observer.disconnect(); observer = null; }
        if (owner && owner[0] !== node[0]) restore(owner);
        owner = node;
        ownerComponent = event.link || null;
        ownerStart = event.link && event.link.items && event.link.items[0] || null;
        profile = profileFromFull(event);
        apply(node);
        rememberNativeSourceFocus();
        // Lampa's native full-start controller has not yet been toggled when
        // full:complite fires. Avoid a stale remembered focus on hidden Play.
        var play = node.find('.button--play').first();
        // The first focus on a NEW card always follows the saved visual
        // order. On later refreshes ensureFocusCandidate preserves the user's
        // current focused button instead of stealing the remote.
        if (ownerStart) ownerStart.last = focusCandidate();
        initialFocusNode = ownerStart ? ownerStart.last : null;
        initialFocusSettled = false;
        if (typeof MutationObserver === 'function') {
            var area = node.find('.full-start-new__buttons')[0];
            observer = new MutationObserver(function () {
                if (scheduled) return;
                scheduled = true;
                setTimeout(function () {
                    scheduled = false;
                    if (isCurrent(node)) safeApply();
                }, 100);
            });
            observeButtons();
        }
    }
    function init() {
        if (!$) return;
        var css = document.createElement('style');
        css.textContent = '.quality-buttons-hidden,.quality-buttons-in-folder{display:none!important;}'
            + '.full-start-new__buttons.quality-buttons-ungrouped{flex-wrap:wrap;}'
            + '.full-start-new__buttons .buttons--container.quality-buttons-native-sources{display:flex!important;'
            + 'flex-wrap:wrap;align-items:center;}'
            + '@supports (display:contents){'
            + '.full-start-new__buttons .buttons--container.quality-buttons-native-sources{display:contents!important;}}'
            + '.full-start-new__buttons.quality-buttons-ungrouped>.button--play.quality-buttons-play-hidden{display:none!important;}'
            + '.quality-buttons-mode-minimal>span{display:none!important;}'
            + '.quality-buttons-mode-full>span{display:inline!important;}'
            + '.quality-buttons-pencil,.quality-buttons-folder{cursor:pointer;}';
        (document.head || document.documentElement).appendChild(css);
        L.Listener.follow('full',bindFull);
        if (L.Storage.listener && L.Storage.listener.follow)
            L.Storage.listener.follow('change',function (e) {
                if (!e) return;
                if (e.name === 'quality_buttons_pencil') rerender();
            });
    }
    root.LampaQualityButtons = {refresh:rerender,
        status:function () { return {loaded:true,
            pencil:pencilEnabled(),profile:profile,known_buttons:catalog.length,
            folders:model().folders.length}; }};
    root.__qualityButtonsLoaded = true;
    if (document.body) init();
    else document.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : globalThis);
