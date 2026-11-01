(function (root) {
    'use strict';
    if (root.__qualityOnlineFilterLoaded) return;
    if (!root.Lampa || !root.Lampa.Storage || !root.Lampa.Listener) return;
    var L = root.Lampa;
    function setting(name, fallback) {
        var value;
        try { if (L.Storage.get) value = L.Storage.get(name, fallback); } catch (e) {}
        return value === undefined || value === null || value === '' ? fallback : value;
    }
    // Optional Online UX bridge. Identify the actual balancer list populated
    // by Lampa rather than assuming Activity passes a "component" property to
    // every Filter constructor. The previous assumption made the shortcut
    // silently disappear in some Online installations.
    var currentOnlineFilter = null, onlineBridgeInstalled = false;
    var onlineFiltersDetected = 0, onlineFilterSources = 0;
    function onlineFilterEnabled() {
        var value = setting('quality_module_online_source_filter', true);
        return value !== false && String(value) !== 'false';
    }
    function updateOnlineFilter() {
        if (currentOnlineFilter && currentOnlineFilter.refresh)
            currentOnlineFilter.refresh();
    }
    function onlineBalancerList(items) {
        if (!Array.isArray(items) || items.length < 2) return false;
        var names = Object.create(null);
        return items.every(function (item) {
            if (!item || typeof item.source !== 'string'
                || !/^[a-z0-9_-]{2,40}$/i.test(item.source)
                || typeof item.title !== 'string'
                || !item.title.trim() || names[item.source]) return false;
            names[item.source] = true;
            return true;
        });
    }
    function onlineFilterScope(params, filterItems, sortItems) {
        if (!onlineBalancerList(sortItems)) return '';
        var declared = params && typeof params.component === 'string'
            ? params.component.toLowerCase() : '';
        // Never modify another named activity even if it happens to expose
        // fields called "source", "voice" or "season".
        if (declared && !/^(?:lampac$|online(?:$|[_-]))/.test(declared)) return '';
        if (declared) return declared;
        var current = L.Activity && typeof L.Activity.active === 'function'
            ? L.Activity.active() : null;
        var activity = current && String(current.component || '').toLowerCase();
        if (activity && /^(?:lampac$|online(?:$|[_-]))/.test(activity)) return activity;
        // Stock Lampa balancers are enough evidence when some forks omit the
        // component name on the Filter's params object.
        var recognized = {videocdn: true, rezka: true, kinobase: true,
            collaps: true, filmix: true, cdnmovies: true};
        var matches = sortItems.filter(function (item) {
            return recognized[item.source.toLowerCase()];
        }).length;
        var hasReset = (filterItems || []).some(function (item) {
            return item && item.reset === true;
        });
        return hasReset && matches >= 2 ? 'online-detected' : '';
    }
    function installOnlineFilter() {
        if (typeof L.Filter !== 'function') return false;
        if (L.Filter.__qualityOnlineBridge || L.Filter.__balancer_dual_patched) {
            // The user's standalone dual-balancer plugin already implements
            // an "Источник" shortcut. Do not wrap its onSelect a second time.
            onlineBridgeInstalled = true;
            return true;
        }
        var NativeFilter = L.Filter;
        function OnlineFilterBridge(params) {
            var instance = new NativeFilter(params);
            if (!instance || typeof instance.set !== 'function'
                || typeof instance.chosen !== 'function') return instance;
            var nativeSet = instance.set;
            var nativeChosen = instance.chosen;
            var nativeDestroy = instance.destroy;
            var filterItems = null, sortItems = [], chosenItems = null;
            var scope = '', active = false, destroyed = false;
            var nativeSelect = typeof instance.onSelect === 'function'
                ? instance.onSelect : null;
            var bridge = {refresh: refresh, scope: ''};
            function eligible() {
                if (destroyed) return false;
                if (!scope && filterItems && sortItems.length)
                    scope = onlineFilterScope(params, filterItems, sortItems);
                if (!scope) return false;
                if (!active) {
                    active = true;
                    onlineFiltersDetected++;
                }
                onlineFilterSources = sortItems.length;
                bridge.scope = scope;
                currentOnlineFilter = bridge;
                return true;
            }
            function available() {
                return onlineFilterEnabled() && eligible();
            }
            function selectedSource() {
                for (var i = 0; i < sortItems.length; i++)
                    if (sortItems[i].selected) return sortItems[i];
                var saved = setting('online_balanser', '');
                for (var j = 0; j < sortItems.length; j++)
                    if (sortItems[j].source === saved) return sortItems[j];
                return sortItems[0] || null;
            }
            function menuItems() {
                var items = (filterItems || []).slice();
                // The external standalone plugin uses {bal:true}. Reuse its
                // semantics and never duplicate that native-menu shortcut.
                if (items.some(function (x) { return x && x.bal; }))
                    return items;
                if (!available()) return items;
                var selected = selectedSource();
                var entry = {title: 'Источник',
                    subtitle: nativeSelectedSourceLabel() || (selected ? selected.title : ''),
                    bal: true, stype: 'quality_online_source',
                    qualityOnlineSource: true};
                items.splice(items.length && items[0] && items[0].reset ? 1 : 0,
                    0, entry);
                return items;
            }
            function chosenWithSource(items) {
                var list = Array.isArray(items) ? items.slice() : [];
                if (available()) {
                    var selected = selectedSource();
                    if (selected) list.push('Источник: ' + selected.title);
                }
                return list;
            }
            function refresh() {
                // Lampa.Filter.destroy() clears its internal data object.
                // Settings may be toggled after navigating away; never call
                // native set/chosen on a filter that has already been destroyed.
                if (destroyed) return;
                if (filterItems) nativeSet.call(instance, 'filter', menuItems());
                if (chosenItems)
                    nativeChosen.call(instance, 'filter', chosenWithSource(chosenItems));
            }
            instance.set = function (type, items) {
                if (destroyed) return;
                if (type === 'filter') {
                    filterItems = Array.isArray(items) ? items.filter(function (item) {
                        return !item || !item.qualityOnlineSource;
                    }) : items;
                    refresh();
                    return;
                }
                var result = nativeSet.apply(this, arguments);
                if (type === 'sort') {
                    sortItems = Array.isArray(items) ? items.slice() : [];
                    // Both stock Online implementations set filter *before*
                    // sort. A filter must therefore be rebuilt once the actual
                    // provider data is available.
                    refresh();
                }
                return result;
            };
            instance.chosen = function (type, items) {
                if (destroyed) return;
                if (type === 'filter') {
                    chosenItems = Array.isArray(items) ? items.slice() : [];
                    return nativeChosen.call(this, type, chosenWithSource(chosenItems));
                }
                return nativeChosen.apply(this, arguments);
            };
            if (typeof nativeDestroy === 'function') {
                instance.destroy = function () {
                    destroyed = true;
                    if (currentOnlineFilter === bridge) currentOnlineFilter = null;
                    filterItems = null;
                    chosenItems = null;
                    sortItems = [];
                    return nativeDestroy.apply(this, arguments);
                };
            }
            Object.defineProperty(instance, 'onSelect', {
                configurable: true,
                enumerable: true,
                get: function () {
                    return function (type, item, choice) {
                        if (type === 'filter' && item && item.qualityOnlineSource) {
                            if (destroyed || currentOnlineFilter !== bridge || !available()) return;
                            if (L.Activity && typeof L.Activity.active === 'function') {
                                var activePage = L.Activity.active();
                                if (!activePage || (activePage.component
                                    && !/^(?:lampac$|online(?:$|[_-]))/i.test(String(activePage.component))))
                                    return;
                                if (params && params.movie && activePage.movie
                                    && String(params.movie.id) !== String(activePage.movie.id))
                                    return;
                            }
                            // Same contract as the independent bal:true
                            // plugin: open Lampa's *existing* sort selector.
                            // Do not synthesize provider switching or override
                            // its voice/season preservation logic.
                            var button = null;
                            try {
                                var view = instance.render && instance.render();
                                if (view && typeof view.find === 'function')
                                    button = view.find('.filter--sort');
                            } catch (e) {}
                            if ((!button || !button.length))
                                button = nativeBalancerButton();
                            if (button && button.length && typeof button.trigger === 'function')
                                button.trigger('hover:enter');
                            return;
                        }
                        if (nativeSelect) return nativeSelect.apply(instance, arguments);
                    };
                },
                set: function (fn) {
                    nativeSelect = typeof fn === 'function' ? fn : null;
                }
            });
            return instance;
        }
        OnlineFilterBridge.prototype = NativeFilter.prototype;
        OnlineFilterBridge.__qualityOnlineBridge = true;
        L.Filter = OnlineFilterBridge;
        onlineBridgeInstalled = true;
        return true;
    }

    // Native Select's "preshow" event is emitted before Filter.show renders
    // the menu. This also works when an Online plugin captured Lampa.Filter
    // before Quality loaded, so constructor interception never ran.
    var onlineSelectShortcutInstalled = false;
    var onlineSelectMenus = 0, onlineSelectInserted = 0;
    function onlineActivity() {
        try {
            return L.Activity && typeof L.Activity.active === 'function'
                ? L.Activity.active() : null;
        } catch (e) { return null; }
    }
    function nativeBalancerButton() {
        var jq = root.jQuery || root.$ || (typeof $ === 'function' ? $ : null);
        if (!jq) return null;
        var activity = onlineActivity();
        var view = null;
        try {
            if (activity && activity.activity
                && typeof activity.activity.render === 'function')
                view = activity.activity.render();
        } catch (e) {}
        var buttons = view && typeof view.find === 'function'
            ? view.find('.filter--sort') : null;
        // Some Online forks mount the filter outside activity.render().
        if (!buttons || !buttons.length)
            buttons = jq('.filter--sort');
        if (!buttons || !buttons.length || typeof buttons.trigger !== 'function')
            return null;
        if (typeof buttons.filter === 'function') {
            var visible = buttons.filter(':visible');
            if (visible && visible.length) buttons = visible;
        }
        if (typeof buttons.last === 'function') buttons = buttons.last();
        if (!buttons || !buttons.length) return null;
        var title = '';
        try {
            if (typeof buttons.find === 'function') {
                var caption = buttons.find('span');
                if (caption && typeof caption.text === 'function')
                    title = String(caption.text() || '');
            }
        } catch (e) {}
        var componentName = activity ? String(activity.component || '') : '';
        if (/^(?:torrent|torrents|mytorrents|settings|full|main|search|category|favorite|bookmarks|plugins|actor)$/i.test(componentName))
            return null;
        // Lampac's own Online activity uses component="lampac". Its sort
        // control is labeled "Источник" and can display a provider/quality
        // suffix ("ИсточникPhantom ~ 2160p"), not "Балансер".
        var namedOnline = /^(?:lampac$|online(?:$|[_-]))/i.test(componentName);
        var expected = L.Lang && typeof L.Lang.translate === 'function'
            ? String(L.Lang.translate('online_balanser') || '') : '';
        if (!namedOnline
            && !/(балансер|balancer)/i.test(title)
            && !(expected && expected !== 'online_balanser' && title === expected))
            return null;
        return buttons;
    }
    // The native Filter stores its selected source in .filter--sort > div.
    // Read the same displayed label (including resolution), not the generic
    // balancer name; it may differ from the source id saved in Storage.
    function nativeSelectedSourceLabel() {
        var button = nativeBalancerButton();
        if (!button || typeof button.find !== 'function') return '';
        try {
            var label = button.find('> div');
            if (label && typeof label.text === 'function')
                return String(label.text() || '').replace(/\s+/g, ' ').trim();
        } catch (e) {}
        return '';
    }
    function selectIsOnlineFilter(config) {
        if (!config || !Array.isArray(config.items)) return false;
        var hasReset = config.items.some(function (x) { return x && x.reset; });
        if (!hasReset) return false;
        // Stock Filter.show('filter') uses the translated filter title.
        var title = String(config.title || '').toLowerCase();
        var expected = L.Lang && typeof L.Lang.translate === 'function'
            ? String(L.Lang.translate('filter_filtred') || '').toLowerCase() : '';
        if (expected && title === expected) return !!nativeBalancerButton();
        if (/фильтр|filter/i.test(title)) return !!nativeBalancerButton();
        return false;
    }
    function addSourceToNativeSelect(event) {
        var config = event && event.active;
        if (!config || !Array.isArray(config.items)) return;
        // Remove earlier menu-only shortcuts when the same Select configuration
        // object is reused, including when the feature has just been disabled.
        for (var i = config.items.length - 1; i >= 0; i--)
            if (config.items[i] && config.items[i].qualityOnlineSelectShortcut)
                config.items.splice(i, 1);
        if (!onlineFilterEnabled() || !selectIsOnlineFilter(config)) return;
        onlineSelectMenus++;
        // Don't duplicate the source row when the original constructor bridge
        // successfully populated the Filter options already.
        if (config.items.some(function (x) {
            return x && (x.qualityOnlineSource || x.bal);
        }))
            return;
        var item = {
            title: 'Источник',
            subtitle: nativeSelectedSourceLabel() || 'Выбрать балансер',
            bal: true,
            noselect: true,
            qualityOnlineSelectShortcut: true,
            onSelect: function () {
                if (!onlineFilterEnabled()) return;
                var former = onlineActivity();
                setTimeout(function () {
                    if (!onlineFilterEnabled()) return;
                    var current = onlineActivity();
                    if (former && current && former !== current) return;
                    var button = nativeBalancerButton();
                    if (button) button.trigger('hover:enter');
                }, 0);
            }
        };
        config.items.splice(config.items[0] && config.items[0].reset ? 1 : 0, 0, item);
        onlineSelectInserted++;
        // Count a source menu confirmed by actual Select.preshow too; this
        // status used to stay zero for online providers bypassing Lampa.Filter.
        onlineFiltersDetected++;
    }
    function installOnlineSelectShortcut() {
        if (onlineSelectShortcutInstalled) return true;
        if (!L.Select || !L.Select.listener
            || typeof L.Select.listener.follow !== 'function') return false;
        L.Select.listener.follow('preshow', addSourceToNativeSelect);
        onlineSelectShortcutInstalled = true;
        return true;
    }

    root.LampaQualityOnline = {
        revision: 6,
        enabled: onlineFilterEnabled,
        detected: function () { return onlineFiltersDetected; },
        sources: function () { return onlineFilterSources; },
        selectHook: function () { return onlineSelectShortcutInstalled; },
        menus: function () { return onlineSelectMenus; },
        inserted: function () { return onlineSelectInserted; }
    };
    root.__qualityOnlineFilterLoaded = true;
    function startOnline() {
        installOnlineFilter();
        installOnlineSelectShortcut();
        if (L.SettingsApi && L.SettingsApi.addParam) {
            L.SettingsApi.addParam({
                component: 'quality',
                param: {name:'quality_module_online_source_filter',type:'trigger',default:true},
                field: {name:'Источник в фильтре Онлайн',
                    description:'Показывать балансер рядом с озвучкой и сезонами в Онлайн'},
                onChange:updateOnlineFilter
            });
        }
        var tries=0;
        if (!onlineBridgeInstalled || !onlineSelectShortcutInstalled) {
            var timer=setInterval(function () {
                installOnlineFilter();
                installOnlineSelectShortcut();
                if ((onlineBridgeInstalled && onlineSelectShortcutInstalled) || ++tries>=30)
                    clearInterval(timer);
            },1000);
            if (timer && typeof timer.unref === 'function') timer.unref();
        }
        L.Listener.follow('app',function(e) {
            if (e && e.type === 'ready') {
                installOnlineFilter();
                installOnlineSelectShortcut();
            }
        });
        if (L.Storage.listener && L.Storage.listener.follow)
            L.Storage.listener.follow('change',function(e) {
                if(e && e.name === 'quality_module_online_source_filter')
                    updateOnlineFilter();
            });
    }
    if (document.body) startOnline();
    else document.addEventListener('DOMContentLoaded', startOnline);
})(typeof window !== 'undefined' ? window : globalThis);
