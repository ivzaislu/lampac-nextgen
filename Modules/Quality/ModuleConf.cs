namespace Quality;

public class ModuleConf
{
    // Master switch for the entire Quality module.
    public bool enable { get; set; } = true;

    // Automatically inject /quality.js into the bundled LampaWeb.
    public bool autoinject { get; set; } = true;

    // Independent features. Disable the collector without losing the
    // Online filter or the user's saved Full-card button layout.
    public bool collect { get; set; } = true;
    public bool background { get; set; } = true;
    public bool onlinefilter { get; set; } = true;
    public bool buttons { get; set; } = true;

    // Server-side persistent cache (not the local Lampa.Storage cache).
    public bool sqlcache { get; set; } = true;
}
