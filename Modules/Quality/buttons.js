/* Quality Buttons: independent full-card button layout, no Controller overrides. */
(function (root) {
    'use strict';
    if (root.__qualityButtonsLoaded || !root.Lampa || !root.Lampa.Listener
        || !root.Lampa.Storage) return;
    var L = root.Lampa;
    var storageKey = 'quality_module_buttons_v1';
    var owner = null, catalog = [], pencil = null, folderNodes = [];
    var observer = null, scheduled = false, settingsRegistered = false;
    var knownNodes = typeof WeakMap === 'function' ? new WeakMap() : null;
    var $ = root.jQuery || root.$;
    function getOption(name, fallback) {
        try {
            var value = L.Storage.get(name, fallback);
            return value === undefined || value === null ? fallback : value;
        } catch (e) { return fallback; }
    }
    function enabled() {
        var value = getOption('quality_buttons_enabled', true);
        return value !== false && String(value) !== 'false';
    }
    function pencilEnabled() {
        var value = getOption('quality_buttons_pencil', false);
        return value === true || String(value) === 'true';
    }
    function model() {
        var value = getOption(storageKey, {});
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
    function save(value) { L.Storage.set(storageKey, value); }
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
        if (!node || !active || !active.activity
            || typeof active.activity.render !== 'function') return false;
        try {
            var rendered = active.activity.render();
            var element = rendered && (rendered[0] || rendered);
            return !!(element && element === node[0]);
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
    function readButtons(view) {
        if (!$ || !view || !view.length) return [];
        var line = view.find('.full-start-new__buttons').first();
        if (!line.length) return [];
        var buttons = line.children('.full-start__button')
            .not('.quality-buttons-pencil,.quality-buttons-folder');
        var used = {}, items = [];
        buttons.each(function () {
            var btn = $(this);
            var id = buttonId(btn, used);
            items.push({id: id, title: clean(btn.find('span').first().text())
                || id.replace(/^b:/, '').replace(/[._-]/g, ' '), node: btn});
        });
        return items;
    }
    function findCatalog(id) {
        for (var i = 0; i < catalog.length; i++)
            if (catalog[i].id === id) return catalog[i];
        return null;
    }
    function groupFor(layout, id) {
        for (var i = 0; i < layout.folders.length; i++)
            if (Array.isArray(layout.folders[i].members)
                && layout.folders[i].members.indexOf(id) >= 0) return layout.folders[i];
        return null;
    }
    function makeFolder(line, folder, layout, order) {
        if (!$ || !folder || !Array.isArray(folder.members)) return;
        var members = folder.members.filter(function (id) { return !!findCatalog(id); });
        if (!members.length) return;
        var node = $('<div class="full-start__button selector quality-buttons-folder"><span></span></div>');
        node.find('span').text(folder.title);
        node.css('order', order);
        node.attr('data-quality-folder-id', folder.id);
        node.on('hover:enter', function () {
            var captured = owner;
            var options = members.map(function (id) {
                return {title: (findCatalog(id) || {}).title || id, id: id};
            });
            if (!L.Select || typeof L.Select.show !== 'function') return;
            L.Select.show({title: folder.title, items: options, onSelect: function (item) {
                if (!isCurrent(captured)) return;
                var selected = findCatalog(item && item.id);
                if (!selected || !selected.node || !selected.node.length) return;
                // Select owns its focus; never force Controller.toggle on an unrelated screen.
                if (L.Select.close) L.Select.close();
                setTimeout(function () {
                    if (isCurrent(captured)) selected.node.trigger('hover:enter');
                }, 0);
            }});
        });
        line.append(node);
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
        view.find('.full-start-new__buttons > .full-start__button').each(function () {
            var b = $(this);
            b.removeClass('quality-buttons-hidden quality-buttons-in-folder quality-buttons-mode-minimal quality-buttons-mode-full');
            if (knownNodes && knownNodes.has(this)) this.style.order = knownNodes.get(this);
        });
    }
    function apply(view) {
        if (!$ || !view || !view.length) return;
        var line = view.find('.full-start-new__buttons').first();
        if (!line.length) return;
        clearGenerated();
        catalog = readButtons(view);
        if (!enabled()) { restore(view); return; }
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
            node.toggleClass('quality-buttons-hidden', !!layout.hidden[entry.id]);
            node.toggleClass('quality-buttons-in-folder', !!groupFor(layout, entry.id));
            node.toggleClass('quality-buttons-mode-minimal', layout.modes[entry.id] === 2);
            node.toggleClass('quality-buttons-mode-full', layout.modes[entry.id] === 3);
        });
        layout.folders.forEach(function (folder, idx) {
            makeFolder(line, folder, layout, maxOrder + catalog.length + idx);
        });
        if (pencilEnabled()) {
            pencil = $('<div class="full-start__button selector quality-buttons-pencil" title="Настройка кнопок"><span>✎</span></div>');
            pencil.css('order', maxOrder + catalog.length + layout.folders.length + 1);
            pencil.on('hover:enter', openEditor);
            line.append(pencil);
        }
    }
    function safeApply() {
        if (!owner || !isCurrent(owner)) return;
        // Our own pencil/folder edits change childList. Suspend observation
        // during layout updates to prevent a perpetual refresh loop.
        var area = owner.find('.full-start-new__buttons')[0];
        if (observer) observer.disconnect();
        try { apply(owner); } catch (e) { /* other plugins may destroy the view */ }
        if (observer && area) observer.observe(area, {childList:true,subtree:false});
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
    function select(title, items, onSelect, onBack) {
        if (!L.Select || typeof L.Select.show !== 'function') return;
        L.Select.show({title: title, items: items, onSelect: onSelect, onBack: onBack});
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
                    if (!v.order.length) v.order = catalog.map(function (b) { return b.id; });
                    if (v.order.indexOf(id) < 0) v.order.push(id);
                    var n = v.order.indexOf(id), next = n + (chosen.action === 'up' ? -1 : 1);
                    if (next >= 0 && next < v.order.length) {
                        var tmp = v.order[next]; v.order[next] = id; v.order[n] = tmp;
                    }
                }
            });
            openEditor();
        });
    }
    function createFolder() {
        if (!L.Input || typeof L.Input.edit !== 'function') return;
        L.Input.edit({title:'Название папки',value:'',free:true,nosave:true,nomic:true},
            function (text) {
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
        var layout = model(), options = catalog.map(function (b) {
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
    function registerSettings() {
        if (settingsRegistered || !L.SettingsApi || !L.SettingsApi.addComponent
            || !L.SettingsApi.addParam) return;
        settingsRegistered = true;
        L.SettingsApi.addComponent({component:'quality_buttons',name:'Quality — кнопки',
            after:'quality',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 21 3-1 12-12-2-2L4 18zM14 6l3 3"/></svg>'});
        L.SettingsApi.addParam({component:'quality_buttons',
            param:{name:'quality_buttons_enabled',type:'trigger',default:true},
            field:{name:'Управлять кнопками',description:'Порядок, видимость и папки на полной карточке'},
            onChange:function () { if (owner) { if (enabled()) rerender(); else restore(owner); } }});
        L.SettingsApi.addParam({component:'quality_buttons',
            param:{name:'quality_buttons_pencil',type:'trigger',default:false},
            field:{name:'Показывать карандаш',description:'Кнопка редактора на полной карточке'},
            onChange:rerender});
        L.SettingsApi.addParam({component:'quality_buttons',
            param:{name:'quality_buttons_open',type:'button',default:''},
            field:{name:'Настроить кнопки',description:'Порядок, показ, режим текста и папки'},
            onChange:openEditor});
        L.SettingsApi.addParam({component:'quality_buttons',
            param:{name:'quality_buttons_reset',type:'button',default:''},
            field:{name:'Сбросить настройки кнопок',description:'Вернуть исходный вид'},
            onChange:function () { save({order:[],hidden:{},modes:{},folders:[]}); rerender(); }});
    }
    function bindFull(event) {
        if (!event || event.type !== 'complite' || !event.body) return;
        var node = $(event.body[0] || event.body);
        if (!node.length || !node.find('.full-start-new__buttons').length) return;
        if (observer) { observer.disconnect(); observer = null; }
        owner = node;
        apply(node);
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
            observer.observe(area, {childList:true,subtree:false});
        }
    }
    function init() {
        if (!$) return;
        var css = document.createElement('style');
        css.textContent = '.quality-buttons-hidden,.quality-buttons-in-folder{display:none!important;}'
            + '.quality-buttons-mode-minimal>span{display:none!important;}'
            + '.quality-buttons-mode-full>span{display:inline!important;}'
            + '.quality-buttons-pencil,.quality-buttons-folder{cursor:pointer;}';
        (document.head || document.documentElement).appendChild(css);
        registerSettings();
        L.Listener.follow('full',bindFull);
        L.Listener.follow('app',function (e) {
            if (e && e.type==='ready') registerSettings();
        });
        if (L.Storage.listener && L.Storage.listener.follow)
            L.Storage.listener.follow('change',function (e) {
                if (!e) return;
                if (e.name === 'quality_buttons_enabled') {
                    if (!enabled() && owner) restore(owner);
                    else rerender();
                } else if (e.name === 'quality_buttons_pencil') rerender();
            });
    }
    root.LampaQualityButtons = {open:openEditor,refresh:rerender,
        status:function () { return {loaded:true,enabled:enabled(),
            pencil:pencilEnabled(),known_buttons:catalog.length,
            folders:model().folders.length}; }};
    root.__qualityButtonsLoaded = true;
    if (document.body) init();
    else document.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : globalThis);
