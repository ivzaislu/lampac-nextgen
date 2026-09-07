namespace TranslationSub;

public class ModuleConf
{
    public bool enable { get; set; } = true;
    public int check_interval_minutes { get; set; } = 15;
    public bool notifications { get; set; } = true;

    public string mirage_apihost { get; set; } = "https://api.apbugall.org";
    public string mirage_linkhost { get; set; } = "https://aport-as.allarknow.online";
    public string mirage_token { get; set; } = "22c8122334d050de1bfc97bd08aa5e";
}
